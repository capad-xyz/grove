/**
 * Diff rendering. The one place saturated colour is allowed, so it gets the
 * larger type size and the looser line-height — everything else in the app is
 * navigation to reach this.
 */

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
  return (
    <div className="diff">
      <div className="diff-head">
        <span className="title">{title}</span>
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
        <div className="diff-body">
          {/* The inner wrapper shrink-wraps to the widest line, so rows fill
              the full scrolled width. Sizing the rows themselves against 100%
              measures the *pane*, which leaves +/- backgrounds ending mid-air
              once you scroll right. */}
          <div className="diff-lines">
            {parseDiff(patch).map((l, i) => (
              <div key={i} className={`diff-line ${l.kind}`}>
                {l.text === '' ? ' ' : l.text}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
