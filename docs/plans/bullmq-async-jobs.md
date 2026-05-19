# BullMQ async job infrastructure — implementation plan

> **Note on location.** This plan describes work in `OpusPopuli/opuspopuli` (the main monorepo), not this regions repo. It lives here because the planning branch was set up against `opuspopuli-regions`. When the implementation PR opens against `opuspopuli`, this file should be moved (`git mv`) to `docs/architecture/bullmq-async-jobs.md` over there.

Tracking issue: [OpusPopuli/opuspopuli#644](https://github.com/OpusPopuli/opuspopuli/issues/644)

Closes (rolled into this PR): #653 (cron-through-queue).

Deferred follow-ups: #651 (declarative per-source cadence in regions), #652 (idempotency rework), #654 (BullBoard admin), #656 (structural-analysis decoupling).

## Design north star

> **The substrate must absorb new job families without code restructure.** v1 ships exactly one queue (`region-sync`), but the package layout, naming, schema pattern, metrics labels, and worker process structure are chosen so that adding a `bill-watch-notifications` queue, a `topic-interest-alerts` queue, a `webhook-deliveries` queue, etc., is purely additive: a new processor file, a new status table, a new env var. No coordinated migrations. No renames. No flag flips for unrelated jobs.

Concretely, the conventions below are reusable; the v1 implementation is the first instance of them.

## Decisions locked in for v1

| Question from issue | Decision | Notes |
|---|---|---|
| Worker topology | **Separate container, one process per worker app** | First worker app is `region-worker` (nest sub-app at `apps/backend/src/apps/region-worker`), same image as the API services, different entrypoint. Future job families can land as additional processors in the *same* container until their scaling profile diverges, or as peer worker apps (`notifications-worker`, etc.) when split is warranted. The split is a deploy-config decision, not a code restructure. |
| Status durability | **Per-queue status table; DB is canonical** | `pipeline_jobs` is the v1 instance and the template for future queues. BullMQ job state is used only for queue operations (enqueue, retry, drain). Each new job family adds its own status table (`notification_deliveries`, `bill_watch_events`, …) following the template — never overload `pipeline_jobs` with foreign concerns. |
| v1 queue | **`region-sync` only** | One queue serves both manual (GraphQL) and scheduled (repeatable job) syncs. `bulk-download`, `api-ingest`, `pdf-extract` stay synchronous (gated on #652 / #656). |
| Cron | **Moved into the queue** | `@nestjs/schedule` removed from the region service. A BullMQ repeatable job in the worker fires the same daily cadence (`0 2 * * *`) and enqueues a `region-sync` job. Closes #653. |

No mixed-mode: every sync — manual or scheduled — flows through `region-sync`. The architectural cost of bundling #653 here is ~1.5 days; the alternative is a transient state we'd pay back with interest later.

## Out of scope (do not build now)

- Declarative per-source cadence (#651) — `syncCadence` in `@opuspopuli/regions`. Cron stays as a single daily repeatable until that lands.
- Idempotency rework for streaming handlers (#652) — `bulk-download` / `api-ingest` stay synchronous for v1.
- BullBoard admin UI (#654).
- Structural-analysis decoupling (#656).
- Per-region or per-host rate limiting (one global concurrency cap is enough for v1; the substrate exposes the hooks needed to add this later).
- Cancellation (`cancelSync`) — defer; failed-fast retries cover most cases.
- Notification, watch, and topic-alert queues. The substrate is built so these drop in cleanly — but no code, no schema, no GraphQL surface for them in this PR.
- BullMQ Flows (parent/child job relationships). Useful eventually for "one trigger fans out to N deliveries"; not needed for v1's single queue.

## Architecture

```
┌────────────────────┐         ┌─────────┐         ┌────────────────────────────────┐
│  region API        │  enq.   │         │  pull   │  region-worker container       │
│  (NestJS, :3004)   │ ──────► │  Redis  │ ──────► │                                │
│                    │         │ BullMQ  │         │  ┌──────────────────────────┐  │
│  syncRegionData    │         │         │         │  │ Worker('region-sync')    │  │
│  regionSyncJob     │         └────▲────┘         │  │  concurrency: 1          │  │
│  recentRegion…     │              │              │  │  RegionService.syncAll() │  │
│                    │              │              │  └──────────────────────────┘  │
│  (future queues    │              │              │                                │
│   enqueue here     │──────────────┘              │  ┌──────────────────────────┐  │
│   too)             │      enqueue                │  │ JobScheduler(daily-cron) │──┼──► enq.
└──────────┬─────────┘                             │  └──────────────────────────┘  │   region-sync
           │  reads                                │                                │
           │                                       │  (future Workers slot in       │
           ▼                                       │   here or in peer worker apps) │
     ┌─────────────────────────────────────────┐   └──────────────┬─────────────────┘
     │  Postgres                               │                  │ writes
     │    pipeline_jobs        (region-sync)   │ ◄────────────────┘
     │    pipeline_executions  (per-source)    │
     │    [future: notification_deliveries,    │
     │     bill_watch_events, …]               │
     └─────────────────────────────────────────┘
```

The region API container retains the GraphQL resolver only. The `region-worker` container owns both scheduling and execution of syncs. A given worker *container* can host multiple BullMQ `Worker` instances (one per queue) — splitting into peer containers (`notifications-worker`) is a deploy-config decision triggered by divergent scaling profiles, not a code restructure.

### What the region service becomes

Two ways to describe it after this change:

- **As a process** — API-only. The region container hosts GraphQL resolvers for reads (propositions, bills, representatives) plus the new sync-enqueue mutation and the status query. No long-running work runs inside it. No scheduler. No 25-minute calls holding the container thread.
- **As a codebase** — still owns the region domain logic. `RegionDomainService`, the per-data-type sync code, the per-source handlers, the manifest store — all of that stays in `apps/backend/src/apps/region/`. It gets *consumed by two different processes now*: the region container (for the resolver) and the region-worker container (for the processor).

That dual-consumption is the whole reason `region-worker` stays as a sibling sub-app in the backend monorepo rather than being extracted to a separate repo or package — one set of domain types, one Prisma client, one set of unit tests. Code dependency is strictly one-way: `region-worker` imports `region`, never the reverse.

### Who registers the scheduler

The **worker** registers the recurring job at its own bootstrap, not the region service. Two reasons:

1. The worker is the process that needs to be alive when the job fires — registering a scheduler from a process that may not be running when 02:00 hits is a smell.
2. Keeps all queue-side concerns in one place; the region service stays purely "API + enqueue."

In v1 the worker registers one hardcoded entry: `daily 02:00`. When #651 (declarative per-source cadence in `@opuspopuli/regions`) lands, the bootstrap reads every region/source config and calls `upsertScheduler` for each one with its declared cadence. `JobScheduler` dedupes by id, so re-registering on every worker boot is idempotent and config changes take effect on next deploy.

## Sync job flows

### Manual sync (admin, Postman, future public API)

```
  browser /         api gateway         region service       Redis      region-worker        Postgres
  Postman           (:3000)             (:3004)              (BullMQ)   (region-sync         (pipeline_jobs,
                                                                         worker)              domain tables)
  ─────────────────────────────────────────────────────────────────────────────────────────────────────────
    │                  │                     │                  │              │                  │
 1. │ syncRegionData──►│                     │                  │              │                  │
    │ (mutation)       │ HMAC fwd ──────────►│                  │              │                  │
    │                  │                 2.  │ INSERT pipeline_jobs ──────────────────────────────►│
    │                  │                     │ (status='queued',                                   │
    │                  │                     │  trigger_source='manual')                           │
    │                  │                 3.  │ enqueue(REGION_SYNC, …) ────────►│                  │
    │                  │                     │                  │              │                  │
    │                  │◄──────────  4. { jobId, status:QUEUED }│              │                  │
    │◄─────────────────│                     │                  │              │                  │
    │                                                                                              │
 5. │ start polling regionSyncJob(jobId) every ~2s                                                  │
    │                                                                                              │
    │                                                              6. dequeue ─►│                  │
    │                                                                       7.  │ UPDATE pipeline ►│
    │                                                                           │  _jobs status=   │
    │                                                                           │  'running',      │
    │                                                                           │  started_at=now()│
    │                                                                       8.  │ regionService.   │
    │                                                                           │  syncAll(...)    │
    │                                                                           │   ├─ fetch gov   │
    │                                                                           │   │  sites       │
    │                                                                           │   ├─ LLM         │
    │                                                                           │   │  structural  │
    │                                                                           │   │  analysis    │
    │                                                                           │   ├─ extract     │
    │                                                                           │   └─ upsert ────►│
    │                                                                           │     domain rows  │
    │                                                                       9.  │ UPDATE pipeline ►│
    │                                                                           │  _jobs status=   │
    │                                                                           │  'succeeded',    │
    │                                                                           │  finished_at,    │
    │                                                                           │  result=[…]      │
    │                                                                                              │
 10.│ regionSyncJob returns status=SUCCEEDED, results=[…]  ◄──────────────────────────────────────│
    │ polling stops, UI shows "sync complete"                                                       │
```

Between steps 4 and 10 the browser talks only to the region service (read-only status polls). It never speaks to Redis or the worker. The async-ness is hidden behind two GraphQL operations: enqueue + poll.

### Scheduled sync (no human involved)

Shorter — the API gateway and the browser don't exist in this path:

```
  region-worker         Redis           region-worker          Postgres
  (JobScheduler)        (BullMQ)        (Worker)
  ──────────────────────────────────────────────────────────────────
       │                   │                  │                  │
  02:00│ cron-daily-       │                  │                  │
       │ ${YYYYMMDD}       │                  │                  │
       │                                                          │
       │ INSERT pipeline_jobs ────────────────────────────────────►
       │ (trigger_source='cron')                                  │
       │ enqueue(REGION_SYNC, …) ─►                               │
       │                   │                  │                  │
       │                   │   dequeue ──────►│                  │
       │                                      │ … same syncAll   │
       │                                      │   flow as steps  │
       │                                      │   7–9 above ────►│
```

Same processor, same `pipeline_jobs` table, same `syncAll` code path. The only differences are `trigger_source='cron'` and no user is waiting on a poll. That sameness is the design goal — one execution path for both triggers.

## Substrate conventions (the patterns future queues follow)

These are the rules of the road. v1 establishes them; everything from here forward follows them.

### Queue naming

- Kebab-case, scoped by domain: `region-sync`, `bill-watch-notifications`, `topic-interest-alerts`.
- Constants exported from `queue-provider`: `REGION_SYNC_QUEUE = 'region-sync'`, etc. Never inline string literals at call sites.

### Per-queue env-var prefix

All queue-tunable settings use a uniform prefix derived from the queue name (uppercase, dashes → underscores):

| Setting | Env var | Default |
|---|---|---|
| Concurrency | `BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY` | `1` |
| Max attempts | `BULLMQ_QUEUE_REGION_SYNC_ATTEMPTS` | `3` |
| Backoff base ms | `BULLMQ_QUEUE_REGION_SYNC_BACKOFF_MS` | `30000` |
| Per-queue enable | `BULLMQ_QUEUE_REGION_SYNC_ENABLED` | `true` |

Adding `bill-watch-notifications` later means defining `BULLMQ_QUEUE_BILL_WATCH_NOTIFICATIONS_*` env vars — the `QueueService` helper reads them by queue name, no per-queue config code.

### Status-table template

Every job family gets its own status table modeled on `pipeline_jobs`. Common columns:

```
id              uuid pk
bullmq_job_id   text                  -- BullMQ job id
trigger_source  text                  -- queue-specific enum (e.g. manual|cron|startup, or webhook|user-action)
status          text                  -- queued|running|succeeded|failed
attempts        int
enqueued_by     text                  -- userId or null
enqueued_at     timestamptz
started_at      timestamptz
finished_at     timestamptz
error_message   text
result          jsonb                 -- queue-specific result payload
created_at      timestamptz
```

Plus queue-specific columns (for `pipeline_jobs`: `region_id`, `data_types`, `depth`, …; for a future `notification_deliveries`: `user_id`, `notification_type`, `target_entity_id`, …). The shape stays familiar; the contents are queue-owned.

### Processor structure

One processor file per queue, colocated with the worker app that hosts it. Each processor:

1. Resolves its domain service(s) from the Nest application context.
2. Transitions its status row to `running` at start, `succeeded`/`failed` at end.
3. Catches the *final* failure (after retries exhausted) to mark the row `failed` with an error message; intermediate retry failures stay in BullMQ's job state, not the DB.
4. Emits the universal log fields (`queue`, `jobId`, `attempt`, `trigger_source`) plus any queue-specific fields.

### Metrics — labeled, not per-queue-named

Universal `bullmq_*` metric names with a `queue` label — so adding a queue is observability-for-free:

- `bullmq_queue_depth{queue, status="waiting|active|delayed|failed"}` (gauge)
- `bullmq_job_duration_ms{queue, trigger_source}` (histogram)
- `bullmq_job_attempts_total{queue, trigger_source, outcome}` (counter)

A new queue automatically shows up in Grafana dashboards filtered by `queue=...`. Existing alerts that page on `bullmq_queue_depth{status="failed"} > N` apply to it without configuration.

### Logging — universal fields

`SecureLogger` lines from any processor include: `queue`, `jobId`, `attempt`, `trigger_source`. Queue-specific fields (e.g. `regionId`, `dataTypes` for sync; `userId`, `notificationType` for notifications) are added on top.

### Worker app structure

`apps/backend/src/apps/<name>-worker/` is the pattern. v1 ships one: `region-worker`. The convention:

- `main.ts` — same bootstrap shape every time
- `<name>-worker.module.ts` — imports domain modules, `QueueModule`, `MetricsModule`, `LoggingModule`
- One file per processor: `<queue-name>.processor.ts`
- One file per scheduler (if the queue has a repeatable job): `<queue-name>.scheduler.ts`

The first new job family decides: "does it belong in `region-worker` (shared domain context, low extra cost) or a peer `notifications-worker` (separate scaling/oncall)?" Defaults to the former until there's a concrete reason to split.

## File-level shape

### New files

- `packages/queue-provider/` — new workspace package wrapping BullMQ. Mirrors the provider-pattern (CLAUDE.md). Exports:
  - `QueueModule.forRoot({ url: REDIS_URL, prefix: BULLMQ_PREFIX })` — registers a single shared `IORedis` connection
  - `QueueService` — typed `enqueue<T>(queue, payload, opts)`, `getStatus(queue, jobId)`, `upsertScheduler(queue, schedulerId, cron, payload)`, `close()`. Reads per-queue env vars by name internally.
  - `createWorker<T>(queue, handler)` — thin factory that applies the per-queue env-var config (concurrency, attempts, backoff) and wires standard metrics + log fields.
  - Queue name constants: `REGION_SYNC_QUEUE = 'region-sync'` (the only one for v1).
  - Type defs: `RegionSyncJobData`, `RegionSyncJobResult` (queue-specific types live here so callers and processors share them).
- `apps/backend/src/apps/region-worker/` — new nest sub-app
  - `main.ts` — bootstrap (no HTTP server; `NestFactory.createApplicationContext` plus a tiny `/healthz` Express listener on a separate port for the docker healthcheck and Prometheus scrape)
  - `region-worker.module.ts` — imports `RegionDomainModule`, `QueueModule`, `MetricsModule.forRoot({ serviceName: 'region-worker' })`, `LoggingModule`
  - `region-sync.processor.ts` — resolves `RegionDomainService`; on each job updates `pipeline_jobs` row to `running`, calls `regionService.syncAll(...)`, writes the aggregate result and `finishedAt`. Final-failure path marks the row `failed`.
  - `region-sync.scheduler.ts` — `OnApplicationBootstrap` hook that calls `queueService.upsertScheduler(REGION_SYNC_QUEUE, 'daily-cron', '0 2 * * *', { triggerSource: 'cron' })`. BullMQ's `JobScheduler` dedupes by id, so worker restarts don't duplicate the schedule. **Replaces** the old `RegionScheduler` entirely.
- `apps/backend/src/apps/region/src/domains/pipeline-job.service.ts` — thin wrapper around Prisma for `pipeline_jobs` CRUD + status mapping. Used by both the resolver (create on enqueue) and the worker (transition states). Future queues will have their own analog (e.g. `NotificationDeliveryService`) — they don't reuse `PipelineJobService`.
- `supabase/migrations/<timestamp>_pipeline_jobs.sql` — migration creating `pipeline_jobs` and adding `pipeline_job_id` FK to `pipeline_executions`.

### Modified files

- `apps/backend/src/apps/region/src/domains/region.resolver.ts`
  - **`syncRegionData` becomes async-enqueue**: insert `pipeline_jobs` row (status `queued`, `triggerSource = 'manual'`), enqueue BullMQ job, return `RegionSyncJobModel` with `jobId` + status.
  - **New query**: `regionSyncJob(jobId: ID!): RegionSyncJobModel` — read `pipeline_jobs` row.
  - Preserves `@UseGuards(AuthGuard)` and `@Roles(Role.Admin)`. Drop `@Extensions({ complexity: 100 })` from the mutation (the new mutation is cheap); apply it to the query if needed.
- `apps/backend/src/apps/region/src/domains/region.module.ts`
  - Remove `ScheduleModule.forRoot()` import.
  - Remove `RegionScheduler` from providers.
  - Import `QueueModule.forRootAsync(...)`.
  - Provide `PipelineJobService`.
- `apps/backend/src/apps/region/src/domains/region.scheduler.ts`
  - **Delete.** Daily cron → `apps/region-worker/region-sync.scheduler.ts`; `onModuleInit` initial-sync-on-startup → see below.
- `apps/backend/package.json`
  - Remove `@nestjs/schedule` if no other code uses it.
  - Add `build:region-worker` and `start:region-worker` scripts, mirroring `build:region` / `start:region`.
  - Add `start:region-worker` to `start:services` so `pnpm dev` runs it alongside the others.
- `packages/config-provider/src/index.ts`
  - Export a `redisConfig` block reading `REDIS_URL` and `BULLMQ_PREFIX` (defaults to `bullmq`).
  - Replace `region.syncEnabled` with `region.syncCronEnabled` (default `true` in prod, `false` in dev).
- `docker-compose.yml` and `docker-compose-prod.yml`
  - Add `region-worker` service: same image as the API services, `command: pnpm start:region-worker` (dev) / `node dist/apps/region-worker/main.js` (prod). `depends_on: [redis, supabase-db]`. Same env-file pattern. Healthcheck hits the worker's `/healthz`.
- `apps/backend/nest-cli.json`
  - Register the `region-worker` sub-app so `nest build --tsc region-worker` works.
- Prometheus scrape config under `observability/prometheus/` — add `region-worker` target.

### Handling `onModuleInit` initial-sync-on-startup

Today, `RegionScheduler.onModuleInit` runs a full `syncAll()` every time the region service boots. In dev `nest start --watch`, that means a 25+ minute sync triggers on every code change — almost certainly not intended, but worth verifying before deleting.

Plan:
- **Drop** the auto-sync-on-startup behavior entirely. The daily repeatable job covers the regular sync need.
- Replace with an explicit one-shot opt-in: env `REGION_SYNC_RUN_ON_STARTUP=true` (default `false`). When set, the worker enqueues a single `region-sync` job at bootstrap with `triggerSource = 'startup'`. Useful for prod first-deploy seeding.

### Dev behavior

In `pnpm dev`, the worker runs but the daily cron firing at 2 AM during local hacking is annoying. Default `REGION_SYNC_CRON_ENABLED=false` in dev `.env` so the scheduler skips `upsertScheduler`. Engineers who need to test the cron path flip it explicitly. Prod and UAT default to `true`.

## Database schema (`pipeline_jobs`)

This is the v1 instance of the status-table template documented above.

```sql
create table public.pipeline_jobs (
  id              uuid primary key default uuid_generate_v4(),
  bullmq_job_id   text not null,             -- BullMQ job id; not unique (retries)
  trigger_source  text not null check (trigger_source in
                    ('manual','cron','startup')),
  region_id       text,
  data_types      text[] not null default '{}',
  depth           text,
  max_reps        int,
  max_bills       int,
  status          text not null check (status in
                    ('queued','running','succeeded','failed')),
  attempts        int  not null default 0,
  enqueued_by     text,
  enqueued_at     timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  error_message   text,
  result          jsonb,                     -- SyncResult[] when succeeded
  created_at      timestamptz not null default now()
);

create index pipeline_jobs_status_idx     on public.pipeline_jobs (status, enqueued_at);
create index pipeline_jobs_region_idx     on public.pipeline_jobs (region_id, enqueued_at desc);
create index pipeline_jobs_bullmq_idx     on public.pipeline_jobs (bullmq_job_id);
create index pipeline_jobs_trigger_idx    on public.pipeline_jobs (trigger_source, enqueued_at desc);

alter table public.pipeline_executions
  add column pipeline_job_id uuid references public.pipeline_jobs(id) on delete set null;

create index pipeline_executions_job_idx  on public.pipeline_executions (pipeline_job_id);
```

`trigger_source` distinguishes the three enqueue paths in ops queries. `result` stores the `SyncResult[]` the resolver used to return inline.

## GraphQL surface

```graphql
type RegionSyncJob {
  jobId: ID!
  status: SyncJobStatus!         # QUEUED | RUNNING | SUCCEEDED | FAILED
  triggerSource: SyncTriggerSource!  # MANUAL | CRON | STARTUP
  regionId: String
  dataTypes: [DataType!]!
  enqueuedAt: DateTime!
  startedAt: DateTime
  finishedAt: DateTime
  errorMessage: String
  results: [SyncResult!]         # populated when SUCCEEDED
  elapsedMs: Int
}

extend type Mutation {
  syncRegionData(
    dataTypes: [DataType!]
    depth: SyncDepth
    regionId: String
    maxReps: Int
    maxBills: Int
  ): RegionSyncJob!
}

extend type Query {
  regionSyncJob(jobId: ID!): RegionSyncJob
  recentRegionSyncJobs(limit: Int = 20): [RegionSyncJob!]!   # ops convenience
}
```

`recentRegionSyncJobs` is a small ops affordance — without BullBoard (#654) we want a way for an admin to glance at recent cron + manual runs from the existing GraphQL playground. Future job families add their own analogous types and queries (e.g. `BillWatchEvent`, `recentBillWatchEvents`) — never overload `RegionSyncJob`.

**Breaking change** for any frontend code reading `syncRegionData` synchronously: the admin sync trigger UI needs a one-time update to poll `regionSyncJob`. Land inside the same PR so `develop` is never half-broken.

## Worker process details

- **Concurrency**: `BULLMQ_QUEUE_REGION_SYNC_CONCURRENCY=1` by default. A full `syncAll` already fans out across data types in-process. Easy to bump via env.
- **Retry policy**: `attempts: 3`, `backoff: { type: 'exponential', delay: 30_000 }`. Safe for v1 because only HTML scrape jobs land on this queue; streaming handlers stay synchronous until #652.
- **Idempotency on cron**: the repeatable job uses BullMQ's built-in scheduler-id dedupe. For belt-and-braces, the cron-triggered enqueue derives `jobId = 'cron-daily-${YYYYMMDD}'`, so a worker restart or scheduler drift within the same UTC day collapses to one job.
- **Job options**:
  - `removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 }` — Redis history is short; canonical history is in `pipeline_jobs`.
  - `removeOnFail: { age: 60 * 60 * 24 * 30 }` — keep failures longer.
  - Manual enqueue uses `jobId = pipeline_jobs.id` so resolver retries dedupe.
- **Shutdown**: NestJS lifecycle hook calls `worker.close()` on SIGTERM; in-flight jobs get up to a 30s grace. Stale jobs return to the queue via BullMQ's stalled-job watchdog.

## Scaling axes

Three independent axes the substrate supports without code restructure:

1. **Horizontal worker instances.** Run N copies of `region-worker`; BullMQ distributes jobs across all of them. No coordination needed beyond Redis. `docker compose --scale region-worker=N` in dev; deployment platform's replica count in prod. Total parallelism is `N × concurrency`.
2. **Per-queue concurrency.** `BULLMQ_QUEUE_<NAME>_CONCURRENCY` tunes how many jobs of that queue a single worker instance processes in parallel. Set high for cheap fast jobs (notifications: 50+), low for expensive ones (sync: 1, pdf-extract: 2).
3. **Worker-app split.** When a job family's scaling/oncall profile diverges from `region-worker`'s, peel it off into a peer worker app (`notifications-worker`, `webhook-deliveries-worker`). Code change: new sub-app dir, new compose service. Code that doesn't move: the `queue-provider` package, the metric names, the env-var convention, the status-table pattern.

Trigger for #3 in practice: oncall sensitivity (a notification outage should not be in the same blast radius as a sync outage), or genuinely different resource shapes (LLM-heavy PDF jobs vs. HTTP-light notification deliveries).

## Adding a new queue (developer recipe)

When the first follow-up queue lands (e.g. `bill-watch-notifications` for the watch/notify use cases), the work is:

1. Add the constant in `queue-provider`: `BILL_WATCH_NOTIFICATIONS_QUEUE = 'bill-watch-notifications'`, plus its job-data/result types.
2. Add a migration creating `bill_watch_events` (status table, following the template).
3. Add the status-table service (e.g. `BillWatchEventService`) in the appropriate domain.
4. Decide: same worker container or new one? Default to `region-worker` until divergence forces a split.
   - Same container: add `bill-watch-notifications.processor.ts` to `apps/region-worker/`, register in `region-worker.module.ts`.
   - New container: scaffold `apps/notifications-worker/` mirroring `region-worker/`'s structure, add the compose service.
5. Add env defaults: `BULLMQ_QUEUE_BILL_WATCH_NOTIFICATIONS_*` in `.env.example` and the prod env-file. Sensible defaults: `CONCURRENCY=20`, `ATTEMPTS=5`.
6. Add the GraphQL surface (enqueue mutation + read query) following the `RegionSyncJob` shape.
7. Tests follow the `region-sync` test pattern.

Nothing in `queue-provider`, `pipeline_jobs`, the metrics naming, or the existing `region-sync` code changes. The new queue gets observability, retry, idempotency hooks, scheduler support, and shutdown semantics for free.

## Observability

- **Prometheus metrics** (registered via existing `MetricsModule`, with `queue` label):
  - `bullmq_queue_depth{queue,status="waiting|active|delayed|failed"}` (gauge, sampled every 10s by an `@Interval` task in each worker container)
  - `bullmq_job_duration_ms{queue,trigger_source}` (histogram)
  - `bullmq_job_attempts_total{queue,trigger_source,outcome}` (counter)
- **Structured logs** via `SecureLogger`. Universal fields: `queue`, `jobId`, `attempt`, `trigger_source`. Plus queue-specific (`regionId`, `dataTypes` for `region-sync`).
- **No BullBoard.** Operators inspect via `recentRegionSyncJobs` query or `redis-cli`. #654 covers the UI later.

## Test plan

- Unit: `region-sync.processor.spec.ts` — mocks `RegionDomainService.syncAll` to assert state transitions on success, failure, and retry exhaustion.
- Unit: `region.resolver.spec.ts` — `syncRegionData` enqueues exactly one job, sets `triggerSource = 'manual'`, returns the job handle without invoking `syncAll`.
- Unit: `region-sync.scheduler.spec.ts` — on bootstrap with `REGION_SYNC_CRON_ENABLED=true`, calls `upsertScheduler` with the daily cron; with `false`, does nothing.
- Unit: `queue-provider` — env-var parsing for per-queue config; metric labels emitted correctly; `createWorker` factory wires standard fields. These tests exercise the substrate conventions and will catch regressions for *all* future queues.
- Integration: spin up Redis, enqueue a manual job, assert the worker processes it and `pipeline_jobs` ends `succeeded`; separately, run the scheduler bootstrap and assert a scheduler entry exists.
- E2E: not in scope.

## Migration / rollout

Two feature flags during rollout so we can validate the mutation path before flipping cron — the goal is no mixed mode as a *destination*, transient mixed mode during rollout is desirable for safety:

| Flag | What it gates | Default during rollout |
|---|---|---|
| `REGION_SYNC_ASYNC` | GraphQL mutation enqueues vs. calls `syncAll` synchronously | flip first |
| `REGION_SYNC_CRON_VIA_QUEUE` | repeatable BullMQ job vs. old `@Cron` decorator | flip second, after mutation path is green for a week |

The old `RegionScheduler` is **not** deleted in the initial PR — it stays behind `REGION_SYNC_CRON_VIA_QUEUE=false`. Deletion lands in the cleanup PR.

Sequence:
1. Land migration + new package + worker app + flag-gated code paths in one PR to `develop`. Default both flags off — code is shipped but inert.
2. Update admin sync UI to read `regionSyncJob` (same PR).
3. Flip `REGION_SYNC_ASYNC=true` in dev → UAT → prod. Validate manual sync works for ~1 week.
4. Flip `REGION_SYNC_CRON_VIA_QUEUE=true` everywhere.
5. Cleanup PR: delete `RegionScheduler`, remove flags, remove `@nestjs/schedule` dep.

## Effort estimate

| Slice | Days |
|---|------|
| `queue-provider` package + per-queue config + tests | 1.5 |
| `region-worker` sub-app + processor + Nest wiring | 2 |
| Repeatable-job scheduler + tests | 0.5 |
| Migration + `PipelineJobService` + resolver / query changes | 1.5 |
| Compose + Prometheus (labeled metrics) + worker healthcheck | 0.5 |
| Frontend admin-sync UI update | 0.5 |
| Integration tests | 1.5 |
| Two-stage feature-flag rollout + cleanup PR | 1 |
| **Total** | **~9 days** |

The +0.5 day vs. the previous estimate is in `queue-provider` — the per-queue env-var helpers and the `createWorker` factory are extra surface area but pay back the first time a follow-up queue lands.

## Open questions to resolve in PR review

1. **Where does `queue-provider` live?** Workspace package (`packages/queue-provider`) vs a `common/queue/` directory under `apps/backend/src`. Recommend package — aligns with the provider-pattern and is consumable from any sub-app.
2. **`onModuleInit` audit.** Confirm no environment depends on "region service restart triggers a full sync." Five-minute check; if anything does, `REGION_SYNC_RUN_ON_STARTUP=true` recovers it.
3. **Authorization on `regionSyncJob` / `recentRegionSyncJobs` queries.** v1 picks `@Roles(Role.Admin)`; revisit alongside #629 (public API).
4. **Where does the next queue land?** Not for *this* PR, but worth aligning intent: the watch/notification queues will arrive soon. The substrate is built to absorb them as additional processors in `region-worker`; the call to split into `notifications-worker` is reserved for the moment scaling profiles or oncall sensitivity genuinely diverge.
