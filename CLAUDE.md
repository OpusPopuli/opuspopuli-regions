# CLAUDE.md — opuspopuli-regions

## What this is

Declarative region configuration files published as `@opuspopuli/regions` to GitHub Packages. The main `opuspopuli` platform loads these configs at runtime to discover civic data sources — no scraper code required.

```
regions/
├── california.json    # California state civic data sources
└── federal.json       # Federal civic data sources
```

Each JSON file is validated against `schema/region-plugin.schema.json`.

## Commands

```bash
pnpm build    # Compile TypeScript
pnpm test     # Schema validation for all region configs
pnpm lint
```

## Adding or editing a region

1. Add or edit a `regions/<name>.json` file — no code changes needed.
2. Validate against the schema: `pnpm test`
3. Open a PR to `main`. CI validates schema and URL connectivity.
4. Merge → GitHub Actions publishes a new version of `@opuspopuli/regions`.
5. Bump the package version in `opuspopuli` monorepo: update `packages/region-provider/package.json` and run `pnpm install`.

## What belongs here

- Data source URLs (listing pages, detail pages, PDF archives)
- `contentGoal` descriptions (natural language — the scraping pipeline uses these for AI extraction)
- `dataType` assignments (`PROPOSITIONS`, `REPRESENTATIVES`, `MEETINGS`, `CIVICS`, etc.)
- `sourceType` assignments (`html`, `pdf_archive`, etc.)
- Extraction `hints` to guide the AI pipeline

## What does NOT belong here

- Scraper code, parsers, or data transformations — those live in `@opuspopuli/scraping-pipeline`
- Prompt template text — that lives in the private `prompt-service`
- Application logic of any kind

## Publishing

Merge to `main` triggers CI which publishes to GitHub Packages automatically. The package version follows the tag set in `package.json`. Use `pnpm version patch|minor|major` to bump before merging if the change warrants a version increment.

After publishing, update `@opuspopuli/regions` in the main monorepo and commit the lockfile change.

## Schema

`schema/region-plugin.schema.json` is the canonical contract. All region configs must pass JSON Schema validation. Run `pnpm test` to verify — CI will reject configs that fail validation.
