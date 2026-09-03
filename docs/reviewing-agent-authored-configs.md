# Reviewing Agent-Authored Config PRs

Some PRs to this repo are opened by the jurisdiction onboarding flow (`create-op-node onboard`) rather than written by hand. This guide is for maintainers reviewing them. Design background: [#62](https://github.com/OpusPopuli/opuspopuli-regions/issues/62).

## What these PRs are

An operator ran the onboarding agent on their own node, **interactively confirmed every data source** in the wizard, and their node is already ingesting with this config. At the end they opted in to sharing it with the federation — that opt-in is this PR.

Two consequences frame the review:

- **The config is field-tested.** It passed schema validation, connectivity checks, and a human review by the person who knows the jurisdiction best. You are not the first pair of eyes.
- **Your gate protects the commons, not their node.** Their node runs this config whether or not the PR merges. The review question is: _should every other node be offered this config?_ — not _does this work?_

## What the PR body carries

- **Provenance per source** — how each URL was found (bundled seed data, vendor fingerprint match, operator-supplied) and the agent's confidence.
- **The not-found list** — data types the agent could not locate, stated explicitly.

Configs themselves stay schema-clean: provenance never appears as config fields. If it does, that's a defect — request it be dropped.

## Review checklist

Automated (CI must be green before you look further):

1. **Schema validation** — `pnpm test` gate.
2. **Hierarchy checks** — `parentRegionId` exists; county `fipsCode` starts with the state prefix.
3. **Connectivity** — informational; a red URL check is worth a comment but doesn't block on its own (government sites flap).

Human judgment:

4. **Domains are official.** Every URL should be a government domain or a known civic-platform vendor (Legistar/Granicus, PrimeGov, CivicClerk, NetFile, and peers). A lookalike or scraped-content mirror domain is a hard reject.
5. **Provenance reads plausibly.** "Fingerprint match" sources should look like that vendor's URL structure. Operator-supplied sources deserve a slightly closer look — open them.
6. **The not-found list makes sense for the jurisdiction.** Campaign finance missing in a state we've never covered: expected. Meetings missing for a large county: suspicious — say so in review.
7. **Spot-check two or three sources.** Open the URL; does the `dataType` match what's actually there, and does the `contentGoal` describe the page's real content (and mention the fields extraction needs)?
8. **Conventions hold.** New county configs start at version `0.1.0`; naming and layout follow `regions/<state>/counties/<county>/<county>.json`.
9. **First config for a new state?** It must arrive with (or after) the state-level config, and deserves the closest review — it seeds the pattern every later county in that state inherits.

## What you do not need to do

Re-verify every field on every source. The operator confirmed each one interactively against their local knowledge, and their node's ingestion is exercising the config daily. Focus on the commons-level questions above.

## On merge

CI publishes a new `@opuspopuli/regions` version. Other nodes pick the config up on their next dependency bump — and the contributing operator's sources enrich the fingerprint corpus for the next new jurisdiction.
