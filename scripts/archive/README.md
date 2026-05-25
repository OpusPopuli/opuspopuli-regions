# scripts/archive

One-off scripts that have already run their course but are kept for git history reference. **Do not re-run** these without confirming they're still needed — most assume a specific repo state that no longer matches main.

| Script | Ran | Purpose |
|---|---|---|
| `fix-representatives.ts` | 2026-05 | Batch-updated all 58 California county `representatives` data sources to match Sonoma quality (county-specific `externalId` rules, AI-generated hints, version bump to 0.2.0). Effectively the seed pass for #22's regions-side audit. |
