/**
 * Diff rendering. The one place saturated colour is allowed, so it gets the
 * larger type size and the looser line-height — everything else in the app is
 * navigation to reach this.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { WorkingPreview as EnginePreview } from '@grove/engine';

import { findMatches, segments, step } from '../data/find';
import {
  base64Size,
  byteSize,
  dataUri,
  imageFiles,
  isImage,
  markdownFiles,
  mediaKind,
  mimeFor,
  repoFileUrl,
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
  const [committed, setCommitted] = useState<string | null>(null);
  const [info, setInfo] = useState<EnginePreview | null>(null);
  const [done, setDone] = useState(false);

  const kind = mediaKind(file);

  useEffect(() => {
    let cancelled = false;
    setDone(false);
    setCommitted(null);
    setInfo(null);

    // Media never comes through IPC — it streams from `grove-file:`. Only the
    // committed side of an image needs bytes, because that lives in a git
    // object rather than on disk.
    const work =
      kind === 'image'
        ? source
            .fileBytesAt(repoPath, 'HEAD', file)
            .then((b) => !cancelled && setCommitted(b))
            .catch(() => {})
        : kind
          ? Promise.resolve()
          : source
              .workingFilePreview(repoPath, file)
              .then((p) => !cancelled && setInfo(p))
              .catch(() => {});

    void work.finally(() => !cancelled && setDone(true));
    return () => {
      cancelled = true;
    };
  }, [repoPath, file, kind]);

  // Media renders immediately; the element streams its own bytes and shows its
  // own progress, so there is nothing to wait on before painting.
  if (kind === 'video') {
    return (
      <div className="img-diff">
        <div className="img-file">{file}</div>
        <video className="media" src={repoFileUrl(file)} controls preload="metadata" />
      </div>
    );
  }
  if (kind === 'audio') {
    return (
      <div className="img-diff">
        <div className="img-file">{file}</div>
        <audio className="media" src={repoFileUrl(file)} controls preload="metadata" />
      </div>
    );
  }

  if (kind === 'image') {
    const mime = mimeFor(file) ?? 'image/png';
    return (
      <div className="img-diff">
        <div className="img-file">{file}</div>
        <div className="img-pair">
          <div className="img-side">
            <div className="label">
              committed{committed && <span className="img-size"> {base64Size(committed)}</span>}
            </div>
            {committed ? (
              <img src={dataUri(mime, committed)} alt={`${file} committed`} />
            ) : (
              <div className="empty">{done ? 'not in HEAD — new file' : '…'}</div>
            )}
          </div>
          <div className="img-side">
            <div className="label">working</div>
            <img src={repoFileUrl(file)} alt={`${file} working`} />
          </div>
        </div>
      </div>
    );
  }

  if (!done || info === null) return <div className="empty">…</div>;

  if (info.kind === 'unreadable') {
    return <div className="empty">This file could not be read.</div>;
  }

  // A binary with no player gets described, not decoded. Rendering its bytes as
  // text is what produced pages of mojibake.
  if (info.kind === 'binary') {
    return (
      <div className="binary-card">
        <div className="img-file">{file}</div>
        <div className="label">binary · {byteSize(info.size)} · no preview available</div>
      </div>
    );
  }

  if ((info.text ?? '') === '') return <div className="empty">Empty file.</div>;

  return (
    <>
      {info.truncated && (
        <div className="label truncated">
          showing the first 2 MB of {byteSize(info.size)}
        </div>
      )}
      <div className="diff-body">
        <div className="diff-lines">
          {info.text!.split('\n').map((line, i) => (
            <div key={i} className="diff-line add">
              {line === '' ? ' ' : `+${line}`}
            </div>
          ))}
        </div>
      </div>
    </>
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
  const [copied, setCopied] = useState(false);

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

  // Copies the patch as git wrote it, not as the pane rendered it.
  //
  // Selecting the diff by hand is the obvious way to do this and it is about to
  // stop working: once the body is windowed, only the rows near the viewport
  // exist, so Ctrl+A reaches a few dozen lines of a file that has thousands.
  // This is the replacement, and it is a better answer anyway — the clipboard
  // gets a patch that `git apply` will accept.
  const copyPatch = useCallback(() => {
    if (patch === null) return;
    void source.writeClipboard(patch).then(() => {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    });
  }, [patch]);

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
            <>
              <button className="label" onClick={copyPatch}>
                {copied ? 'copied' : 'copy'}
              </button>
              <button className="label" onClick={() => setFinding(true)}>
                find
              </button>
            </>
          )
        )}

        {onClose && (
          <button onClick={onClose} className="label diff-close" aria-label="Close diff">
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
