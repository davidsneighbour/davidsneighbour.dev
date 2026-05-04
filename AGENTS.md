# AGENTS.md

## Project summary

This repository builds a static Astro website that visualises GitHub contribution activity for `davidsneighbour` as an Obsidian-style graph. The graph connects the main user account, configured organisations, external owners, and repositories. Node size reflects contribution weight. Links show the relationship between the account or organisation cluster and the repositories where activity happened.

The site is intended to be rebuilt and published once per day. Data is collected before the Astro build, transformed into static JSON payloads, copied into the final `dist/` output, and then served by GitHub Pages.

## Core intent

The project should answer: "Where did `davidsneighbour` contribute recently, and how strongly?"

The default view should show the past 28 days. The implementation should also support configurable time windows, including a custom number of days or explicit date periods.

## Data model

Contribution events should be normalised into one internal event shape before graph generation. Important contribution types include:

* commits
* issues
* pull requests
* pull request reviews
* comments, if collected

Each event should contain enough data to identify:

* contribution type
* date/time
* owner
* repository
* repository full name
* source URL
* stable event ID
* contribution weight

The graph payload is generated from these events and should contain:

* `nodes`: users, organisations, external owners, and repositories
* `links`: connections between owners/users and repositories

## GitHub collection strategy

Use GitHub REST API calls through `gh api` where possible. Avoid direct `curl` calls unless there is a specific reason.

The collector should use cached monthly data to keep API requests low:

* archive complete months as reusable cache files
* refresh the current month during daily collection
* during the first few days of a new month, refresh both the current and previous month
* rebuild the public graph payload from cached data

PRs, issues, reviews, and comments can usually be collected through search and repository-specific endpoints. Commits require a separate repository-based collector. For commits, query known repositories with the GitHub commits endpoint using `author`, `since`, and `until`, and deduplicate by SHA. This is necessary because direct commits to owned repositories are not covered by issue or pull request search.

## Repository inventory

The repository inventory should be built from:

* the configured username, currently `davidsneighbour`
* configured owned organisations
* configured tracked external repositories
* repositories found through collected PRs, issues, reviews, and comments

Owned organisations and owned repositories should connect back to `davidsneighbour`. External owners that are not configured as owned/member organisations should also connect through `davidsneighbour` so the visual structure remains centred on the user.

## Configuration

Commit `config/contribution-graph.config.json` to the repository. It is source configuration and should define things such as:

* username
* owned organisations
* explicitly tracked repositories
* external repositories
* cluster colours
* contribution weights
* default date range
* cache/archive rules

Do not commit raw API cache files unless there is a deliberate reason. Raw cache can contain private metadata, create noisy diffs, and become stale.

## Generated data

The public graph data should be available in the final static build under:

* `data/graph.json`
* `data/site-config.json`, if used by the frontend

When the site is deployed under a GitHub Pages project base path, frontend code must resolve data URLs through Astro's base URL. Do not hard-code `/data/graph.json` in browser code. Use this pattern instead:

```ts
const graphDataUrl = new URL("data/graph.json", import.meta.env.BASE_URL).toString();
```

The same applies to any other public JSON file.

## Build and deployment

The expected build flow is:

```text
npm run data:collect
npm run data:graph
npm run build
```

The daily GitHub Actions workflow should:

* install exact dependencies
* authenticate `gh`
* collect or refresh contribution data
* build graph JSON
* run the Astro static build
* upload the complete `dist/` folder as the Pages artifact

The artifact must include both the website assets and the generated `data/` JSON files.

## Astro and Tailwind conventions

This is an Astro and Tailwind project. Use strict TypeScript and avoid `any`. Prefer Zod for runtime validation of configuration, API responses, cache files, and generated graph payloads.

Use the project's semantic typography split:

* `type-ui` for interface and layout typography
* `type-reading` for article/prose typography

Apply `type-ui` on the `body` tag as the default typography wrapper. Use `type-reading` only for prose-heavy sections. If UI components are placed inside `type-reading`, explicitly re-apply `type-ui` to prevent prose styles leaking into controls.

## Dependency policy

Do not use `"latest"` in `package.json`. Pin exact versions for Astro, Vite-related packages, Tailwind, TypeScript, D3, and Zod. This project has previously hit a Tailwind/Vite build failure caused by dependency drift.

Recommended `.npmrc` settings:

```text
save-exact=true
engine-strict=true
```

## Security notes

Do not run builds with verbose Vite/Astro debug output in environments containing secrets. Debug logs may print resolved environment variables, including API tokens.

Treat any token printed into logs as compromised and rotate it.

Use the established GitHub token environment variables where available. Prefer the least-privileged token that can read the repositories being analysed.

## Known pitfalls

* A successful `data:graph` step does not guarantee the deployed site can load data. Check that JSON files are present in `dist/data/` and that frontend fetch URLs respect `import.meta.env.BASE_URL`.
* PR, issue, and review collection does not include direct commits. Add or maintain a dedicated commits collector.
* GitHub commit attribution depends on author email association with the GitHub account. The collector may need configured fallback author emails.
* Raw cache should stay out of version control unless intentionally published.
* GitHub Pages project sites require special care with base paths.

## Useful verification commands

```bash
npm run data:collect
npm run data:graph
npm run build
```

After a build, verify these files exist:

```text
dist/data/graph.json
dist/data/site-config.json
```

For a GitHub Pages project deployment, verify the published URLs include the repository base path, for example:

```text
https://davidsneighbour.github.io/davidsneighbour.dev/data/graph.json
```

## Agent working rules

When modifying this project:

* keep the collector, cache, graph builder, and frontend rendering responsibilities separate
* validate all external data before using it
* preserve strict TypeScript settings
* avoid `any`
* prefer Zod schemas for config and JSON payloads
* keep generated/raw cache data out of commits unless explicitly requested
* ensure browser code works with Astro's `base` setting
* avoid hard-coded absolute URLs for local project data
* keep documentation short, direct, and operational
