/**
 * Spotlight: one field over files, branches, commits, and file contents.
 *
 * Two of those four are instant (files and branches are matched in the
 * renderer) and two are subprocesses (commits and content go to git). The
 * instant groups are rendered *above* the async ones on purpose — results
 * arriving late then fill in below whatever you are already looking at, and can
 * never shift the highlighted row out from under the keyboard. That is the same
 * rule as DESIGN-SYSTEM §7: layout does not move while you are reading it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CommitNode, GrepHit } from '@grove/engine';

import { matchFiles, matchStrings, type FileEntry } from '../data/match';
import { source } from '../data/source';
import { ago } from './Commits';

/** Long enough that a fast typist spawns one `git grep`, not eight. */
const DEBOUNCE_MS = 160;
/** Below this, content search matches most of the repo and helps nobody. */
const MIN_CONTENT_CHARS = 3;

export type Pick =
  | { kind: 'commit'; oid: string; label: string }
  | { kind: 'file'; path: string }
  | { kind: 'branch'; name: string };

interface Row {
  key: string;
  group: string;
  pick: Pick;
  primary: string;
  secondary?: string;
}

export function Spotlight({
  repoPath,
  branches,
  fileIndex,
  onPick,
  onClose,
}: {
  repoPath: string;
  branches: readonly string[];
  fileIndex: readonly FileEntry[];
  onPick: (pick: Pick) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [commits, setCommits] = useState<CommitNode[]>([]);
  const [content, setContent] = useState<GrepHit[]>([]);
  const [searching, setSearching] = useState(false);
  const [highlight, setHighlight] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Per-session caches so backspacing through a query is instant rather than
  // re-running git for terms already answered.
  const commitCache = useRef(new Map<string, CommitNode[]>());
  const contentCache = useRef(new Map<string, GrepHit[]>());
  /** Guards against a slow early query landing after a faster later one. */
  const gen = useRef(0);

  useEffect(() => inputRef.current?.focus(), []);

  // --- Instant groups -----------------------------------------------------
  const files = useMemo(() => matchFiles(fileIndex, query, 8), [fileIndex, query]);
  const branchHits = useMemo(() => matchStrings(branches, query, 4), [branches, query]);

  // --- Debounced git-backed groups ----------------------------------------
  useEffect(() => {
    const term = query.trim();
    if (term === '') {
      setCommits([]);
      setContent([]);
      setSearching(false);
      return;
    }

    const cachedCommits = commitCache.current.get(term);
    const cachedContent = contentCache.current.get(term);
    if (cachedCommits) setCommits(cachedCommits);
    if (cachedContent) setContent(cachedContent);
    if (cachedCommits && (cachedContent || term.length < MIN_CONTENT_CHARS)) {
      setSearching(false);
      return;
    }

    const mine = ++gen.current;
    setSearching(true);
    const timer = setTimeout(() => {
      const wantContent = term.length >= MIN_CONTENT_CHARS;

      const commitsP = cachedCommits
        ? Promise.resolve(cachedCommits)
        : source.searchCommits(repoPath, term).catch(() => [] as CommitNode[]);
      const contentP = !wantContent
        ? Promise.resolve([] as GrepHit[])
        : cachedContent
          ? Promise.resolve(cachedContent)
          : source.grep(repoPath, term).catch(() => [] as GrepHit[]);

      void Promise.all([commitsP, contentP]).then(([c, g]) => {
        commitCache.current.set(term, c);
        if (wantContent) contentCache.current.set(term, g);
        // A stale query must not overwrite a newer one's results.
        if (gen.current !== mine) return;
        setCommits(c);
        setContent(g);
        setSearching(false);
      });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, repoPath]);

  // --- One flat list, so the keyboard does not care about groups -----------
  const rows: Row[] = useMemo(() => {
    const out: Row[] = [];
    for (const f of files) {
      out.push({
        key: `f:${f.path}`,
        group: 'files',
        pick: { kind: 'file', path: f.path },
        primary: f.path.split('/').pop() ?? f.path,
        secondary: f.path,
      });
    }
    for (const b of branchHits) {
      out.push({ key: `b:${b}`, group: 'branches', pick: { kind: 'branch', name: b }, primary: b });
    }
    for (const c of commits.slice(0, 8)) {
      out.push({
        key: `c:${c.id}`,
        group: 'commits',
        pick: { kind: 'commit', oid: c.id, label: c.summary },
        primary: c.summary,
        secondary: `${c.short}  ${c.author}  ${ago(c.time)}`,
      });
    }
    for (const h of content.slice(0, 8)) {
      out.push({
        key: `g:${h.file}:${h.line}`,
        group: 'content',
        // A content hit is a file hit that tells you why it matched.
        pick: { kind: 'file', path: h.file },
        primary: h.text.trim(),
        secondary: `${h.file}:${h.line}`,
      });
    }
    return out;
  }, [files, branchHits, commits, content]);

  // Clamp rather than reset: a shrinking list should not throw away the user's
  // position entirely.
  useEffect(() => {
    setHighlight((h) => Math.max(0, Math.min(h, rows.length - 1)));
  }, [rows.length]);

  const choose = useCallback(
    (row: Row | undefined) => {
      if (!row) return;
      onPick(row.pick);
      onClose();
    },
    [onPick, onClose],
  );

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case 'Escape':
          e.preventDefault();
          return onClose();
        case 'ArrowDown':
          e.preventDefault();
          return setHighlight((h) => Math.min(rows.length - 1, h + 1));
        case 'ArrowUp':
          e.preventDefault();
          return setHighlight((h) => Math.max(0, h - 1));
        case 'Enter':
          e.preventDefault();
          return choose(rows[highlight]);
      }
    },
    [rows, highlight, choose, onClose],
  );

  // Keep the highlighted row visible. `nearest` so it only scrolls when it has
  // actually left the viewport.
  useEffect(() => {
    listRef.current
      ?.querySelector('[data-highlighted="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [highlight]);

  let lastGroup = '';

  return (
    // Deliberately not `.overlay`: that class is display:none above 700px,
    // because it exists for the diff's narrow-mode presentation. Spotlight
    // covers the surface at every width.
    <div className="spotlight" role="dialog" aria-label="Search">
      <div className="spot-head">
        <span className="label">search</span>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="files, branches, commit messages, file contents"
          spellCheck={false}
          aria-label="Search the repository"
        />
        {searching && <span className="label">searching</span>}
        <button className="label" onClick={onClose}>
          esc
        </button>
      </div>

      <div className="spot-list scroll" ref={listRef}>
        {query.trim() === '' ? (
          <div className="empty">
            Type to search files, branches, commit messages, and file contents.
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">{searching ? 'Searching…' : 'No matches.'}</div>
        ) : (
          rows.map((row, i) => {
            const header = row.group !== lastGroup ? row.group : null;
            lastGroup = row.group;
            return (
              <div key={row.key}>
                {header && (
                  <div className="section-head">
                    <span className="label">{header}</span>
                    <span className="rule" />
                  </div>
                )}
                <div
                  className="row spot-row"
                  role="button"
                  tabIndex={-1}
                  data-highlighted={i === highlight}
                  onMouseEnter={() => setHighlight(i)}
                  onClick={() => choose(row)}
                >
                  <span className="spot-primary">{row.primary}</span>
                  {row.secondary && <span className="spot-secondary">{row.secondary}</span>}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
