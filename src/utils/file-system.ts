import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

/**
 * Writes a UTF-8 file after ensuring the parent directory exists.
 * @param path File path.
 * @param content File content.
 * @returns Promise resolving after write completion.
 */
export async function writeTextFile(path: string, content: string): Promise<void> {
  const absolutePath = resolve(process.cwd(), path);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, 'utf8');
}

/**
 * Writes JSON with stable indentation.
 * @param path File path.
 * @param value JSON-serialisable value.
 * @returns Promise resolving after write completion.
 */
export async function writeJsonFile(path: string, value: unknown): Promise<void> {
  await writeTextFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * Reads JSON and returns unknown for explicit validation by callers.
 * @param path File path.
 * @returns Parsed JSON value.
 */
export async function readJsonFile(path: string): Promise<unknown> {
  const absolutePath = resolve(process.cwd(), path);
  const raw = await readFile(absolutePath, 'utf8');
  return JSON.parse(raw) as unknown;
}
