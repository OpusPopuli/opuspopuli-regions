# BullMQ async job infrastructure — implementation plan

> **Note on location.** This plan describes work in `OpusPopuli/opuspopuli` (the main monorepo), not this regions repo. It lives here because the planning branch was set up against `opuspopuli-regions`. When the implementation PR opens against `opuspopuli`, this file should be moved (`git mv`) to `docs/architecture/bullmq-async-jobs.md` over there.

Tracking issue: [OpusPopuli/opuspopuli#644](https://github.com/OpusPopuli/opuspopuli/issues/644)

Closes (rolled into this PR): #653 (cron-through-queue).

Deferred follow-ups: #651 (declarative per-source cadence in regions), #652 (idempotency rework), #654 (BullBoard admin), #656 (structural-analysis decoupling).

## Decisions locked in for v1

| Question from issue | Decision | Notes |
|---|---|---|
| Worker topology | **Separate container** | New nest sub-app `apps/backend/src/apps/worker`, packaged into the existing backend image, run with `nest start worker` as the container command. Adds one compose service, no second Dockerfile. |
| Status durability | **`pipeline_jobs` table is canonical** (extends the "PipelineExecution row is canonical" choice) | BullMQ job state is used only for queue operations (enqueue, retry, drain). The DB row is what the API returns. Per-source `pipeline_executions` rows link via FK so future per-source observability is additive. |
| v1 queue | **`region-sync` only** | One queue serves both manual (GraphQL) and scheduled (repeatable job) syncs. `bulk-download`, `api-ingest`, `pdf-extract` stay synchronous (gated on #652 / #656). |
| Cron | **Moved into the queue** | `@nestjs/schedule` removed from the region service. A BullMQ repeatable job in the worker fires the same daily cadence (`0 2 * * *`) and enqueues a `region-sync` job. Closes #653. |

No mixed-mode: every sync — manual or scheduled — flows through `region-sync`. The architectural cost of bundling #653 here is ~1.5 days; the alternative is a transient state we'd pay back with interest later.

## Out of scope (do not build now)

- Declarative per-source cadence (#651) — `syncCadence` in `@opuspopuli/regions`. Cron stays as a single daily repeatable until that lands.
- Idempotency rework for streaming handlers (#652) — `bulk-download` / `api-ingest` stay synchronous for v1.
- BullBoard admin UI (#654).
- Structural-analysis decoupling (#656).
- Per-region or per-host rate limiting (one global concurrency cap is enough for v1).
- Cancellation (`cancelSync`) — defer; failed-fast retries cover most cases.

## Architecture

```
┌────────────────────┐         ┌─────────┐         ┌──────────────────────┐
│  region API        │  enq.   │         │  pull   │  region-worker       │
│  (NestJS, :3004)   │ ──────► │  Redis  │ ──────► │  (NestJS, no HTTP)   │
│                    │         │ BullMQ  │         │                      │
│  syncRegionData    │         │         │         │  ┌────────────────┐  │
│  regionSyncJob     │         └────▲────┘         │  │ repeatable job │  │
└──────────┬─────────┘              │              │  │  0 2 * * *     │──┼──► enqueues
           │  reads                 │ enqueue      │  └────────────────┘  │     region-sync
           │                        └──────────────┤                      │     job daily
           ▼                                       │  RegionService       │
     ┌──────────────────────────────────────────┐  │   .syncAll(...)      │
     │  Postgres                                │  └──────────┬───────────┘
     │    pipeline_jobs       (canonical)       │             │ writes
     │    pipeline_executions (per-source)      │ ◄───────────┘
     └──────────────────────────────────────────┘
```

The region API container retains the GraphQL resolver only. The worker owns both the scheduling and the execution of syncs — there is one place sync runs from.

## File-level shape

### New files

- `packages/queue-provider/` — new workspace package wrapping BullMQ. Mirrors the provider-pattern (CLAUDE.md). Exports:
  - `QueueModule.forRoot({ url: REDIS_URL })` — registers a single shared `IORedis` connection
  - `QueueService` — typed `enqueue(name, payload, opts)`, `getStatus(name, jobId)`, `upsertScheduler(name, schedulerId, cron, payload)`, `close()`
  - Queue name constant `REGION_SYNC_QUEUE = 'region-sync'`
  - Type defs: `RegionSyncJobData`, `RegionSyncJobResult`
- `apps/backend/src/apps/worker/` — new nest sub-app
  - `main.ts` — bootstrap (no HTTP server; `NestFactory.createApplicationContext` plus a tiny `/healthz` Express listener on a separate port for the docker healthcheck and Prometheus scrape)
  - `worker.module.ts` — imports `RegionDomainModule` (gives us `RegionDomainService`), `QueueModule`, `MetricsModule.forRoot({ serviceName: 'region-worker' })`, `LoggingModule`
  - `region-sync.processor.ts` — the BullMQ worker. Resolves `RegionDomainService` from the Nest context; on each job updates `pipeline_jobs` row to `running`, calls `regionService.syncAll(...)`, writes the aggregate result and `finishedAt`. On throw, BullMQ retries per policy; the processor catches the final failure and marks the row `failed`.
  - `region-sync.scheduler.ts` — `OnApplicationBootstrap` hook that calls `queueService.upsertScheduler(REGION_SYNC_QUEUE, 'daily-cron', '0 2 * * *', { triggerSource: 'cron' })`. BullMQ's `JobScheduler` dedupes by id, so worker restarts don't duplicate the schedule. **Replaces** the old `RegionScheduler` entirely.
- `apps/backend/src/apps/region/src/domains/pipeline-job.service.ts` — thin wrapper around Prisma for `pipeline_jobs` CRUD + status mapping. Used by both the resolver (create on enqueue) and the worker (transition states).
- `supabase/migrations/<timestamp>_pipeline_jobs.sql` — migration creating `pipeline_jobs` and adding `pipeline_job_id` FK to `pipeline_executions`.

### Modified files

- `apps/backend/src/apps/region/src/domains/region.resolver.ts`
  - **`syncRegionData` becomes async-enqueue**: insert `pipeline_jobs` row (status `queued`, `triggerSource = 'manual'`), enqueue BullMQ job, return `RegionSyncJobModel` with `jobId` + status.
  - **New query**: `regionSyncJob(jobId: ID!): RegionSyncJobModel` — read `pipeline_jobs` row.
  - Preserves `@UseGuards(AuthGuard)` and `@Roles(Role.Admin)`. Drop `@Extensions({ complexity: 100 })` from the mutation (the new mutation is cheap) and apply it to the query if needed.
- `apps/backend/src/apps/region/src/domains/region.module.ts`
  - Remove `ScheduleModule.forRoot()` import.
  - Remove `RegionScheduler` from providers.
  - Import `QueueModule.forRootAsync(...)`.
  - Provide `PipelineJobService`.
- `apps/backend/src/apps/region/src/domains/region.scheduler.ts`
  - **Delete.** Its responsibilities split:
    - Daily cron → `apps/worker/region-sync.scheduler.ts` (repeatable BullMQ job)
    - `onModuleInit` initial-sync-on-startup → see below.
- `apps/backend/package.json`
  - Remove `@nestjs/schedule` if no other code uses it (likely the only consumer).
  - Add `build:worker` and `start:worker` scripts, mirroring `build:region` / `start:region`.
  - Add `start:worker` to `start:services` so `pnpm dev` runs it alongside the others.
- `packages/config-provider/src/index.ts`
  - Export a `redisConfig` block reading `REDIS_URL` (already in compose) and `BULLMQ_PREFIX` (defaults to `bullmq`).
  - Replace `region.syncEnabled` with `region.syncCronEnabled` (default `true` in prod, `false` in dev — see "Dev behavior" below).
- `docker-compose.yml` and `docker-compose-prod.yml`
  - Add `region-worker` service: same image as the API services, `command: pnpm start:worker` (dev) / `node dist/apps/worker/main.js` (prod). `depends_on: [redis, supabase-db]`. Same env-file pattern. Healthcheck hits the worker's `/healthz`.
- `apps/backend/nest-cli.json`
  - Register the `worker` sub-app so `nest build --tsc worker` works.
- Prometheus scrape config under `observability/prometheus/` — add `region-worker` target on its metrics port.

### Handling `onModuleInit` initial-sync-on-startup

Today, `RegionScheduler.onModuleInit` runs a full `syncAll()` every time the region service boots. In dev `nest start --watch`, that means a 25+ minute sync triggers on every code change — almost certainly not what's intended, but worth verifying with the team before deleting.

Plan:
- **Drop** the auto-sync-on-startup behavior entirely. The daily repeatable job covers the "regular sync" need.
- Replace with an explicit one-shot opt-in: env `REGION_SYNC_RUN_ON_STARTUP=true` (default `false`). When set, the worker enqueues a single `region-sync` job at bootstrap with `triggerSource = 'startup'`. Useful for prod first-deploy seeding.

If there's an environment that depends on the current restart-triggers-sync behavior (worth a five-minute audit during implementation), `REGION_SYNC_RUN_ON_STARTUP=true` recovers it on demand.

### Dev behavior

In `pnpm dev`, the worker runs but the daily cron firing at 2 AM during local hacking is annoying. Default `REGION_SYNC_CRON_ENABLED=false` in dev `.env` so the scheduler skips `upsertScheduler`. Engineers who need to test the cron path flip it explicitly. Prod and UAT default to `true`.

## Database schema (`pipeline_jobs`)

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
  enqueued_by     text,                      -- userId for 'manual', null for cron/startup
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

`trigger_source` distinguishes the three enqueue paths in ops queries ("which cron runs failed last week?", "did the deploy-time startup sync complete?"). `result` stores the `SyncResult[]` the resolver used to return inline.

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
  # was: returns [SyncResult!]!   (synchronous, blocking)
  # now: returns the job handle and returns immediately
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

`recentRegionSyncJobs` is a small ops affordance — without BullBoard (#654) we want a way for an admin to glance at recent cron + manual runs from the existing GraphQL playground.

**Breaking change** for any frontend code reading `syncRegionData` synchronously: the admin sync trigger UI needs a one-time update to poll `regionSyncJob`. Land inside the same PR so `develop` is never half-broken.

## Worker process details

- **Concurrency**: `BULLMQ_REGION_SYNC_CONCURRENCY=1` by default. A full `syncAll` already fans out across data types in-process. Easy to bump via env once per-host throttling lands.
- **Retry policy**: `attempts: 3`, `backoff: { type: 'exponential', delay: 30_000 }`. Safe for v1 because only HTML scrape jobs land on this queue; streaming handlers stay on the synchronous path until #652.
- **Idempotency on cron**: the repeatable job uses BullMQ's built-in scheduler-id dedupe. For belt-and-braces, the cron-triggered enqueue derives `jobId = 'cron-daily-${YYYYMMDD}'`, so a worker restart or scheduler drift within the same UTC day collapses to one job.
- **Job options**:
  - `removeOnComplete: { age: 60 * 60 * 24 * 7, count: 1000 }` — keep a week or 1k jobs in Redis for ops triage; canonical history is in `pipeline_jobs`.
  - `removeOnFail: { age: 60 * 60 * 24 * 30 }` — keep failures longer.
  - Manual enqueue uses `jobId = pipeline_jobs.id` so resolver retries dedupe.
- **Shutdown**: NestJS lifecycle hook calls `worker.close()` on SIGTERM, which lets in-flight jobs finish (up to a 30s grace). Stale jobs return to the queue after BullMQ's stalled-job watchdog.

## Observability

- **Prometheus metrics** (registered via existing `MetricsModule`):
  - `region_sync_queue_depth{status="waiting|active|delayed|failed"}` (gauge, sampled every 10s by an `@Interval` task in the worker)
  - `region_sync_job_duration_ms{trigger_source}` (histogram)
  - `region_sync_job_attempts{trigger_source,outcome}` (counter)
- **Structured logs** via `SecureLogger`. Each line includes `jobId`, `triggerSource`, `regionId`, `dataTypes`, `attempt`.
- **No BullBoard.** Operators inspect via `recentRegionSyncJobs` query or `redis-cli`. #654 covers the UI later.

## Test plan

- Unit: `region-sync.processor.spec.ts` — mocks `RegionDomainService.syncAll` to assert state transitions on success, failure, and retry exhaustion.
- Unit: `region.resolver.spec.ts` — `syncRegionData` enqueues exactly one job, sets `triggerSource = 'manual'`, returns the job handle without invoking `syncAll`.
- Unit: `region-sync.scheduler.spec.ts` — on bootstrap with `REGION_SYNC_CRON_ENABLED=true`, calls `upsertScheduler` with the daily cron; with `false`, does nothing.
- Integration: spin up Redis (`docker compose up redis`), enqueue a manual job, assert the worker processes it and `pipeline_jobs` ends `succeeded`; separately, run the scheduler bootstrap and assert a scheduler entry exists.
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
| `queue-provider` package + tests | 1 |
| Worker sub-app + processor + Nest wiring | 2 |
| Repeatable-job scheduler + tests | 0.5 |
| Migration + `PipelineJobService` + resolver / query changes | 1.5 |
| Compose + Prometheus + worker healthcheck | 0.5 |
| Frontend admin-sync UI update | 0.5 |
| Integration tests | 1.5 |
| Two-stage feature-flag rollout + cleanup PR | 1 |
| **Total** | **~8.5 days** |

Within the 30-day budget in #644, leaving room for review and rework.

## Open questions to resolve in PR review

1. **Where does `queue-provider` live?** Workspace package (`packages/queue-provider`) vs a `common/queue/` directory under `apps/backend/src`. Recommend package — aligns with the provider-pattern.
2. **`onModuleInit` audit.** Confirm no environment depends on "region service restart triggers a full sync." Five-minute check; if anything does, `REGION_SYNC_RUN_ON_STARTUP=true` recovers it.
3. **Authorization on `regionSyncJob` / `recentRegionSyncJobs` queries.** v1 picks `@Roles(Role.Admin)`; revisit alongside #629 (public API) once that's designed.
