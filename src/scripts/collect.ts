#!/usr/bin/env -S node
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { z } from 'zod';
import { readGraphConfig } from '../utils/config.ts';
import { formatDay, monthKey, monthRange, rangeFromDays, defaultRefreshMonths, type DateRange } from '../utils/dates.ts';
import { writeJsonFile } from '../utils/file-system.ts';
import { delay, ghApi } from '../utils/github.ts';
import { ContributionEventSchema, type ContributionEvent, type ContributionType, type GraphConfig } from '../utils/types.ts';

const ArgsSchema = z.object({
  config: z.string().default('config/contribution-graph.config.json'),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
  days: z.number().int().positive().optional(),
  verbose: z.boolean().default(false),
});

type CliArgs = z.infer<typeof ArgsSchema>;

const SearchItemSchema = z.object({
  id: z.number(),
  number: z.number(),
  html_url: z.string().url(),
  state: z.string(),
  title: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  pull_request: z.object({ url: z.string().url() }).optional(),
  repository_url: z.string().url(),
});

const SearchPageSchema = z.object({
  total_count: z.number(),
  incomplete_results: z.boolean(),
  items: z.array(SearchItemSchema),
});

const IssueCommentSchema = z.object({
  id: z.number(),
  html_url: z.string().url(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  user: z.object({ login: z.string() }).nullable(),
});

const ReviewCommentSchema = z.object({
  id: z.number(),
  html_url: z.string().url(),
  pull_request_review_id: z.number().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
  user: z.object({ login: z.string() }).nullable(),
});

const ReviewSchema = z.object({
  id: z.number(),
  html_url: z.string().url().optional(),
  submitted_at: z.string().datetime().nullable(),
  state: z.string(),
  user: z.object({ login: z.string() }).nullable(),
});

interface RepositoryRef {
  owner: string;
  repo: string;
}

interface ParsedSearchItem extends z.infer<typeof SearchItemSchema> {}

/**
 * Parses CLI arguments.
 * @param argv Process arguments.
 * @returns Validated CLI arguments.
 */
function parseArgs(argv: string[]): CliArgs {
  const values: Record<string, string | number | boolean> = {};
  for (const arg of argv) {
    if (arg === '--verbose') {
      values['verbose'] = true;
      continue;
    }
    const [key, rawValue] = arg.replace(/^--/u, '').split('=');
    if (!key || rawValue === undefined) {
      throw new Error(`Invalid argument: ${arg}`);
    }
    values[key] = key === 'days' ? Number.parseInt(rawValue, 10) : rawValue;
  }
  return ArgsSchema.parse(values);
}

/**
 * Parses owner and repository name from a REST repository URL.
 * @param repositoryUrl REST repository URL.
 * @returns Repository reference.
 */
function repositoryFromUrl(repositoryUrl: string): RepositoryRef {
  const match = /\/repos\/([^/]+)\/([^/]+)$/u.exec(repositoryUrl);
  if (!match?.[1] || !match[2]) {
    throw new Error(`Could not parse repository URL: ${repositoryUrl}`);
  }
  return { owner: match[1], repo: match[2] };
}

/**
 * Returns true when the repository should be skipped.
 * @param config Graph config.
 * @param ref Repository reference.
 * @returns Whether to skip the repository.
 */
function isExcludedRepository(config: GraphConfig, ref: RepositoryRef): boolean {
  const fullName = `${ref.owner}/${ref.repo}`;
  if (config.repositories.exclude.includes(fullName)) {
    return true;
  }
  return config.repositories.include.length > 0 && !config.repositories.include.includes(fullName);
}

/**
 * Returns a contribution weight from config.
 * @param config Graph config.
 * @param type Contribution type.
 * @returns Weight.
 */
function weight(config: GraphConfig, type: ContributionType): number {
  return config.weights[type] ?? 0;
}

/**
 * Converts an ISO timestamp to a normalised event day.
 * @param iso ISO timestamp.
 * @returns Day string.
 */
function eventDay(iso: string): string {
  return formatDay(new Date(iso));
}

/**
 * Searches GitHub issues and pull requests through REST search.
 * @param query GitHub search query.
 * @param maxItems Maximum items to return.
 * @param verbose Enable verbose logs.
 * @returns Search items.
 */
async function searchIssues(query: string, maxItems: number, verbose: boolean): Promise<ParsedSearchItem[]> {
  const response = await ghApi({
    endpoint: 'search/issues',
    paginate: true,
    verbose,
    fields: {
      q: query,
      per_page: 100,
    },
  });
  const pages = z.array(SearchPageSchema).parse(response);
  return pages.flatMap((page) => page.items).slice(0, maxItems);
}

/**
 * Fetches issue conversation comments for a specific issue or PR.
 * @param ref Repository reference.
 * @param number Issue or PR number.
 * @param verbose Enable verbose logs.
 * @returns Issue comments.
 */
async function fetchIssueComments(ref: RepositoryRef, number: number, verbose: boolean): Promise<Array<z.infer<typeof IssueCommentSchema>>> {
  const response = await ghApi({
    endpoint: `repos/${ref.owner}/${ref.repo}/issues/${number}/comments`,
    paginate: true,
    verbose,
    fields: { per_page: 100 },
  });
  return z.array(z.array(IssueCommentSchema)).parse(response).flat();
}

/**
 * Fetches inline PR review comments for a PR.
 * @param ref Repository reference.
 * @param number PR number.
 * @param verbose Enable verbose logs.
 * @returns Review comments.
 */
async function fetchReviewComments(ref: RepositoryRef, number: number, verbose: boolean): Promise<Array<z.infer<typeof ReviewCommentSchema>>> {
  const response = await ghApi({
    endpoint: `repos/${ref.owner}/${ref.repo}/pulls/${number}/comments`,
    paginate: true,
    verbose,
    fields: { per_page: 100 },
  });
  return z.array(z.array(ReviewCommentSchema)).parse(response).flat();
}

/**
 * Fetches submitted reviews for a PR.
 * @param ref Repository reference.
 * @param number PR number.
 * @param verbose Enable verbose logs.
 * @returns Pull-request reviews.
 */
async function fetchReviews(ref: RepositoryRef, number: number, verbose: boolean): Promise<Array<z.infer<typeof ReviewSchema>>> {
  const response = await ghApi({
    endpoint: `repos/${ref.owner}/${ref.repo}/pulls/${number}/reviews`,
    paginate: true,
    verbose,
    fields: { per_page: 100 },
  });
  return z.array(z.array(ReviewSchema)).parse(response).flat();
}

/**
 * Builds a contribution event and validates it.
 * @param value Event candidate.
 * @returns Valid contribution event.
 */
function event(value: Omit<ContributionEvent, 'day'> & { day?: string }): ContributionEvent {
  return ContributionEventSchema.parse({ ...value, day: value.day ?? eventDay(value.occurredAt) });
}

/**
 * Deduplicates contribution events by ID.
 * @param events Events to deduplicate.
 * @returns Deduplicated events.
 */
function dedupeEvents(events: ContributionEvent[]): ContributionEvent[] {
  return Array.from(new Map(events.map((item) => [item.id, item])).values())
    .sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.id.localeCompare(b.id));
}

/**
 * Writes daily JSONL event ledgers.
 * @param events Events to write.
 * @returns Promise resolving after write completion.
 */
async function writeDailyLedgers(events: ContributionEvent[]): Promise<void> {
  const byDay = new Map<string, ContributionEvent[]>();
  for (const item of events) {
    const current = byDay.get(item.day) ?? [];
    current.push(item);
    byDay.set(item.day, current);
  }

  for (const [day, dayEvents] of byDay.entries()) {
    const path = resolve(process.cwd(), `data/days/${day}.jsonl`);
    await mkdir(dirname(path), { recursive: true });
    const existing = await readExistingDay(path);
    const merged = dedupeEvents([...existing, ...dayEvents]);
    await writeFile(path, `${merged.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8');
  }
}

/**
 * Reads existing events from a daily ledger.
 * @param path Absolute ledger path.
 * @returns Existing events.
 */
async function readExistingDay(path: string): Promise<ContributionEvent[]> {
  try {
    const raw = await readFile(path, 'utf8');
    return raw.split('\n').filter(Boolean).map((line) => ContributionEventSchema.parse(JSON.parse(line) as unknown));
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }
}

/**
 * Collects contribution events for a date range.
 * @param config Graph config.
 * @param range Date range.
 * @param verbose Enable verbose logs.
 * @returns Contribution events.
 */
async function collectRange(config: GraphConfig, range: DateRange, verbose: boolean): Promise<ContributionEvent[]> {
  const events: ContributionEvent[] = [];
  const username = config.username;
  const authoredPrs = await searchIssues(`is:pr author:${username} created:${range.from}..${range.to} archived:false`, config.collector.maxSearchItems, verbose);
  const authoredIssues = await searchIssues(`is:issue author:${username} created:${range.from}..${range.to} archived:false`, config.collector.maxSearchItems, verbose);
  const commentedItems = await searchIssues(`commenter:${username} updated:${range.from}..${range.to} archived:false`, config.collector.maxSearchItems, verbose);
  const reviewedPrs = await searchIssues(`is:pr reviewed-by:${username} updated:${range.from}..${range.to} archived:false`, config.collector.maxSearchItems, verbose);

  for (const item of authoredPrs) {
    const ref = repositoryFromUrl(item.repository_url);
    if (isExcludedRepository(config, ref)) {
      continue;
    }
    events.push(event({
      id: `pr-opened:${item.id}`,
      type: 'pull_request_opened',
      occurredAt: item.created_at,
      updatedAt: item.updated_at,
      owner: ref.owner,
      repo: ref.repo,
      number: item.number,
      url: item.html_url,
      state: item.state,
      source: 'search/issues author is:pr',
      score: weight(config, 'pull_request_opened'),
      private: false,
    }));
  }

  for (const item of authoredIssues) {
    const ref = repositoryFromUrl(item.repository_url);
    if (isExcludedRepository(config, ref)) {
      continue;
    }
    events.push(event({
      id: `issue-opened:${item.id}`,
      type: 'issue_opened',
      occurredAt: item.created_at,
      updatedAt: item.updated_at,
      owner: ref.owner,
      repo: ref.repo,
      number: item.number,
      url: item.html_url,
      state: item.state,
      source: 'search/issues author is:issue',
      score: weight(config, 'issue_opened'),
      private: false,
    }));
  }

  const commentCandidates = dedupeSearchItems(commentedItems);
  for (const item of commentCandidates) {
    const ref = repositoryFromUrl(item.repository_url);
    if (isExcludedRepository(config, ref)) {
      continue;
    }
    await delay(config.collector.requestDelayMs);
    const comments = await fetchIssueComments(ref, item.number, verbose);
    for (const comment of comments) {
      if (comment.user?.login !== username || eventDay(comment.created_at) < range.from || eventDay(comment.created_at) > range.to) {
        continue;
      }
      events.push(event({
        id: `issue-comment:${comment.id}`,
        type: 'issue_comment',
        occurredAt: comment.created_at,
        updatedAt: comment.updated_at,
        owner: ref.owner,
        repo: ref.repo,
        number: item.number,
        url: comment.html_url,
        source: 'issues/comments',
        score: weight(config, 'issue_comment'),
        private: false,
      }));
    }

    if (item.pull_request) {
      await delay(config.collector.requestDelayMs);
      const reviewComments = await fetchReviewComments(ref, item.number, verbose);
      for (const comment of reviewComments) {
        if (comment.user?.login !== username || eventDay(comment.created_at) < range.from || eventDay(comment.created_at) > range.to) {
          continue;
        }
        events.push(event({
          id: `review-comment:${comment.id}`,
          type: 'pull_request_review_comment',
          occurredAt: comment.created_at,
          updatedAt: comment.updated_at,
          owner: ref.owner,
          repo: ref.repo,
          number: item.number,
          url: comment.html_url,
          source: 'pulls/comments',
          score: weight(config, 'pull_request_review_comment'),
          private: false,
        }));
      }
    }
  }

  for (const item of dedupeSearchItems(reviewedPrs)) {
    const ref = repositoryFromUrl(item.repository_url);
    if (isExcludedRepository(config, ref)) {
      continue;
    }
    await delay(config.collector.requestDelayMs);
    const reviews = await fetchReviews(ref, item.number, verbose);
    for (const review of reviews) {
      if (review.user?.login !== username || !review.submitted_at || eventDay(review.submitted_at) < range.from || eventDay(review.submitted_at) > range.to) {
        continue;
      }
      events.push(event({
        id: `review:${review.id}`,
        type: 'pull_request_review_submitted',
        occurredAt: review.submitted_at,
        owner: ref.owner,
        repo: ref.repo,
        number: item.number,
        url: review.html_url ?? item.html_url,
        state: review.state,
        source: 'pulls/reviews',
        score: weight(config, 'pull_request_review_submitted'),
        private: false,
      }));
    }
  }

  await writeJsonFile(`cache/months/${monthKey(range.from)}/collect-${range.from}_${range.to}.json`, {
    range,
    generatedAt: new Date().toISOString(),
    counts: {
      authoredPrs: authoredPrs.length,
      authoredIssues: authoredIssues.length,
      commentedItems: commentedItems.length,
      reviewedPrs: reviewedPrs.length,
      events: events.length,
    },
  });

  return dedupeEvents(events);
}

/**
 * Deduplicates search items by repository and number.
 * @param items Search items.
 * @returns Deduplicated search items.
 */
function dedupeSearchItems(items: ParsedSearchItem[]): ParsedSearchItem[] {
  return Array.from(new Map(items.map((item) => [`${item.repository_url}#${item.number}`, item])).values());
}

/**
 * Derives collection ranges from CLI arguments.
 * @param args CLI arguments.
 * @param config Graph config.
 * @returns Date ranges.
 */
function collectionRanges(args: CliArgs, config: GraphConfig): DateRange[] {
  if (args.from && args.to) {
    return [{ from: args.from, to: args.to }];
  }
  if (args.days) {
    return [rangeFromDays(args.days)];
  }
  return defaultRefreshMonths(config.collector.refreshPreviousMonthThroughDay).map((key) => monthRange(key));
}

/**
 * Entrypoint.
 * @returns Promise resolving after collection.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const config = await readGraphConfig(args.config);
  const ranges = collectionRanges(args, config);
  const allEvents: ContributionEvent[] = [];

  for (const range of ranges) {
    if (args.verbose) {
      console.log(`Collecting ${range.from}..${range.to}`);
    }
    const events = await collectRange(config, range, args.verbose);
    allEvents.push(...events);
  }

  await writeDailyLedgers(dedupeEvents(allEvents));
  console.log(`Collected ${dedupeEvents(allEvents).length} contribution events.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown collector error.';
  console.error(message);
  process.exitCode = 1;
});
