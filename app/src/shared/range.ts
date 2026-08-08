/**
 * HTTP Range parsing for the grove-file protocol.
 *
 * Pure and separate from the handler so the awkward cases can be tested: a
 * suffix range, a range that runs past the end, and a zero-length file.
 */

/**
 * Parse a `Range` header into inclusive byte offsets.
 *
 * Returns null when there is no range to honour (serve the whole file), and
 * 'unsatisfiable' when the client asked for something outside the file, which
 * has to be a 416 rather than a silent full response — a player that is told
 * "here is everything" when it asked for byte 900 of an 800-byte file will
 * seek to the wrong place rather than fail.
 *
 * Only the single-range form is supported. Multipart ranges are legal HTTP and
 * no media element sends them.
 */
export function parseRange(
  header: string | null,
  size: number,
): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null;

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;

  const [, rawStart, rawEnd] = match;
  if (rawStart === '' && rawEnd === '') return null;
  if (size === 0) return 'unsatisfiable';

  // "bytes=-500" means the *last* 500 bytes, not "from 0 to 500". Media
  // elements use this form to read a trailing index — an MP4 with its moov
  // atom at the end is unplayable if it is misread as a prefix.
  if (rawStart === '') {
    const wanted = Number(rawEnd);
    if (!Number.isFinite(wanted) || wanted <= 0) return 'unsatisfiable';
    return { start: Math.max(0, size - wanted), end: size - 1 };
  }

  const start = Number(rawStart);
  if (!Number.isFinite(start) || start >= size) return 'unsatisfiable';

  const end = rawEnd === '' ? size - 1 : Math.min(Number(rawEnd), size - 1);
  if (!Number.isFinite(end) || end < start) return 'unsatisfiable';

  return { start, end };
}
