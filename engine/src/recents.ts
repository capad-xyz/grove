/**
 * Recently opened repositories, persisted between sessions.
 *
 * Ported from the `recent_repos` / `add_recent_repo` commands in `lib.rs`. The
 * Rust version got its directory from Tauri's `app_config_dir`; here the caller
 * supplies it (Electron would pass `app.getPath('userData')`), with a
 * platform-appropriate default so the engine stays usable headless.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { RecentRepo } from './types.ts';

const MAX_RECENTS = 10;

/** Default per-platform config directory, mirroring Tauri's `app_config_dir`. */
export function defaultConfigDir(): string {
  if (process.platform === 'win32') {
    return join(process.env['APPDATA'] || join(homedir(), 'AppData', 'Roaming'), 'grove');
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', 'grove');
  }
  return join(process.env['XDG_CONFIG_HOME'] || join(homedir(), '.config'), 'grove');
}

/** Normalize a path for comparison so "C:\\x" and "C:/x/" dedupe as one. */
export function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

export class Recents {
  readonly #file: string;

  constructor(configDir: string = defaultConfigDir()) {
    this.#file = join(configDir, 'recents.json');
    try {
      mkdirSync(configDir, { recursive: true });
    } catch {
      // Read/write below degrade to empty; a missing config dir is not fatal.
    }
  }

  /** Read the list, collapsing any duplicates already stored (first wins). */
  list(): RecentRepo[] {
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(this.#file, 'utf8'));
    } catch {
      return [];
    }
    if (!Array.isArray(raw)) return [];

    const seen = new Set<string>();
    const out: RecentRepo[] = [];
    for (const r of raw) {
      if (typeof r?.path !== 'string' || typeof r?.name !== 'string') continue;
      const key = normPath(r.path).toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ path: r.path, name: r.name });
    }
    return out;
  }

  /** Move `path` to the front of the list and persist it. */
  add(path: string, name: string): RecentRepo[] {
    const norm = normPath(path);
    const list = this.list().filter((r) => normPath(r.path).toLowerCase() !== norm.toLowerCase());
    list.unshift({ path: norm, name });
    const trimmed = list.slice(0, MAX_RECENTS);
    try {
      writeFileSync(this.#file, JSON.stringify(trimmed, null, 2));
    } catch {
      // Best effort: losing the recents list is not worth failing the open.
    }
    return trimmed;
  }
}
