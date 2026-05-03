import { spawn } from 'node:child_process';

export interface GhApiOptions {
  endpoint: string;
  fields?: Record<string, string | number | boolean>;
  paginate?: boolean;
  method?: 'GET' | 'POST';
  verbose?: boolean;
}

/**
 * Resolves the token used by gh.
 * @returns Token value, if available.
 */
export function resolveGitHubToken(): string | undefined {
  return process.env['GH_TOKEN'] || process.env['GITHUB_REPOMANAGEMENT_TOKEN'] || process.env['GITHUB_TOKEN'];
}

/**
 * Calls GitHub REST through gh api and parses JSON output.
 * @param options API call options.
 * @returns Parsed JSON as unknown.
 */
export async function ghApi(options: GhApiOptions): Promise<unknown> {
  const token = resolveGitHubToken();
  const args = ['api', '--method', options.method ?? 'GET', options.endpoint];

  if (options.paginate) {
    args.push('--paginate', '--slurp');
  }

  for (const [key, value] of Object.entries(options.fields ?? {})) {
    args.push('-f', `${key}=${String(value)}`);
  }

  if (options.verbose) {
    console.log(`gh ${args.join(' ')}`);
  }

  const env = { ...process.env };
  if (token) {
    env['GH_TOKEN'] = token;
  }

  return new Promise((resolve, reject) => {
    const child = spawn('gh', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf8');
    });

    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf8');
    });

    child.on('error', (error) => {
      reject(new Error(`Failed to start gh: ${error.message}`));
    });

    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`gh api failed with exit code ${code ?? 'unknown'}: ${stderr.trim()}`));
        return;
      }

      try {
        resolve(JSON.parse(stdout) as unknown);
      } catch (error: unknown) {
        const message = error instanceof Error ? error.message : 'Unknown JSON parse error.';
        reject(new Error(`Could not parse gh api JSON output: ${message}\n${stdout.slice(0, 500)}`));
      }
    });
  });
}

/**
 * Sleeps for the requested amount of milliseconds.
 * @param milliseconds Delay in milliseconds.
 * @returns Promise resolving after delay.
 */
export async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}
