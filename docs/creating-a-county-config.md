# Creating a County Config

This guide walks through adding a new California county to the platform, step by step. The example uses Santa Cruz County.

## Before you start

Make sure you have completed [Getting Started](./getting-started.md) and that Ollama is running (look for it in your menu bar).

## Step 1: Find the county's government websites

You need to locate the official web pages for:

- **Board of Supervisors** (representatives)
- **Meeting calendar or agenda archive** (meetings)
- **Ballot measures** (propositions)
- **Campaign finance disclosures** (campaign_finance, if available)

Search for: `[County Name] County Board of Supervisors official website`

Write down each URL — you'll need them in Step 3.

## Step 2: Check that the URLs are live

Run `check-urls` to confirm each page is reachable before you do any analysis:

```bash
pnpm cli check-urls ./regions/california/counties/santa-cruz/
```

If the directory doesn't exist yet, test individual URLs:

```bash
pnpm cli check-urls
```

This checks all configs. Or pass a specific file path once you've created it.

A green `200` means the page is reachable. A red `404` or `ERR` means the URL is wrong or the page has moved — find the correct URL before continuing.

## Step 3: Analyze each URL

For each URL, run `config-region --test` to see what the AI can detect:

```bash
pnpm cli config-region \
  --url "https://www.santacruz.ca.gov/your-government/elected-officials/board-of-supervisors" \
  --dataType representatives \
  --test
```

The output will show:

- Whether the page fetched successfully
- What headings, images, and contact patterns the tool detected
- Which required fields are likely present (✓) or need attention (⚠)
- A suggested `dataSource` JSON block to paste into your config

**Pay close attention to ⚠ warnings**, especially:

- `externalId — NOT inferrable` — this is expected and normal. You must add an explicit construction rule to `contentGoal`, such as: *"construct externalId as 'california-santa-cruz-supervisor-{district}'"*
- `photoUrl — relative URLs found` — add this hint: *"photo URLs are relative; resolve against the base URL"*

## Step 4: Create the config file

Once you have analyzed at least one URL and reviewed the suggested config block, create the file:

```bash
pnpm cli config-region \
  --url "https://www.santacruz.ca.gov/your-government/elected-officials/board-of-supervisors" \
  --dataType representatives \
  --state california \
  --county santa-cruz \
  --fips 06087 \
  --test --init
```

This will:
1. Analyze the URL with AI
2. Create `regions/california/counties/santa-cruz/santa-cruz.json`
3. Validate it against the schema
4. Print the file path

## Step 5: Edit the config file

Open the file in any text editor:

```
regions/california/counties/santa-cruz/santa-cruz.json
```

For each data source:

1. **Review `contentGoal`** — make sure it mentions every field you expect and includes the `externalId` construction rule.
2. **Add `hints`** — if the AI didn't generate good hints, or if you can see the page structure, add 2–4 specific hints about where to find the data.
3. **Add more data sources** — repeat Step 3 for meetings, propositions, and campaign_finance URLs, then add their suggested blocks to `dataSources`.

### Example of a good `contentGoal` for representatives:

```json
"contentGoal": "Extract Santa Cruz County Board of Supervisors members — name, district number, photo URL, phone, email, and profile page link. Construct externalId as 'california-santa-cruz-supervisor-{district}' using the district number."
```

### Example of good `hints`:

```json
"hints": [
  "Supervisors are listed in .supervisor-cards .card elements",
  "Each card has .card-title for name and .card-district for district number",
  "Photo URLs are relative — resolve against https://www.santacruz.ca.gov",
  "externalId: construct as 'california-santa-cruz-supervisor-{district}'"
]
```

## Step 6: Check field detectability

After editing the file, run `validate-extraction` to confirm the required fields are likely detectable:

```bash
pnpm cli validate-extraction ./regions/california/counties/santa-cruz/santa-cruz.json
```

Review any remaining ⚠ warnings. For fields that truly cannot be auto-detected (like `externalId`), the warning is expected — just confirm you have a construction rule in `contentGoal`.

## Step 7: Validate the schema

Run the built-in test suite to confirm the JSON is valid:

```bash
pnpm test
```

All tests should pass. If you see a validation error, check the error message — it will tell you exactly which field is wrong (for example, a malformed URL or a missing required field).

You don't actually have to wait for `pnpm test` to catch a typo. Every CLI command (`check-urls`, `review`, `validate-extraction`, `config-region`) validates every config it loads — if your edit breaks the schema, the next CLI run throws with the file path and the specific schema errors. Same for JSON-syntax mistakes (a stray comma, an unterminated string): the error tells you which file is broken.

## Step 8: Open a pull request

```bash
git checkout -b feat/[county-name]-config
git add regions/california/counties/santa-cruz/
git commit -m "feat(region): add Santa Cruz County config"
git push -u origin feat/[county-name]-config
```

Then open a pull request to `main` on GitHub. CI will validate the schema and check URL connectivity. Once approved and merged, the config goes live automatically.

## Common problems

| Problem | Fix |
|---|---|
| `check-urls` shows 403 for a government site | Some sites block automated requests. Try the URL in a browser — if it works, add a `rateLimitOverride` to the data source. |
| AI suggests wrong CSS selectors | Add a `staticManifest` with the correct selectors, or improve `hints` with exact class names you can see in the page source. |
| `validate-extraction` warns about all fields | The page may require JavaScript to render. Note this in `contentGoal` hints. |
| Schema validation fails with "must be uri" | The URL has a typo or uses `http` where `https` is required. |
| `JSON parse failed for ...` | The JSON file has a syntax error — a stray comma, an unterminated string, missing closing brace. The error message names the file; open it and look for an obvious typo. |
| `Schema validation failed for ...` | The JSON is parseable but doesn't match the schema. The error lists the path (e.g. `/config/dataSources/0/url`) and the issue (`must be uri`, `must have required property "version"`). Fix in place. |
| `externalId` warning won't go away | This is expected — it's always ⚠ because it must be constructed, not extracted. As long as `contentGoal` describes the construction rule, you're fine. |
