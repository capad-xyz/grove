/**
 * Diff rendering. The one place saturated colour is allowed, so it gets the
 * larger type size and the looser line-height — everything else in the app is
 * navigation to reach this.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { findMatches, segments, step } from '../data/find';

interface Line {
  kind: 'add' | 'del' | 'ctx' | 'hunk' | 'file';
  text: string;
}

/** Classify unified-diff lines. Order matters: `+++`/`---` are file headers,
 *  not additions, so they must be tested before the single-character cases. */
export function parseDiff(patch: string): Line[] {
  const out: Line[] = [];
  for (const text of patch.split('\n')) {
    if (
      text.startsWith('diff --git') ||
      text.startsWith('+++') ||
      text.startsWith('---') ||
      text.startsWith('index ') ||
      text.startsWith('new file') ||
      text.startsWith('deleted file')
    ) {
      if (text.startsWith('diff --git')) out.push({ kind: 'file', text });
      continue;
    }
    if (text.startsWith('@@')) out.push({ kind: 'hunk', text });
    else if (text.startsWith('+')) out.push({ kind: 'add', text });
    else if (text.startsWith('-')) out.push({ kind: 'del', text });
    else out.push({ kind: 'ctx', text });
  }
  // Trailing blank from the final newline adds a phantom row.
  while (out.length && out[out.length - 1]!.text === '') out.pop();
  return out;
}

export function Diff({
  patch,
  title,
  onClose,
}: {
  patch: string | null;
  title: string;
  onClose?: () => void;
}) {
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const lines = useMemo(() => (patch ? parseDiff(patch) : []), [patch]);
  const texts = useMemo(() => lines.map((l) => l.text), [lines]);
  const matches = useMemo(() => findMatches(texts, query), [texts, query]);

  // A new diff invalidates the old match positions entirely.
  useEffect(() => setAt(0), [patch, query]);

  const close = useCallback(() => {
    setFinding(false);
    setQuery('');
  }, []);

  // Ctrl/Cmd+F opens the field. Scoped to this component's subtree via a
  // window listener guarded on a diff being present, so it cannot steal the
  // shortcut when there is nothing to search.
  useEffect(() => {
    if (patch === null) return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setFinding(true);
        findRef.current?.select();
        findRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [patch]);

  useEffect(() => {
    if (finding) findRef.current?.focus();
  }, [finding]);

  // Keep the current match on screen. `nearest` so it only scrolls when the
  // match has actually left the viewport.
  useEffect(() => {
    if (matches.length === 0) return;
    bodyRef.current
      ?.querySelector('[data-current-match="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [at, matches.length]);

  const onFindKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setAt((c) => step(c, matches.length, e.shiftKey ? -1 : 1));
    }
  };

  // Where each line's matches begin in the global ordering, so a highlight can
  // know whether it is *the* current one.
  const firstIndexByLine = useMemo(() => {
    const m = new Map<number, number>();
    matches.forEach((match, i) => {
      if (!m.has(match.line)) m.set(match.line, i);
    });
    return m;
  }, [matches]);

  return (
    <div className="diff">
      <div className="diff-head">
        <span className="title">{title}</span>

        {finding ? (
          <span className="find">
            <input
              ref={findRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onFindKey}
              placeholder="find"
              spellCheck={false}
              aria-label="Find in diff"
            />
            <span className="label">
              {query === '' ? '' : matches.length === 0 ? 'none' : `${at + 1}/${matches.length}`}
            </span>
            <button
              className="label"
              onClick={() => setAt((c) => step(c, matches.length, -1))}
              aria-label="Previous match"
            >
              ↑
            </button>
            <button
              className="label"
              onClick={() => setAt((c) => step(c, matches.length, 1))}
              aria-label="Next match"
            >
              ↓
            </button>
            <button className="label" onClick={close}>
              esc
            </button>
          </span>
        ) : (
          patch !== null && (
            <button className="label" onClick={() => setFinding(true)}>
              find
            </button>
          )
        )}

        {onClose && (
          <button onClick={onClose} className="label" aria-label="Close diff">
            close
          </button>
        )}
      </div>

      {patch === null ? (
        <div className="empty">Select a commit to see what changed.</div>
      ) : patch.trim() === '' ? (
        <div className="empty">No textual changes.</div>
      ) : (
        <div className="diff-body" ref={bodyRef}>
          {/* The inner wrapper shrink-wraps to the widest line, so rows fill
              the full scrolled width. Sizing the rows themselves against 100%
              measures the *pane*, which leaves +/- backgrounds ending mid-air
              once you scroll right. */}
          <div className="diff-lines">
            {lines.map((l, i) => {
              const base = firstIndexByLine.get(i);
              const parts =
                base === undefined
                  ? null
                  : segments(l.text === '' ? ' ' : l.text, matches, i, base);

              return (
                <div key={i} className={`diff-line ${l.kind}`}>
                  {parts === null
                    ? l.text === ''
                      ? ' '
                      : l.text
                    : parts.map((s, j) =>
                        s.hit ? (
                          <mark
                            key={j}
                            className="hit"
                            data-current-match={s.index === at}
                          >
                            {s.text}
                          </mark>
                        ) : (
                          <span key={j}>{s.text}</span>
                        ),
                      )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
