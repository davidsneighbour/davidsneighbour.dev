import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { GraphConfigSchema, type GraphConfig } from './types.ts';

/**
 * Reads and validates the contribution graph config.
 * @param configPath Path to the JSON config file.
 * @returns Validated graph config.
 */
export async function readGraphConfig(configPath = 'config/contribution-graph.config.json'): Promise<GraphConfig> {
  const absolutePath = resolve(process.cwd(), configPath);
  const raw = await readFile(absolutePath, 'utf8');
  const parsed: unknown = JSON.parse(raw);
  return GraphConfigSchema.parse(parsed);
}
