# GitHub contribution graph

Static website collecting GitHub contributions through `gh api`, stores normalised daily JSONL ledgers plus monthly cache files, and renders an Obsidian-style contribution graph with Astro, Tailwind CSS, and D3.

## What this repository does

* Collects authored pull requests, authored issues, comments, inline pull-request review comments, and submitted pull-request reviews.
* Uses `gh api` instead of `curl` or `wget` for GitHub REST API calls.
* Stores raw-ish monthly cache files under `cache/months/YYYY-MM/`.
* Stores normalised contribution events under `data/days/YYYY-MM-DD.jsonl`.
* Builds a public graph payload under `public/data/graph.json`.
* Publishes a static site through a custom GitHub Pages workflow.
* Defaults the graph UI to the last 28 days.

## Requirements

* Node.js 25 or newer.
* GitHub CLI (`gh`) installed and authenticated.
* The collector uses `GH_TOKEN` first. If that is not set (which should be available via `gh` authentication), it falls back to `GITHUB_REPOMANAGEMENT_TOKEN`, then `GITHUB_TOKEN`.

## Setup

```bash
npm install
cp .env.example .env
cp config/contribution-graph.config.example.json config/contribution-graph.config.json
npm run data:collect -- --days=28 --verbose
npm run build
npm run preview
```

## Configuration

Edit `config/contribution-graph.config.json`.

Important fields:

* `username`: Your central GitHub username. Defaults to `davidsneighbour` in the example config.
* `ownedOwners`: Organisations or usernames that should be treated as your own clusters.
* `externalOwners`: Known external owners that should still get visible cluster nodes.
* `clusterColors`: Colour tokens per owner or organisation.
* `weights`: Contribution weights used to size repository nodes.
* `privacy`: Controls whether private repositories are excluded or anonymised before publication.

## Collection strategy

The default collector refreshes the current month. During the first three days of a month, it also refreshes the previous month. You can override this:

```bash
npm run data:collect -- --from=2026-04-01 --to=2026-04-30 --verbose
npm run data:collect -- --days=90
```

The collector is deliberately forward-accurate. Older authored PRs and issues backfill well. Older review activity is harder to reconstruct through REST only, so review history becomes most reliable from the day the collector starts running.

## Generated files

* `cache/months/`: API response caches and metadata.
* `data/days/`: Normalised event ledgers.
* `public/data/graph.json`: Static graph payload used by the website.
* `public/data/site-config.json`: Sanitised UI config.

## GitHub Pages

The workflow in `.github/workflows/publish.yml` runs daily, collects fresh data, builds the site, and deploys it through GitHub Pages.

Add a repository secret named `GH_COLLECTOR_TOKEN` if you need to read private repositories or repositories outside the workflow repository. The workflow maps it to `GH_TOKEN`.

## Privacy note

GitHub Pages output is public. Keep `privacy.publishPrivateRepositories` set to `false` unless you intentionally want private repository names and URLs in the published graph.
