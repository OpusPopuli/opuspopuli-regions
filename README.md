# @opuspopuli/regions

Declarative region configuration files for the [Opus Populi](https://github.com/OpusPopuli/opuspopuli) civic data platform.

## Overview

Region configs define **what** civic data to collect — URLs, data types, content goals, and extraction hints — without any scraper code. The AI-powered scraping pipeline reads these configs and figures out **how** to extract the data.

## Adding a New Region

1. Copy an existing config (e.g., `regions/california.json`) as a starting point
2. Update the region details, data sources, and content goals
3. Run `pnpm test` to validate against the JSON Schema
4. Open a PR — CI will validate your config automatically

## Config Structure

Each region config file follows the `RegionPluginFile` schema:

```json
{
  "name": "region-id",
  "displayName": "Region Name",
  "description": "Brief description",
  "version": "1.0.0",
  "config": {
    "regionId": "region-id",
    "regionName": "Region Name",
    "description": "Detailed description",
    "timezone": "America/Los_Angeles",
    "stateCode": "XX",
    "dataSources": [
      {
        "url": "https://example.gov/data",
        "dataType": "propositions",
        "contentGoal": "What to extract in natural language",
        "hints": ["Helpful context for the AI"]
      }
    ]
  }
}
```

### Source Types

| `sourceType` | Description | Required Config |
|---|---|---|
| `html_scrape` (default) | AI analyzes page structure, extracts with CSS selectors | `hints` |
| `bulk_download` | Downloads ZIP/CSV/TSV, parses with column mappings | `bulk` |
| `api` | Paginated REST API calls | `api` |
| `pdf` | PDF text extraction + AI analysis | `pdf` |

### Detail Page Enrichment

When the pipeline extracts items with a `detailUrl` field, it fetches each detail page to enrich the item with additional data (bio, contact info, committees, etc.).

By default, the AI guesses which CSS selectors to use — but this is unreliable on complex pages. Use `detailFields` to declare the selectors explicitly:

```json
{
  "url": "https://www.assembly.ca.gov/assemblymembers",
  "dataType": "representatives",
  "contentGoal": "Extract Assembly members with name, district, party, photo, and profile link",
  "detailFields": {
    "contactInfo.phone": ".member-page__card-phone",
    "contactInfo.address": ".member-page__card-address",
    "contactInfo.website": "a.member-page__link.--website|attr:href",
    "committees": ".member-page__committees"
  }
}
```

**Key features:**
- Dot notation for nested fields: `"contactInfo.phone"` → `item.contactInfo.phone`
- Attribute extraction: append `|attr:href` (or any attribute name) to extract an attribute instead of text
- When `detailFields` is present, no AI call is needed for detail page extraction

### Bulk Download Options

The `bulk` config supports a `batchSize` field (default: 10,000) that controls how many records are held in memory at once. Large files like CAL-ACCESS TSVs (millions of rows) are processed in batches to prevent OOM:

```json
{
  "bulk": {
    "format": "zip_tsv",
    "filePattern": "RCPT_CD.TSV",
    "columnMappings": { "CMTE_ID": "committeeId", "AMOUNT": "amount" },
    "batchSize": 10000
  }
}
```

See `schema/region-plugin.schema.json` for the full schema.

## Development

```bash
pnpm install
pnpm build
pnpm test              # Schema validation
pnpm test:connectivity # URL reachability (informational)
pnpm lint
```

## License

AGPL-3.0