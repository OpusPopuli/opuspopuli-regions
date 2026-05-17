# Getting Started with the Region Config CLI

This guide helps you set up your Mac Studio and run the region config CLI for the first time.

## What the CLI does

The CLI is a set of tools that help you build and verify region configuration files before they go live. You do not need to understand code to use it — just follow the steps below.

## Prerequisites

### 1. Install Node.js

Download and install **Node.js 18 or later** from [nodejs.org](https://nodejs.org). Choose the LTS version.

To verify installation, open Terminal and run:

```bash
node --version
```

You should see `v18.x.x` or higher.

### 2. Install pnpm

In Terminal, run:

```bash
npm install -g pnpm
```

### 3. Install Ollama

Ollama runs the AI model locally on your Mac Studio. It is required for the `config-region --test` command.

1. Download from [ollama.com](https://ollama.com) and install the app.
2. Open Ollama (it will appear in your menu bar).
3. Pull the AI model used for analysis:

```bash
ollama pull qwen2.5:7b
```

This downloads about 4.7 GB and only needs to be done once.

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
```

## Next steps

- **[Creating a county config](./creating-a-county-config.md)** — step-by-step walkthrough for adding a new county
- **[CLI reference](./cli-reference.md)** — full command reference with all options

## Getting help

If you get an error or something unexpected, note the exact error message and reach out to the platform team.
