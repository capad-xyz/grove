/**
 * Choosing a repository: recents, a folder browser, and clone.
 *
 * Deliberately the same density and greyscale as the review surface — this is
 * not a splash screen. It is one more list you scan, and it should feel like
 * the rest of the instrument rather than a front door.
 */

import { useCallback, useEffect, useState } from 'react';

import type { DirListing, RecentRepo } from '@grove/engine';

import { source } from '../data/source';

const nameOf = (path: string) =>
  path.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || path;

export function Home({ onOpen }: { onOpen: (path: string) => void }) {
  const [recents, setRecents] = useState<RecentRepo[]>([]);
  const [listing, setListing] = useState<DirListing | null>(null);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    source.recents().then(setRecents).catch(() => setRecents([]));
    // Empty path starts the browser at the user's home directory.
    source.listDir('').then(setListing).catch(() => setListing(null));
  }, []);

  const browse = useCallback((path: string) => {
    setError(null);
    source
      .listDir(path)
      .then(setListing)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

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

  return (
    <div className="home">
      <header className="repobar">
        <span className="name">grove</span>
        <span className="branch">open a repository</span>
        <span className="spacer" />
        {!source.live && <span className="mode">fixtures</span>}
      </header>

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
            <span className="label crumb" title={listing?.current}>
              {listing?.current ?? ''}
            </span>
          </div>

          {!listing ? (
            <div className="empty">Loading…</div>
          ) : (
            <div className="scroll">
              {listing.parent && (
                <div
                  className="row entry"
                  role="button"
                  tabIndex={0}
                  onClick={() => browse(listing.parent!)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') browse(listing.parent!);
                  }}
                >
                  <span className="dir">..</span>
                </div>
              )}
              {listing.entries.map((e) => (
                <div
                  key={e.path}
                  className="row entry"
                  role="button"
                  tabIndex={0}
                  data-repo={e.is_repo}
                  // A repo opens; a plain folder descends. Nothing here needs a
                  // second click target to explain that.
                  onClick={() => (e.is_repo ? onOpen(e.path) : browse(e.path))}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') (e.is_repo ? onOpen : browse)(e.path);
                  }}
                >
                  <span className={e.is_repo ? 'base' : 'dir'}>{e.name}</span>
                  {e.is_repo && <span className="ref">repo</span>}
                </div>
              ))}
              {listing.entries.length === 0 && <div className="empty">No folders here.</div>}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export { nameOf };
