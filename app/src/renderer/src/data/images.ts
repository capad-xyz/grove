/**
 * Image awareness for the diff.
 *
 * When an agent changes a `.png`, git's answer is "Binary files a/x.png and
 * b/x.png differ", which tells you nothing you wanted to know. These helpers
 * find those files in a patch so the diff can show the two pictures instead.
 */

const MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  avif: 'image/avif',
  svg: 'image/svg+xml',
};

/** MIME type for a path, or null if it is not an image we render. */
export function mimeFor(path: string): string | null {
  const ext = path.toLowerCase().split('.').pop() ?? '';
  return MIME[ext] ?? null;
}

export const isImage = (path: string): boolean => mimeFor(path) !== null;

/**
 * Image paths mentioned by a unified diff, in order, deduplicated.
 *
 * Reads the `diff --git a/X b/X` headers rather than the `+++`/`---` lines,
 * because those carry `/dev/null` for adds and deletes and would lose the
 * filename exactly when a new image is the thing you want to look at.
 */
export function imageFiles(patch: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const line of patch.split('\n')) {
    if (!line.startsWith('diff --git ')) continue;

    // "diff --git a/path b/path". Taking the b-side and stripping one leading
    // segment handles paths containing spaces better than splitting on
    // whitespace, which breaks on "a/my file.png".
    const bAt = line.lastIndexOf(' b/');
    if (bAt === -1) continue;
    const file = line.slice(bAt + 3);

    if (!isImage(file) || seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  return out;
}

/** A `data:` URI, which is what the CSP permits for images. */
export const dataUri = (mime: string, base64: string): string =>
  `data:${mime};base64,${base64}`;

/** Readable size for the byte count behind a base64 string. */
export function base64Size(base64: string): string {
  // 4 base64 chars encode 3 bytes; trailing '=' are padding, not data.
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  const bytes = Math.max(0, (base64.length * 3) / 4 - padding);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
