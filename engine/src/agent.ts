/**
 * Bring-your-own-agent layer. One interface, multiple backends, so adding a
 * provider is a small adapter rather than a feature rewrite.
 *
 * Ported from `src-tauri/src/agent/mod.rs`: the interface, the `Manual`
 * fallback, and the local-CLI backend that shells out to an agent the user has
 * already installed (`claude`, `codex`, `aider`, ...).
 */

import { spawn } from 'node:child_process';

export interface PrDraft {
  title: string;
  body: string;
}

export interface Agent {
  /** Draft a commit message from a unified diff. */
  commitMessage(diff: string): Promise<string>;
  /** Draft a PR title and body from a set of commit summaries. */
  prDraft(commits: string[]): Promise<PrDraft>;
}

/** No-op backend: the user writes their own text. */
export const manual: Agent = {
  commitMessage: async () => '',
  prDraft: async () => ({ title: '', body: '' }),
};

/**
 * Run a CLI agent, piping `input` to stdin and returning trimmed stdout.
 *
 * On Windows we go through `cmd.exe` so npm-installed shims (`claude.cmd`,
 * `codex.cmd`) resolve from PATH.
 */
function runCli(cmd: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child =
      process.platform === 'win32'
        ? spawn('cmd', ['/C', cmd], { windowsHide: true })
        : (() => {
            const parts = cmd.split(/\s+/).filter(Boolean);
            return spawn(parts[0] ?? 'sh', parts.slice(1), { windowsHide: true });
          })();

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (c: Buffer) => stdout.push(c));
    child.stderr.on('data', (c: Buffer) => stderr.push(c));

    child.on('error', (e) => reject(new Error(`could not start agent '${cmd}': ${e.message}`)));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`agent '${cmd}' failed: ${Buffer.concat(stderr).toString('utf8').trim()}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString('utf8').trim());
    });

    child.stdin.on('error', () => {}); // agent may exit before reading all input
    child.stdin.end(input);
  });
}

/** Strip the wrapping an LLM tends to add around a one-line answer. */
function unwrap(s: string): string {
  return s
    .trim()
    .replace(/^`+|`+$/g, '')
    .replace(/^"+|"+$/g, '')
    .trim();
}

/**
 * Generate a commit message from a staged diff using a local CLI agent
 * (defaults to `claude -p`, which reads the prompt from stdin).
 */
export async function generateMessage(diff: string, cmd = 'claude -p'): Promise<string> {
  const prompt =
    'Write a single concise git commit message for the staged diff below. ' +
    'Use conventional-commits style (for example, "fix(auth): handle expired token"). ' +
    'Output ONLY the commit message text: no preamble, no quotes, no code fences.\n\n' +
    diff;
  return unwrap(await runCli(cmd, prompt));
}
