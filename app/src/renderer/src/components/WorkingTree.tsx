/**
 * The working tree, and the only place in Grove that writes.
 *
 * Rows toggle: clicking something unstaged stages it, clicking something staged
 * unstages it. There is no separate button per row in the resting state — the
 * verb appears on hover, because a column of buttons at this density is louder
 * than the filenames it sits beside, and the filenames are the content.
 */

import { useCallback, useState } from 'react';

import type { FileStatus, WorkingStatus } from '@grove/engine';

interface Group {
  key: 'staged' | 'unstaged' | 'untracked';
  label: string;
  verb: string;
  files: FileStatus[];
}

function groupsOf(status: WorkingStatus): Group[] {
  const all: Group[] = [
    { key: 'staged', label: 'staged', verb: 'unstage', files: status.staged },
    { key: 'unstaged', label: 'changed', verb: 'stage', files: status.unstaged },
    {
      key: 'untracked',
      label: 'untracked',
      verb: 'stage',
      files: status.untracked.map((path) => ({ path, status: '?' })),
    },
  ];
  return all.filter((g) => g.files.length > 0);
}

/** Split so the filename can never be the part that gets truncated away. */
function splitPath(path: string): { dir: string; base: string } {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut === -1
    ? { dir: '', base: path }
    : { dir: path.slice(0, cut + 1), base: path.slice(cut + 1) };
}

export function WorkingTree({
  status,
  busy,
  onToggle,
  onStageAll,
  onUnstageAll,
  onCommit,
  onDraft,
}: {
  status: WorkingStatus | null;
  busy: boolean;
  onToggle: (file: string, staged: boolean) => void;
  onStageAll: () => void;
  onUnstageAll: () => void;
  onCommit: (message: string) => Promise<void>;
  onDraft: () => Promise<string>;
}) {
  const [message, setMessage] = useState('');
  const [working, setWorking] = useState(false);

  const commit = useCallback(async () => {
    if (!message.trim() || working) return;
    setWorking(true);
    try {
      await onCommit(message.trim());
      setMessage(''); // only on success — a failed commit must not eat the text
    } finally {
      setWorking(false);
    }
  }, [message, working, onCommit]);

  const draft = useCallback(async () => {
    setWorking(true);
    try {
      setMessage(await onDraft());
    } catch {
      // The error surfaces through App's alert; leave whatever was typed.
    } finally {
      setWorking(false);
    }
  }, [onDraft]);

  if (!status) return null;

  const groups = groupsOf(status);
  const total = groups.reduce((n, g) => n + g.files.length, 0);
  const staged = status.staged.length;

  return (
    <section className="status" aria-label="Working tree">
      <div className="section-head">
        <span className="label">working tree</span>
        <span className="rule" />
        {total > 0 && (
          <button className="label act" onClick={onStageAll} disabled={busy}>
            stage all
          </button>
        )}
        {staged > 0 && (
          <button className="label act" onClick={onUnstageAll} disabled={busy}>
            unstage all
          </button>
        )}
        <span className="label">{total === 0 ? 'clean' : total}</span>
      </div>

      {total === 0 ? (
        <div className="empty">Nothing to commit.</div>
      ) : (
        <div className="scroll">
          {groups.map((g) => (
            <div key={g.key}>
              <div className="section-head sub">
                <span className="label">
                  {g.label} {g.files.length}
                </span>
                <span className="rule" />
              </div>
              {g.files.map((f) => {
                const { dir, base } = splitPath(f.path);
                return (
                  <div
                    key={f.path}
                    className="row file"
                    role="button"
                    tabIndex={0}
                    data-busy={busy}
                    onClick={() => !busy && onToggle(f.path, g.key === 'staged')}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        if (!busy) onToggle(f.path, g.key === 'staged');
                      }
                    }}
                  >
                    <span className="code" data-code={f.status.trim()}>
                      {f.status.trim() || '·'}
                    </span>
                    <span className="path" title={f.path}>
                      {dir && <span className="dir">{dir}</span>}
                      <span className="base">{base}</span>
                    </span>
                    <span className="verb label">{g.verb}</span>
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {staged > 0 && (
        <div className="commitbox">
          <input
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            onKeyDown={(e) => {
              // Enter commits. The message is one line here by design; a body
              // belongs in an editor, not a docked strip.
              if (e.key === 'Enter') void commit();
            }}
            placeholder={`commit ${staged} staged file${staged === 1 ? '' : 's'}`}
            spellCheck={false}
            disabled={working}
          />
          <button className="act" onClick={() => void draft()} disabled={working} title="Draft with your local agent">
            draft
          </button>
          <button className="act primary" onClick={() => void commit()} disabled={working || !message.trim()}>
            {working ? '…' : 'commit'}
          </button>
        </div>
      )}
    </section>
  );
}
