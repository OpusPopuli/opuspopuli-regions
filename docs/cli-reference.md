# CLI Reference

All commands are run from the root of the `opuspopuli-regions` repository:

```bash
pnpm cli <command> [options]
```

## Validation on load

Every CLI command that reads region configs (`check-urls`, `validate-extraction`, `review`, `config-region --config`) validates each file against `schema/region-plugin.schema.json` as it loads. Malformed files fail fast with the file path and the specific errors:

```
Failed to load configs from ./regions: Schema validation failed for regions/california/counties/foo/foo.json:
  /version must match pattern "^\d+\.\d+\.\d+$"
  /config/dataSources/0/url must match format "uri"
  /config must have required property "timezone"
```

JSON-syntax errors are reported the same way:

```
Failed to load configs from ./regions/...: JSON parse failed for regions/california/counties/foo/foo.json: Unexpected token } in JSON at position 412
```

You don't have to wait for `pnpm test` to catch a typo — the CLI will surface it on the next command you run.

---

## `check-urls`

Check HTTP reachability of all data source URLs in one or more region configs.

```bash
pnpm cli check-urls [path]
```

### Arguments

| Argument | Description | Default |
|---|---|---|
| `path` | Path to a `.json` config file or a directory to walk recursively | `./regions/` |

### Output

One line per URL:

```
200  245ms  [california-sonoma/representatives]  https://sonomacounty.gov/...
301  180ms  [california-alameda/meetings]  https://old.acgov.org/...  → https://www.acgov.org/...
404  95ms   [california-marin/propositions]  https://deadurl.gov/
ERR  10001ms  [california-test/civics]  https://timeout.example.gov/
     AbortError: The operation was aborted due to timeout
```

- Green = 2xx (reachable)
- Yellow = 3xx (redirect — check the final destination)
- Red = 4xx/5xx or error (URL is broken)

### Exit code

- `0` — all URLs reachable
- `1` — one or more URLs are unreachable or returned errors

### Examples

```bash
# Check all configs
pnpm cli check-urls

# Check a single county
pnpm cli check-urls ./regions/california/counties/sonoma/sonoma.json

# Check all California configs
pnpm cli check-urls ./regions/california/
```

---

## `validate-extraction`

Fetch each URL and check whether the required fields for each `dataType` are detectable in the page content. Does not require Ollama.

```bash
pnpm cli validate-extraction [path]
```

### Arguments

| Argument | Description | Default |
|---|---|---|
| `path` | Path to a `.json` config file or a directory | `./regions/` |

### Output

```
[california-sonoma / representatives]
  URL: https://sonomacounty.gov/ceo/bos/supervisors/district-1
  ✓ Fetched (24kB, 180ms)
  Page type:  detail
  Headings:   "District 1", "Supervisor Rebecca Hermosillo"
  Images:     1 found

  Required fields for 'representatives':
    ⚠ externalId        — NOT inferrable; add explicit construction rule to contentGoal
    ✓ name              — found in heading structure
    ✓ district          — found in heading structure
    ✓ phone             — (707) 565-2241
    ✓ email             — rebecca.hermosillo@sonomacounty.gov
    ⚠ photoUrl          — relative URLs found; add absolutization hint to hints[]
    ✓ detailUrl         — 12 link(s) found
```

Fields marked ✓ are detectable. Fields marked ⚠ need attention in `contentGoal` or `hints`.

**Note:** `externalId` is always ⚠ — this is expected. The AI cannot construct a synthetic ID; you must describe the construction rule in `contentGoal`.

### Exit code

- `0` — no warnings
- `1` — one or more warnings (fields may not extract correctly)

---

## `config-region`

Analyze a URL or existing config and optionally create the region config file.

```bash
pnpm cli config-region [options]
```

### Options

| Option | Description |
|---|---|
| `--url <url>` | URL to analyze |
| `--dataType <type>` | Data type: `representatives`, `meetings`, `propositions`, `campaign_finance`, `lobbying`, `civics`, `bills` |
| `--config <path>` | Path to an existing region config — tests all its data sources |
| `--state <state>` | State slug for `--init` (e.g., `california`) |
| `--county <county>` | County slug for `--init` (e.g., `santa-cruz`) |
| `--fips <code>` | 5-digit FIPS code for `--init` (e.g., `06087`) |
| `--test` | Run AI analysis via local Ollama. **Requires Ollama running.** |
| `--init` | Write the region config file to `regions/<state>/counties/<county>/` |
| `--force` | Overwrite an existing config file |

### Usage patterns

**Analyze a URL (AI analysis):**
```bash
pnpm cli config-region \
  --url "https://www.cosb.us/departments/board-of-supervisors" \
  --dataType representatives \
  --test
```

**Analyze all sources in an existing config:**
```bash
pnpm cli config-region --config ./regions/california/counties/sonoma/sonoma.json --test
```

**Create a skeleton config (no AI):**
```bash
pnpm cli config-region \
  --state california --county santa-cruz --fips 06087 \
  --init
```

**Analyze a URL and create the config file in one step:**
```bash
pnpm cli config-region \
  --url "https://www.santacruz.ca.gov/bos" \
  --dataType representatives \
  --state california --county santa-cruz --fips 06087 \
  --test --init
```

### `--test` output

When `--test` is used, the command prints static analysis followed by a suggested `dataSource` block:

```
✓ Ollama reachable at http://127.0.0.1:11434 (model: qwen2.5:7b)

Analyzing: https://www.cosb.us/departments/board-of-supervisors
  ✓ Fetched (18kB, 245ms)

  Page type:   listing
  Headings:    "Board of Supervisors", "District 1", "District 2"
  Images:      5 found

  Contact patterns:
    ✓ phone   (831) 454-2000
    ✓ email   bos@santacruzcounty.us

  Required fields for 'representatives':
    ⚠ externalId        — NOT inferrable; add explicit construction rule to contentGoal
    ✓ name              — found in heading structure
    ✓ district          — found in heading structure
    ✓ phone             — (831) 454-2000
    ✓ email             — bos@santacruzcounty.us
    ⚠ photoUrl          — relative URLs found; add absolutization hint to hints[]
    ✓ detailUrl         — 42 link(s) found

  Running AI analysis...

  Suggested data source block:
  {
    "url": "https://www.cosb.us/departments/board-of-supervisors",
    "dataType": "representatives",
    "contentGoal": "Extract Santa Cruz County Board of Supervisors members ...",
    "hints": [
      "Supervisors are in .supervisor-list .supervisor-item containers",
      ...
    ]
  }
```

### `--init` behavior

- Creates `regions/<state>/counties/<county>/` if it does not exist
- Writes `<county>.json` with the generated config (or a placeholder skeleton if `--test` was not passed)
- Validates against `schema/region-plugin.schema.json` before writing — aborts if validation fails
- Refuses to overwrite an existing file without `--force`

### Exit code

- `0` — success
- `1` — error (fetch failed, Ollama unreachable, schema validation failed, file exists without `--force`)

---

## `review`

Review existing region configs against live pages. Checks that `staticManifest` and `detailFields` selectors still match the current page, and that `contentGoal` + `hints` mention all required fields for each `dataType`. Does not require Ollama unless `--test` is passed.

```bash
pnpm cli review [path]
```

### Arguments

| Argument | Description | Default |
|---|---|---|
| `path` | Path to a `.json` config file or a directory to walk recursively | `./regions/` |

### Options

| Option | Description |
|---|---|
| `--test` | Also run a fresh Ollama AI analysis and show the suggested update alongside the existing config |

### What it checks

**Without `--test` (no Ollama required):**
- Fetches each data source URL and confirms it's reachable
- For data sources with a `staticManifest`: verifies `containerSelector`, `itemSelector`, and each `fieldMapping.selector` still match elements on the live page
- For data sources with `detailFields`: verifies each CSS selector (before the `|` pipe) still matches elements on the live page
- Checks that all required field names for the `dataType` appear in `contentGoal` or `hints`
- Checks that an `externalId` construction rule is present (looks for "construct" in any text, or an `externalId` fieldMapping in `staticManifest`)

**With `--test`:** runs a fresh Ollama structural analysis and prints the suggested updated config block so you can compare it to the stored one.

### Output

```
[california-sonoma / representatives]  v0.8.1
  https://sonomacounty.gov/...
  ✓ Fetched (18kB, 245ms)

  Selector check:
    ✓ staticManifest.containerSelector  ".tray-profile"  2 match(es)
    ✗ staticManifest.itemSelector       ".box-profile"   0 matches — selector stale or page restructured
    ✓ staticManifest.name               "img"            2 match(es)

  contentGoal + hints coverage:
    ✓ externalId    — handled by staticManifest
    ✓ name          — mentioned
    ⚠ photoUrl      — not found in contentGoal or hints

  ⚠ NEEDS REVIEW (2 issue(s))

All 232 data source(s) look good.
```

### When to run

- Before bumping a county config's version after field-validation
- Quarterly, to catch government websites that have been redesigned
- In CI on a scheduled basis (connectivity failures don't block PRs, but selector staleness should be investigated)

### Exit code

- `0` — all configs look good
- `1` — one or more data sources have selector or coverage issues

---

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `OLLAMA_BASE_URL` | `http://127.0.0.1:11434` | Ollama server URL |
| `OLLAMA_MODEL` | `qwen3.5:9b` | Model name to use for AI analysis |

### Example with custom Ollama settings

```bash
OLLAMA_BASE_URL=http://192.168.1.100:11434 OLLAMA_MODEL=llama3.2 pnpm cli config-region --url ... --test
```
