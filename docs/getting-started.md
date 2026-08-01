# Getting Started with the Region Config CLI

This guide helps you set up your machine and run the region config CLI for the first time.

## What the CLI does

The CLI is a set of tools that help you build and verify region configuration files before they go live. You do not need to understand code to use it — just follow the steps below.

## Prerequisites

### 1. Install Node.js

Download and install **Node.js 20 or later** from [nodejs.org](https://nodejs.org). Choose the LTS version.

To verify installation, open Terminal and run:

```bash
node --version
```

You should see `v20.x.x` or higher. (CI runs on Node 20.)

### 2. Install pnpm

In Terminal, run:

```bash
npm install -g pnpm
```

### 3. Install Ollama

Ollama runs the AI model locally on your machine. It is required for the `config-region --test` command. If your machine already runs an Opus Populi node, Ollama is already installed and running — skip to pulling the model.

1. Download from [ollama.com](https://ollama.com) and install the app.
2. Open Ollama (on macOS it will appear in your menu bar).
3. Pull the AI model used for analysis:

```bash
ollama pull qwen3.5:9b
```

This downloads about 6 GB and only needs to be done once.

#### Machine notes

- **Memory**: 16 GB of RAM is a comfortable minimum for the default `qwen3.5:9b` model; 32 GB or more gives it room alongside other work. If your machine has less, override with a smaller model via `OLLAMA_MODEL=<other-model>` (see the [CLI reference](./cli-reference.md)) — analysis quality is somewhat lower, but every command still works.
- **GPU**: Apple Silicon and discrete GPUs make analysis fast (seconds per page). CPU-only machines work too — expect minutes per page instead.
- **Disk**: budget roughly 10 GB for Ollama plus the model.

These figures are practical guidance for the current CLI. Measured requirements (including per-county wall-clock on reference hardware) will be published with the jurisdiction onboarding agent's eval harness — see [#62](https://github.com/OpusPopuli/opuspopuli-regions/issues/62).

### 4. Clone the regions repository

```bash
git clone https://github.com/OpusPopuli/opuspopuli-regions.git
cd opuspopuli-regions
```

### 5. Install dependencies

```bash
pnpm install
```

## Verify the CLI works

Run:

```bash
pnpm cli --help
```

You should see:

```
Usage: region-cli [options] [command]

Opus Populi region config authoring tools

Commands:
  check-urls [path]          Check HTTP reachability of all data source URLs
  validate-extraction [path] Check whether required fields are detectable
  config-region [options]    Analyze a URL and optionally create a config file
  review [path]              Review existing configs against live pages
```

## Next steps

- **[Creating a county config](./creating-a-county-config.md)** — step-by-step walkthrough for adding a new county
- **[CLI reference](./cli-reference.md)** — full command reference with all options

## Getting help

If you get an error or something unexpected, note the exact error message and reach out to the platform team.
