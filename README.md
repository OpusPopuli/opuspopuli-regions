# @opuspopuli/regions

Declarative region configuration files for the [Opus Populi](https://github.com/OpusPopuli/opuspopuli) civic data platform.

## Overview

Region configs define **what** civic data to collect — URLs, data types, content goals, and extraction hints — without any scraper code. The AI-powered scraping pipeline reads these configs and figures out **how** to extract the data.

## Repository Layout

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

## Adding a New Region

### Adding a state-level config

1. Create `regions/<state-name>/<state-name>.json`
2. Set `name` and `config.regionId` to the same kebab-case identifier (e.g. `"california"`)
3. Set `config.fipsCode` to the 2-digit state FIPS code (e.g. `"06"` for California)
4. Run `pnpm test` — CI will also validate on PR

### Adding a county config

1. Create `regions/<state-name>/counties/<county-name>/<county-name>.json`
2. Set `name`/`config.regionId` to `"<state>-<county>"` (e.g. `"california-alameda"`)
3. Set `config.parentRegionId` to the parent state's `regionId` (e.g. `"california"`)
4. Set `config.fipsCode` to the 5-digit county FIPS code (state 2-digit prefix + 3-digit county)
5. Run `pnpm test` — validates hierarchy references and FIPS prefix consistency

## Config Structure

Each file follows the `RegionPluginFile` schema:

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
    "stateCode": "CA",
    "fipsCode": "06",
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

**Validation rules enforced by `pnpm test`:**
- `name` must equal `config.regionId`
- Version must be valid semver
- No duplicate data sources (same `url` + `dataType` + `category`)
- Sub-regions: `parentRegionId` must reference an existing region in the repo
- County configs: `fipsCode` must start with the parent state's `fipsCode`

### Geographic Hierarchy Fields

| Field | Description |
|---|---|
| `parentRegionId` | `regionId` of the parent region. Omit for top-level (state, federal). Set to parent state's `regionId` for counties. |
| `fipsCode` | Census FIPS code: 2 digits for states (`"06"`), 5 digits for counties (`"06001"`). Used as join key for user-to-district placement. |

### Data Types

| `dataType` | Description |
|---|---|
| `propositions` | Ballot measures and initiatives |
| `representatives` | Elected officials, officeholders |
| `meetings` | Committee hearings, board meetings, floor sessions; daily journals / minutes go here with `sourceType: pdf_archive` |
| `campaign_finance` | Contribution and expenditure records |
| `lobbying` | Lobbying disclosures |
| `civics` | Region governmental structure, vocabulary, measure types, lifecycle stages — AI extracts structured shape plus a plain-language rewrite |
| `bills` | Individual legislative bills (AB, SB, etc.) BFS-crawled from an official legislature site |

### Source Types

| `sourceType` | Description | Required Config |
|---|---|---|
| `html_scrape` (default) | AI analyzes page structure, extracts with CSS selectors | `hints` |
| `bulk_download` | Downloads ZIP/CSV/TSV, parses with column mappings | `bulk` |
| `api` | Paginated REST API calls | `api` |
| `pdf` | PDF text extraction + AI analysis | `pdf` |
| `pdf_archive` | Paginated listing page → per-PDF extract; stores one Minutes record per document | `pdfArchive` |

### Detail Page Enrichment

When the pipeline extracts items with a `detailUrl` field, it fetches each detail page to enrich the item. Use `detailFields` to declare selectors explicitly (more reliable than AI guessing):

```json
{
  "url": "https://www.assembly.ca.gov/assemblymembers",
  "dataType": "representatives",
  "contentGoal": "Extract Assembly members with name, district, party, photo, and profile link",
  "detailFields": {
    "contactInfo.phone": ".member-page__card-phone",
    "contactInfo.address": ".member-page__card-address",
    "contactInfo.website": "a.member-page__link.--website|attr:href",
    "committees": {
      "selector": ".office-card",
      "children": { "name": "h3", "phone": ".phone" },
      "multiple": true
    }
  }
}
```

**Key features:**
- Dot notation for nested fields: `"contactInfo.phone"` → `item.contactInfo.phone`
- Attribute extraction: append `|attr:href` (or any attribute name) to extract an attribute instead of text
- Structured arrays: use an object with `selector`, `children`, and `multiple: true` instead of a string selector
- When `detailFields` is present, no AI call is needed for detail page extraction

### Bulk Download Options

The `bulk` config supports a `batchSize` field (default: 10,000) that controls how many records are held in memory at once:

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

Supported formats: `tsv`, `csv`, `zip_tsv`, `zip_csv`.

### PDF Archive Options

For `sourceType: pdf_archive`, configure the `pdfArchive` block:

```json
{
  "sourceType": "pdf_archive",
  "pdfArchive": {
    "linkSelector": "a[href$='.pdf']",
    "datePattern": "(\\d{2})(\\d{2})(\\d{2})",
    "dateFormat": "MMDDYY",
    "revisionPattern": "-R(\\d+)\\.pdf$",
    "maxPages": 10,
    "maxNew": 10,
    "paginationParam": "page"
  }
}
```

`maxNew` caps new documents ingested per sync cycle (cold-start protection, default 10).

### Bill Discovery Options

For `dataType: bills`, use `billDiscovery` to handle legislature sites that list per-bill nav-hub links:

```json
{
  "dataType": "bills",
  "sourceType": "html_scrape",
  "billDiscovery": {
    "navLinkPattern": "/faces/billNavClient\\.xhtml\\?bill_id=([^\"&\\s]+)",
    "statusPageTemplate": "/faces/billStatusClient.xhtml?bill_id={bill_id}",
    "votesPageTemplate": "/faces/billVotesClient.xhtml?bill_id={bill_id}",
    "textPageTemplate": "/faces/billTextClient.xhtml?bill_id={bill_id}"
  }
}
```

`textPageTemplate` is optional — when set, the sync checks the "Date Published" timestamp to skip unchanged bills.

### Crawl and LLM Options

Per-source fields that control crawl depth and LLM behavior:

| Field | Default | Description |
|---|---|---|
| `crawlDepth` | `0` | BFS hops from the seed URL (scoped to same host + path prefix, HTML only) |
| `crawlMaxPages` | `20` | Hard cap on pages visited per sync; bounds token spend |
| `llmMaxTokens` | handler default | Override max generation tokens (e.g. `32000` for a 150-term glossary) |
| `llmRequestTimeoutMs` | provider default | Override LLM request timeout in ms (civics extraction can take 15–20 min) |

## Development

```bash
pnpm install
pnpm build
pnpm test              # Schema validation + hierarchy checks (required for CI)
pnpm test:connectivity # URL reachability check (informational, non-blocking in CI)
pnpm test:all          # Both validation and connectivity
pnpm lint
```

## License

AGPL-3.0
