/**
 * Choosing a repository.
 *
 * Four ways in, because people arrive with different things in hand: a repo
 * they had open recently, a folder they can point at, a folder they can drag,
 * or a URL. The browser is for exploring; the native chooser is for the folder
 * on another drive or behind a permission prompt that no in-app list can reach.
 *
 * Same density and greyscale as the review surface — this is one more list you
 * scan, not a splash screen.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { DirListing, RecentRepo } from '@grove/engine';

import { crumbs } from '../data/crumbs';
import { source } from '../data/source';

const nameOf = (path: string) => path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

export function Home({ onOpen }: { onOpen: (path: string) => void }) {
  const [recents, setRecents] = useState<RecentRepo[]>([]);
  const [roots, setRoots] = useState<{ label: string; path: string }[]>([]);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [typed, setTyped] = useState('');
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [dropping, setDropping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);

  const listRef = useRef<HTMLDivElement>(null);

  const browse = useCallback((path: string) => {
    setError(null);
    setCursor(0);
    source
      .listDir(path)
      .then((l) => {
        setListing(l);
        setTyped(l.current);
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useEffect(() => {
    source.recents().then(setRecents).catch(() => setRecents([]));
    source.knownRoots().then(setRoots).catch(() => setRoots([]));
    browse(''); // empty starts at the user's home directory
  }, [browse]);

  // --- Drag a folder anywhere onto the surface ----------------------------
  useEffect(() => {
    const over = (e: DragEvent) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropping(true);
    };
    const leave = (e: DragEvent) => {
      if (e.relatedTarget === null) setDropping(false);
    };
    const drop = (e: DragEvent) => {
      e.preventDefault();
      setDropping(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      // Must be read synchronously: the DataTransfer is cleared when this
      // handler returns, so there is no awaiting before resolving the path.
      const path = source.pathForDropped(file);
      if (!path) {
        setError('Dropping a folder needs the desktop app.');
        return;
      }
      onOpen(path);
    };

    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
    };
  }, [onOpen]);

  const choose = useCallback(async () => {
    const picked = await source.pickDirectory();
    if (picked) onOpen(picked);
    else if (!source.live) setError('The native folder chooser needs the desktop app.');
  }, [onOpen]);

  const doClone = useCallback(async () => {
    const trimmed = url.trim();
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      onOpen(await source.clone(trimmed));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [url, onOpen]);

  // --- Keyboard through the browse list -----------------------------------
  const entries = listing?.entries ?? [];
  const onListKey = (e: React.KeyboardEvent) => {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        return setCursor((c) => Math.min(entries.length - 1, c + 1));
      case 'ArrowUp':
        e.preventDefault();
        return setCursor((c) => Math.max(0, c - 1));
      case 'Backspace':
        e.preventDefault();
        if (listing?.parent) browse(listing.parent);
        return;
      case 'Enter': {
        e.preventDefault();
        const entry = entries[cursor];
        if (!entry) return;
        return entry.is_repo ? onOpen(entry.path) : browse(entry.path);
      }
    }
  };

  useEffect(() => {
    listRef.current?.querySelector('[data-cursor="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  return (
    <div className="home" data-dropping={dropping}>
      <header className="repobar">
        <span className="name">grove</span>
        <span className="branch">open a repository</span>
        <span className="spacer" />
        {!source.live && <span className="mode">fixtures</span>}
      </header>

      {dropping && <div className="dropzone">Drop a folder to open it</div>}

      {error && (
        <div className="empty" role="alert">
          {error}
        </div>
      )}

      <div className="home-body">
        <section className="home-col">
          <div className="section-head">
            <span className="label">recent</span>
            <span className="rule" />
          </div>
          {recents.length === 0 ? (
            <div className="empty">Nothing opened yet.</div>
          ) : (
            <div className="scroll">
              {recents.map((r) => (
                <div
                  key={r.path}
                  className="row entry"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpen(r.path)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      onOpen(r.path);
                    }
                  }}
                >
                  <span className="base">{r.name}</span>
                  <span className="dir" title={r.path}>
                    {r.path}
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="section-head">
            <span className="label">clone</span>
            <span className="rule" />
          </div>
          <div className="home-clone">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void doClone();
              }}
              placeholder="https://github.com/owner/repo.git"
              spellCheck={false}
              disabled={busy}
            />
            <button onClick={() => void doClone()} disabled={busy || !url.trim()}>
              {busy ? 'cloning…' : 'clone'}
            </button>
          </div>
        </section>

        <section className="home-col">
          <div className="section-head">
            <span className="label">browse</span>
            <span className="rule" />
            <button className="label" onClick={() => void choose()}>
              choose folder…
            </button>
          </div>

          {/* Typed path first: the fastest route for anyone who knows where
              they are going, and the only one that survives a paste. */}
          <div className="home-path">
            <input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') browse(typed.trim());
              }}
              placeholder="paste or type a path"
              spellCheck={false}
              aria-label="Path"
            />
            <button onClick={() => browse(typed.trim())}>go</button>
          </div>

          <div className="crumbs">
            {roots.map((r) => (
              <button key={r.path} className="crumb-root" onClick={() => browse(r.path)}>
                {r.label}
              </button>
            ))}
            {roots.length > 0 && listing && <span className="crumb-sep">·</span>}
            {listing &&
              crumbs(listing.current).map((c) => (
                <button key={c.path} className="crumb" onClick={() => browse(c.path)} title={c.path}>
                  {c.label}
                </button>
              ))}
          </div>

          {!listing ? (
            <div className="empty">Loading…</div>
          ) : (
            <div
              className="scroll"
              ref={listRef}
              tabIndex={0}
              onKeyDown={onListKey}
              role="listbox"
              aria-label="Folders"
            >
              {listing.parent && (
                <div className="row entry" role="button" tabIndex={-1} onClick={() => browse(listing.parent!)}>
                  <span className="dir">..</span>
                </div>
              )}
              {entries.map((e, i) => (
                <div
                  key={e.path}
                  className="row entry"
                  role="option"
                  aria-selected={i === cursor}
                  tabIndex={-1}
                  data-repo={e.is_repo}
                  data-cursor={i === cursor}
                  onMouseEnter={() => setCursor(i)}
                  // A repo opens; a plain folder descends. Nothing here needs a
                  // second click target to explain that.
                  onClick={() => (e.is_repo ? onOpen(e.path) : browse(e.path))}
                >
                  <span className={e.is_repo ? 'base' : 'dir'}>{e.name}</span>
                  {e.is_repo && <span className="ref">repo</span>}
                </div>
              ))}
              {entries.length === 0 && <div className="empty">No folders here.</div>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export { nameOf };
