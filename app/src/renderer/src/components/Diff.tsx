/**
 * Diff rendering. The one place saturated colour is allowed, so it gets the
 * larger type size and the looser line-height — everything else in the app is
 * navigation to reach this.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { findMatches, segments, step } from '../data/find';
import {
  base64Size,
  dataUri,
  imageFiles,
  isImage,
  markdownFiles,
  mimeFor,
} from '../data/images';
import { MarkdownPreview } from './Markdown';
import { source } from '../data/source';

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

/**
 * Before and after for one changed image.
 *
 * Rendered through `<img src="data:…">` and never as inline markup. That is
 * deliberate for SVG: an SVG can carry script, and inlining one from a
 * repository Grove did not write would hand it the renderer. Inside an `<img>`
 * it is inert, and the CSP already permits `data:` there.
 */
function ImagePair({
  repoPath,
  oid,
  file,
}: {
  repoPath: string;
  oid: string;
  file: string;
}) {
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setDone(false);
    // `^` resolves to the first parent; a missing blob on either side is a
    // normal add or delete and comes back null rather than throwing.
    void Promise.all([
      source.fileBytesAt(repoPath, `${oid}^`, file).catch(() => null),
      source.fileBytesAt(repoPath, oid, file).catch(() => null),
    ]).then(([b, a]) => {
      if (cancelled) return;
      setBefore(b);
      setAfter(a);
      setDone(true);
    });
    return () => {
      cancelled = true;
    };
  }, [repoPath, oid, file]);

  const mime = mimeFor(file) ?? 'image/png';
  const side = (label: string, b64: string | null) => (
    <div className="img-side">
      <div className="label">
        {label}
        {b64 && <span className="img-size"> {base64Size(b64)}</span>}
      </div>
      {b64 ? (
        <img src={dataUri(mime, b64)} alt={`${file} ${label}`} />
      ) : (
        <div className="empty">{done ? 'absent' : '…'}</div>
      )}
    </div>
  );

  return (
    <div className="img-diff">
      <div className="img-file">{file}</div>
      <div className="img-pair">
        {side('before', before)}
        {side('after', after)}
      </div>
    </div>
  );
}

/**
 * Preview of a file as it exists in the working tree.
 *
 * Needed because `git diff` says nothing at all about an untracked file — no
 * header, no body — so there is no patch to derive a preview from. Reading the
 * file directly is the only way to show a newly added image or script, which is
 * most of what an agent leaves behind.
 */
function WorkingPreview({ repoPath, file }: { repoPath: string; file: string }) {
  const [before, setBefore] = useState<string | null>(null);
  const [after, setAfter] = useState<string | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const image = isImage(file);

  useEffect(() => {
    let cancelled = false;
    setDone(false);
    setBefore(null);
    setAfter(null);
    setText(null);

    const work = image
      ? Promise.all([
          // Absent for an untracked file, which is the normal case here.
          source.fileBytesAt(repoPath, 'HEAD', file).catch(() => null),
          source.workingFileBytes(repoPath, file).catch(() => null),
        ]).then(([b, a]) => {
          if (cancelled) return;
          setBefore(b);
          setAfter(a);
        })
      : source
          .workingFile(repoPath, file)
          .then((t) => !cancelled && setText(t))
          .catch(() => !cancelled && setText(null));

    void work.finally(() => !cancelled && setDone(true));
    return () => {
      cancelled = true;
    };
  }, [repoPath, file, image]);

  if (!done) return <div className="empty">…</div>;

  if (image) {
    const mime = mimeFor(file) ?? 'image/png';
    const side = (label: string, b64: string | null, absent: string) => (
      <div className="img-side">
        <div className="label">
          {label}
          {b64 && <span className="img-size"> {base64Size(b64)}</span>}
        </div>
        {b64 ? (
          <img src={dataUri(mime, b64)} alt={`${file} ${label}`} />
        ) : (
          <div className="empty">{absent}</div>
        )}
      </div>
    );

    return (
      <div className="img-diff">
        <div className="img-file">{file}</div>
        <div className="img-pair">
          {side('committed', before, 'not in HEAD — new file')}
          {side('working', after, 'unreadable or over the preview size limit')}
        </div>
      </div>
    );
  }

  if (text === null) {
    return <div className="empty">This file cannot be shown as text.</div>;
  }
  if (text === '') {
    return <div className="empty">Empty file.</div>;
  }

  return (
    <div className="diff-body">
      <div className="diff-lines">
        {text.split('\n').map((line, i) => (
          <div key={i} className="diff-line add">
            {line === '' ? ' ' : `+${line}`}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Diff({
  patch,
  title,
  onClose,
  repoPath,
  oid,
  working,
}: {
  patch: string | null;
  title: string;
  onClose?: () => void;
  /** Both required to render image previews; without them the diff is text only. */
  repoPath?: string | null;
  oid?: string | null;
  /** Set when previewing a working-tree file rather than a commit. */
  working?: { path: string; staged: boolean } | null;
}) {
  const [finding, setFinding] = useState(false);
  const [query, setQuery] = useState('');
  const [at, setAt] = useState(0);

  const bodyRef = useRef<HTMLDivElement>(null);
  const findRef = useRef<HTMLInputElement>(null);

  const lines = useMemo(() => (patch ? parseDiff(patch) : []), [patch]);
  const texts = useMemo(() => lines.map((l) => l.text), [lines]);
  const matches = useMemo(() => findMatches(texts, query), [texts, query]);
  const images = useMemo(() => (patch ? imageFiles(patch) : []), [patch]);
  const markdown = useMemo(() => (patch ? markdownFiles(patch) : []), [patch]);

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

      {patch === null && !working ? (
        <div className="empty">Select a commit to see what changed.</div>
      ) : /* An image is always worth showing directly, and an untracked file
             has no patch to render at all — both go through the working
             preview rather than the diff path. */
      working && repoPath && (isImage(working.path) || (patch ?? '').trim() === '') ? (
        <WorkingPreview repoPath={repoPath} file={working.path} />
      ) : (patch ?? '').trim() === '' ? (
        <div className="empty">No textual changes.</div>
      ) : (
        <div className="diff-body" ref={bodyRef}>
          {/* Images first: a "Binary files differ" line is the least useful
              thing in the patch, and the picture is the whole answer. */}
          {repoPath &&
            oid &&
            images.map((file) => (
              <ImagePair key={file} repoPath={repoPath} oid={oid} file={file} />
            ))}

          {repoPath &&
            oid &&
            markdown.map((file) => (
              <MarkdownPreview key={file} repoPath={repoPath} oid={oid} file={file} />
            ))}

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
