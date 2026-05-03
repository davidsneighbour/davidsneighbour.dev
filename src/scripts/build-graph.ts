#!/usr/bin/env -S node
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { readGraphConfig } from '../utils/config.ts';
import { writeJsonFile } from '../utils/file-system.ts';
import { ContributionEventSchema, type ContributionEvent, type GraphConfig, type GraphLink, type GraphNode, type GraphPayload } from '../utils/types.ts';

/**
 * Reads all daily JSONL ledgers.
 * @returns Contribution events.
 */
async function readEvents(): Promise<ContributionEvent[]> {
  const directory = join(process.cwd(), 'data/days');
  let files: string[] = [];
  try {
    files = await readdir(directory);
  } catch (error: unknown) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const events: ContributionEvent[] = [];
  for (const file of files.filter((item) => item.endsWith('.jsonl')).sort()) {
    const raw = await readFile(join(directory, file), 'utf8');
    for (const line of raw.split('\n').filter(Boolean)) {
      events.push(ContributionEventSchema.parse(JSON.parse(line) as unknown));
    }
  }
  return events;
}

/**
 * Sanitises a private repository event for public output.
 * @param config Graph config.
 * @param event Contribution event.
 * @returns Sanitised event or undefined when excluded.
 */
function sanitiseEvent(config: GraphConfig, event: ContributionEvent): ContributionEvent | undefined {
  if (!event.private || config.privacy.publishPrivateRepositories) {
    return event;
  }
  if (!config.privacy.anonymisePrivateRepositories) {
    return undefined;
  }
  return {
    ...event,
    owner: 'private',
    repo: 'private-repository',
    url: undefined,
  };
}

/**
 * Gets a configured colour for an owner.
 * @param config Graph config.
 * @param owner Owner login.
 * @returns CSS colour value.
 */
function ownerColor(config: GraphConfig, owner: string): string {
  return config.clusterColors[owner] ?? config.clusterColors['external'] ?? '#64748b';
}

/**
 * Creates a node map and edge list from events.
 * @param config Graph config.
 * @param events Contribution events.
 * @returns Graph payload.
 */
function buildPayload(config: GraphConfig, events: ContributionEvent[]): GraphPayload {
  const rootId = `root:${config.username}`;
  const nodes = new Map<string, GraphNode>();
  const links = new Map<string, GraphLink>();
  const repoScores = new Map<string, number>();
  const repoCounts = new Map<string, number>();

  nodes.set(rootId, {
    id: rootId,
    label: config.username,
    type: 'root',
    radius: 28,
    score: 0,
    color: ownerColor(config, config.username),
    private: false,
    contributionCount: 0,
  });

  for (const item of events) {
    const clusterId = `cluster:${item.owner}`;
    const repoId = `repo:${item.owner}/${item.repo}`;

    if (!nodes.has(clusterId)) {
      nodes.set(clusterId, {
        id: clusterId,
        label: item.owner,
        type: 'cluster',
        owner: item.owner,
        radius: 18,
        score: 0,
        color: ownerColor(config, item.owner),
        private: item.private,
        contributionCount: 0,
      });
    }

    if (!nodes.has(repoId)) {
      nodes.set(repoId, {
        id: repoId,
        label: item.repo,
        type: 'repo',
        owner: item.owner,
        repo: item.repo,
        radius: 8,
        score: 0,
        color: ownerColor(config, item.owner),
        private: item.private,
        contributionCount: 0,
      });
    }

    const rootLinkId = `${rootId}->${clusterId}`;
    const repoLinkId = `${clusterId}->${repoId}`;
    links.set(rootLinkId, { source: rootId, target: clusterId, weight: (links.get(rootLinkId)?.weight ?? 0) + 1 });
    links.set(repoLinkId, { source: clusterId, target: repoId, weight: (links.get(repoLinkId)?.weight ?? 0) + item.score });

    repoScores.set(repoId, (repoScores.get(repoId) ?? 0) + item.score);
    repoCounts.set(repoId, (repoCounts.get(repoId) ?? 0) + 1);
  }

  for (const [repoId, score] of repoScores.entries()) {
    const node = nodes.get(repoId);
    if (!node) {
      continue;
    }
    node.score = score;
    node.contributionCount = repoCounts.get(repoId) ?? 0;
    node.radius = Math.max(8, Math.min(42, 8 + Math.sqrt(score) * 4));
  }

  for (const node of nodes.values()) {
    if (node.type !== 'cluster') {
      continue;
    }
    const ownedScores = Array.from(repoScores.entries())
      .filter(([repoId]) => repoId.startsWith(`repo:${node.owner}/`))
      .reduce((total, [, score]) => total + score, 0);
    node.score = ownedScores;
    node.radius = Math.max(16, Math.min(36, 14 + Math.sqrt(ownedScores) * 2.5));
  }

  return {
    generatedAt: new Date().toISOString(),
    defaultDays: config.defaultDays,
    nodes: Array.from(nodes.values()),
    links: Array.from(links.values()),
    events: events.map((item) => ({
      day: item.day,
      owner: item.owner,
      repo: item.repo,
      type: item.type,
      score: item.score,
      private: item.private,
    })),
  };
}

/**
 * Entrypoint.
 * @returns Promise resolving after graph payload write.
 */
async function main(): Promise<void> {
  const config = await readGraphConfig();
  const rawEvents = await readEvents();
  const events = rawEvents.map((item) => sanitiseEvent(config, item)).filter((item): item is ContributionEvent => item !== undefined);
  const payload = buildPayload(config, events);
  await writeJsonFile('public/data/graph.json', payload);
  await writeJsonFile('public/data/site-config.json', {
    username: config.username,
    defaultDays: config.defaultDays,
    clusterColors: config.clusterColors,
    generatedAt: payload.generatedAt,
  });
  console.log(`Built graph payload with ${payload.nodes.length} nodes and ${payload.links.length} links.`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown graph build error.';
  console.error(message);
  process.exitCode = 1;
});
