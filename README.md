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