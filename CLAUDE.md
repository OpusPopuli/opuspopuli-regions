# CLAUDE.md — opuspopuli-regions

## What this is

Declarative region configuration files published as `@opuspopuli/regions` to GitHub Packages. The main `opuspopuli` platform loads these configs at runtime to discover civic data sources — no scraper code required.

```
regions/
├── federal.json                         # Federal (FEC, Congress)
└── california/
    ├── california.json                  # California state config
    └── counties/
        ├── alameda/alameda.json
        ├── los-angeles/los-angeles.json
        └── ...                          # All 58 CA counties
```

Each JSON file is validated against `schema/region-plugin.schema.json`.

## Commands

```bash
pnpm build             # Compile TypeScript
pnpm test              # Schema validation + hierarchy checks (required for CI)
pnpm test:connectivity # URL reachability (informational, continue-on-error in CI)
pnpm test:all          # Both validation and connectivity
pnpm lint
```

## Adding or editing a region

1. Add or edit a `regions/<state>/<state>.json` (state) or `regions/<state>/counties/<county>/<county>.json` (county) — no code changes needed.
2. Validate: `pnpm test`
3. Open a PR to `main`. CI validates schema and URL connectivity (connectivity failures don't block merge).
4. Merge → GitHub Actions publishes a new version of `@opuspopuli/regions` automatically.
5. Bump the dependency in the monorepo: update `packages/region-provider/package.json` and run `pnpm install`.

## What belongs here

- Data source URLs (listing pages, detail pages, PDF archives)
- `contentGoal` descriptions (natural language — the scraping pipeline uses these for AI extraction)
- `dataType` assignments — lowercase enum values:
  - `propositions`, `representatives`, `meetings`, `campaign_finance`, `lobbying`, `civics`, `bills`
- `sourceType` assignments — lowercase enum values:
  - `html_scrape` (default), `bulk_download`, `api`, `pdf`, `pdf_archive`
- Extraction `hints` to guide the AI pipeline
- `detailFields` for explicit CSS-selector-based detail page extraction
- `billDiscovery` config for legislature bill sites
- `pdfArchive` config for paginated PDF listing pages
- `crawlDepth` / `crawlMaxPages` for civics and other crawling sources

## What does NOT belong here

- Scraper code, parsers, or data transformations — those live in `@opuspopuli/scraping-pipeline`
- Prompt template text — that lives in the private `prompt-service`
- Application logic of any kind

## Geographic hierarchy

Sub-regions must set `parentRegionId` to their parent's `regionId`. Counties must also set a 5-digit `fipsCode` (state 2-digit prefix + 3-digit county suffix). Tests enforce that:
- `parentRegionId` references an existing region in the repo
- County `fipsCode` starts with the parent state's `fipsCode`

## Publishing

Merge to `main` triggers CI which publishes to GitHub Packages automatically. The package version is set by CI as `1.0.<github_run_number>` — do **not** manually bump `package.json` before merging (the version in `package.json` is overwritten at publish time).

After publishing, update `@opuspopuli/regions` in the main monorepo and commit the lockfile change.

## Versioning of region configs

State and county configs each have their own `version` field (semver, e.g. `"1.4.1"`). This is distinct from the npm package version. Bump the config's `version` field when the data sources for that region change significantly: data source additions = minor, breaking schema changes = major. County configs start at `0.1.0`.

## Schema

`schema/region-plugin.schema.json` is the canonical contract. All region configs must pass JSON Schema validation. Run `pnpm test` to verify — CI will reject configs that fail validation.
