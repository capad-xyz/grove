/**
 * File awareness for the diff: which paths a patch touches, and which of them
 * deserve to be shown as something other than text.
 *
 * When an agent changes a `.png`, git's answer is "Binary files a/x.png and
 * b/x.png differ", which tells you nothing you wanted to know. Markdown has a
 * milder version of the same problem — the diff is right, but the rendered
 * result is sometimes the question.
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
 * Every path a unified diff touches, in order, deduplicated.
 *
 * Reads the `diff --git a/X b/X` headers rather than the `+++`/`---` lines,
 * because those carry `/dev/null` for adds and deletes and would lose the
 * filename exactly when a new file is the thing you want to look at.
 */
export function filesInPatch(patch: string): string[] {
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

    if (seen.has(file)) continue;
    seen.add(file);
    out.push(file);
  }
  return out;
}

export const imageFiles = (patch: string): string[] => filesInPatch(patch).filter(isImage);

const VIDEO: Record<string, string> = {
  mp4: 'video/mp4',
  m4v: 'video/mp4',
  webm: 'video/webm',
  ogv: 'video/ogg',
  mov: 'video/quicktime',
};

const AUDIO: Record<string, string> = {
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  m4a: 'audio/mp4',
  flac: 'audio/flac',
  aac: 'audio/aac',
};

export type MediaKind = 'image' | 'video' | 'audio';

const extOf = (path: string) => path.toLowerCase().split('.').pop() ?? '';

/** What a browser can play or display natively, or null. */
export function mediaKind(path: string): MediaKind | null {
  const ext = extOf(path);
  if (MIME[ext]) return 'image';
  if (VIDEO[ext]) return 'video';
  if (AUDIO[ext]) return 'audio';
  return null;
}

export const mediaMime = (path: string): string | null => {
  const ext = extOf(path);
  return MIME[ext] ?? VIDEO[ext] ?? AUDIO[ext] ?? null;
};

/**
 * A URL the renderer can hand to `<img>`, `<video>` or `<audio>`, served by the
 * main process straight from the open repository.
 *
 * Not a `data:` URI: those carry the whole file as base64 through IPC, which
 * for video means building a 67MB string to show a 50MB clip. This streams, and
 * gives the player range requests so seeking works.
 */
export function repoFileUrl(file: string): string {
  const parts = file.replace(/\\/g, '/').split('/').filter(Boolean).map(encodeURIComponent);
  return `grove-file://repo/${parts.join('/')}`;
}

/**
 * Resolve a relative path written inside `fromFile` to a repository path.
 *
 * `docs/PRD.md` referencing `shot.png` means `docs/shot.png`; `../logo.svg`
 * means `logo.svg`. Returns null for anything that escapes the repository root,
 * so a `../../../` in a document Grove did not write cannot name a file outside
 * it. Absolute-looking sources (`/x`) are treated as repository-root-relative,
 * which is what a documentation site would have meant by them.
 */
export function resolveRepoPath(fromFile: string, src: string): string | null {
  const clean = src.replace(/\\/g, '/').split(/[?#]/)[0]!;
  if (clean === '') return null;

  const base = clean.startsWith('/')
    ? []
    : fromFile.replace(/\\/g, '/').split('/').slice(0, -1);

  const out: string[] = [...base];
  for (const seg of clean.replace(/^\//, '').split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      // Escaping the root is refused rather than clamped: clamping would
      // silently resolve to some *other* real file.
      if (out.length === 0) return null;
      out.pop();
      continue;
    }
    out.push(seg);
  }
  return out.length ? out.join('/') : null;
}

/** True for a source that names somewhere off this machine. */
export const isRemote = (src: string): boolean => /^[a-z][a-z0-9+.-]*:/i.test(src.trim());

export const isMarkdown = (path: string): boolean => /\.mdx?$/i.test(path);

export const markdownFiles = (patch: string): string[] =>
  filesInPatch(patch).filter(isMarkdown);

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

/** Human byte size for a raw count, matching base64Size's formatting. */
export function byteSize(bytes: number): string {
  const n = Math.max(0, bytes);
  if (n < 1024) return `${Math.round(n)} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
