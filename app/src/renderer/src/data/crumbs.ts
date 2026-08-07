/**
 * Path segmentation for the picker's breadcrumb.
 *
 * Lives here rather than beside the component because it is pure and it is
 * fiddly — the Windows and POSIX roots need opposite treatment — and Node can
 * only run tests against `.ts`, not JSX.
 */

/** Path split into cumulative segments, each one navigable on its own. */
export function crumbs(path: string): { label: string; path: string }[] {
  const raw = path.replace(/\\/g, '/').trim();
  if (raw === '') return [];

  // Strip trailing slashes, but never the whole path: stripping them outright
  // reduced the POSIX root "/" to the empty string and dropped it entirely,
  // leaving no way to navigate to it. Requiring a character before the slashes
  // keeps a bare root intact.
  const norm = raw.replace(/(.)\/+$/, '$1');
  if (norm === '/') return [{ label: '/', path: '/' }];

  const out: { label: string; path: string }[] = [];
  let acc = '';
  for (const part of norm.split('/')) {
    // Two roots need care. "C:" alone is *relative* on Windows — it means the
    // current directory on that drive — so the drive crumb keeps its slash.
    // A POSIX path starts with an empty segment, which is the root itself.
    acc = acc === '' ? (part === '' ? '/' : `${part}/`) : `${acc.replace(/\/$/, '')}/${part}`;
    out.push({ label: part === '' ? '/' : part, path: acc });
  }
  return out;
}
