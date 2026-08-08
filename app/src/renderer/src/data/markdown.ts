/**
 * A deliberately small Markdown parser.
 *
 * It produces a token tree, never an HTML string, and the component renders
 * those tokens as React elements. That makes injection impossible by
 * construction rather than by filtering: there is no path by which text from a
 * repository becomes markup. Raw HTML in the source is passed through as
 * literal text, which is the honest rendering of something we will not execute.
 *
 * Grove renders content from repositories it did not write and cannot vet —
 * the same premise that sandboxed the renderer in phase 3. Reaching for a
 * parser that emits HTML plus a sanitiser to take it back out again would be
 * trading a guarantee for a dependency.
 *
 * It is not CommonMark and does not try to be. The bar is the documentation
 * people actually keep in a repository: READMEs, AGENTS.md, PRDs, runbooks.
 * Anything it cannot parse degrades to visible source text rather than to
 * something wrong-but-plausible.
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'strike'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'image'; alt: string; src: string };

/** Column alignment declared by a table's delimiter row. */
export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem {
  inline: Inline[];
  /** `- [ ]` / `- [x]`; null when the item is not a task at all. */
  checked: boolean | null;
  /** A nested list, already parsed. */
  children: Block | null;
}

export type Block =
  | { kind: 'heading'; level: number; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; start: number; items: ListItem[] }
  | { kind: 'quote'; inline: Inline[] }
  | { kind: 'table'; head: Inline[][]; align: Align[]; rows: Inline[][][] }
  | { kind: 'hr' };

/**
 * Only schemes that cannot execute. `javascript:` is the obvious one, but
 * `data:` can carry HTML too — a link is not worth either risk, so anything
 * unrecognised renders as plain text instead of becoming an anchor.
 */
export function safeHref(href: string): string | null {
  const trimmed = href.trim();
  if (/^(https?:|mailto:)/i.test(trimmed)) return trimmed;
  // Relative links stay inert: there is nowhere in Grove for them to go.
  return null;
}

/**
 * True when a `_` at this position is a word-internal underscore rather than an
 * emphasis marker.
 *
 * `snake_case_name` is one identifier, not `snake` + emphasised `case` + `name`.
 * Grove previews technical documentation, where identifiers vastly outnumber
 * underscore-emphasis, so the asterisk forms carry emphasis and `_` only counts
 * at a word boundary. This is also what GitHub does.
 */
const wordChar = (c: string | undefined): boolean => c !== undefined && /[\p{L}\p{N}]/u.test(c);

/** Parse the inline span of one block. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;
  let prev = '';

  // Ordered by precedence: code first, so `**` inside backticks stays literal.
  // Images before links — `![alt](src)` also matches the link pattern from
  // index 1, and matching it as a link would leave a stray `!` behind.
  const rules: [RegExp, (m: RegExpMatchArray) => Inline | null][] = [
    [/^`([^`]+)`/, (m) => ({ kind: 'code', text: m[1]! })],
    [
      /^!\[([^\]]*)\]\(([^)\s]+)\)/,
      (m) => ({ kind: 'image', alt: m[1]!, src: m[2]! }),
    ],
    [
      /^\[([^\]]*)\]\(([^)\s]+)\)/,
      (m) => {
        const href = safeHref(m[2]!);
        return href
          ? { kind: 'link', text: m[1]!, href }
          : { kind: 'text', text: `[${m[1]}](${m[2]})` };
      },
    ],
    // Autolink: <https://example.com>. Bare angle brackets around anything else
    // stay literal, which keeps `<div>` in a doc looking like `<div>`.
    [
      /^<((?:https?:\/\/|mailto:)[^>\s]+)>/,
      (m) => {
        const href = safeHref(m[1]!);
        return href ? { kind: 'link', text: m[1]!, href } : null;
      },
    ],
    [/^~~([^~]+)~~/, (m) => ({ kind: 'strike', text: m[1]! })],
    [/^\*\*([^*]+)\*\*/, (m) => ({ kind: 'strong', text: m[1]! })],
    [/^\*([^*]+)\*/, (m) => ({ kind: 'em', text: m[1]! })],
    // Underscore forms only at a word boundary — see `wordChar` above.
    [/^__([^_]+)__/, (m) => ({ kind: 'strong', text: m[1]! })],
    [/^_([^_]+)_/, (m) => ({ kind: 'em', text: m[1]! })],
  ];

  let plain = '';
  const flush = () => {
    if (plain) out.push({ kind: 'text', text: plain });
    plain = '';
  };

  while (rest.length > 0) {
    let matched = false;
    for (const [re, make] of rules) {
      // `_`-led rules are the only ones sensitive to what precedes them.
      if (rest.startsWith('_') && wordChar(prev)) break;

      const m = rest.match(re);
      if (!m) continue;
      const token = make(m);
      if (token === null) continue;

      flush();
      out.push(token);
      rest = rest.slice(m[0].length);
      prev = m[0].slice(-1);
      matched = true;
      break;
    }
    if (!matched) {
      plain += rest[0];
      prev = rest[0]!;
      rest = rest.slice(1);
    }
  }
  flush();

  // Merge adjacent text runs. A rejected link emits its literal source and
  // then the remaining characters accumulate separately, which would otherwise
  // leave the stream split at an arbitrary point — harmless to render, but it
  // makes the tokens awkward to reason about and to assert on.
  const merged: Inline[] = [];
  for (const token of out) {
    const last = merged[merged.length - 1];
    if (token.kind === 'text' && last?.kind === 'text') last.text += token.text;
    else merged.push(token);
  }
  return merged;
}

/** `- item`, `* item`, `+ item`, `1. item`. Captures leading indent. */
const BULLET = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;

/** `| --- | :--: |` — the row that turns the line above it into a header. */
const DELIMITER = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)*\|?\s*$/;

/** Split a table row on unescaped pipes, dropping the outer pair. */
export function splitRow(line: string): string[] {
  const cells: string[] = [];
  let cur = '';
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (c === '\\' && line[i + 1] === '|') {
      cur += '|';
      i++;
    } else if (c === '|') {
      cells.push(cur);
      cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  // A leading and trailing pipe are the conventional border, not empty cells.
  if (cells.length && cells[0]!.trim() === '') cells.shift();
  if (cells.length && cells[cells.length - 1]!.trim() === '') cells.pop();
  return cells.map((c) => c.trim());
}

function alignOf(cell: string): Align {
  const c = cell.trim();
  const left = c.startsWith(':');
  const right = c.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

/**
 * Consume a run of list lines starting at `i`, honouring indentation.
 *
 * Returns the block and the index after it. Items deeper than the run's base
 * indent become a nested list on the item above them; non-bullet lines that are
 * indented under an item are that item's continuation, which is what makes a
 * wrapped list item stay one item instead of becoming a stray paragraph.
 */
function parseList(lines: string[], start: number): [Block, number] {
  const first = lines[start]!.match(BULLET)!;
  const baseIndent = first[1]!.length;
  const ordered = /^\d+\./.test(first[2]!);
  const startNum = ordered ? parseInt(first[2]!, 10) : 1;

  const items: ListItem[] = [];
  let i = start;

  while (i < lines.length) {
    const line = lines[i]!;
    if (line.trim() === '') break;

    const m = line.match(BULLET);
    if (!m) break;

    const indent = m[1]!.length;
    if (indent < baseIndent) break;

    if (indent > baseIndent) {
      // Deeper: belongs to the item above as a nested list.
      const [child, next] = parseList(lines, i);
      const last = items[items.length - 1];
      if (last) last.children = child;
      else items.push({ inline: [], checked: null, children: child });
      i = next;
      continue;
    }

    // A sibling item at this level.
    let text = m[3]!;
    let checked: boolean | null = null;
    const task = text.match(/^\[([ xX])\]\s+(.*)$/);
    if (task) {
      checked = task[1]!.toLowerCase() === 'x';
      text = task[2]!;
    }

    // Continuation lines: indented further, and not themselves bullets.
    const parts = [text];
    i++;
    while (i < lines.length) {
      const cont = lines[i]!;
      if (cont.trim() === '' || BULLET.test(cont)) break;
      if (cont.length - cont.trimStart().length <= baseIndent) break;
      parts.push(cont.trim());
      i++;
    }

    items.push({ inline: parseInline(parts.join(' ')), checked, children: null });
  }

  return [{ kind: 'list', ordered, start: startNum, items }, i];
}

/** Parse a document into blocks. */
export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, '\n').split('\n');
  const out: Block[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i]!;

    if (line.trim() === '') {
      i++;
      continue;
    }

    // Fenced code. Everything inside is literal, including things that look
    // like other markdown — that is the entire point of a fence. The closing
    // fence must be at least as long as the opening one, so a ```` ```` ````
    // block can contain ``` verbatim.
    const fence = line.match(/^(\s*)(`{3,}|~{3,})\s*(\S*)/);
    if (fence) {
      const marker = fence[2]!;
      const closer = new RegExp(`^\\s*${marker[0] === '`' ? '`' : '~'}{${marker.length},}\\s*$`);
      const body: string[] = [];
      i++;
      while (i < lines.length && !closer.test(lines[i]!)) {
        body.push(lines[i]!);
        i++;
      }
      out.push({ kind: 'code', lang: fence[3] ?? '', text: body.join('\n') });
      i++; // step past the closing fence
      continue;
    }

    // Thematic break, including the spaced forms (`- - -`). Tested before the
    // bullet rule, which would otherwise claim `- - -` as a one-item list.
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      out.push({ kind: 'hr' });
      i++;
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      out.push({
        kind: 'heading',
        level: heading[1]!.length,
        inline: parseInline(heading[2]!.trim()),
      });
      i++;
      continue;
    }

    // Setext heading: text underlined by === or ---. Checked before paragraph
    // so the underline does not end up as body text. The `---` form is only a
    // heading when there is a line above it to underline; standing alone it is
    // an hr, which the rule above has already claimed.
    const underline = lines[i + 1]?.match(/^\s*(=+|-+)\s*$/);
    if (underline && line.trim() !== '' && !BULLET.test(line)) {
      out.push({
        kind: 'heading',
        level: underline[1]!.startsWith('=') ? 1 : 2,
        inline: parseInline(line.trim()),
      });
      i += 2;
      continue;
    }

    // Table: a row of cells followed by a delimiter row. Both are required —
    // a lone pipe-bearing line is far more likely to be prose or a code
    // fragment than a one-row table.
    if (line.includes('|') && lines[i + 1] !== undefined && DELIMITER.test(lines[i + 1]!)) {
      const head = splitRow(line).map(parseInline);
      const align = splitRow(lines[i + 1]!).map(alignOf);
      i += 2;
      const rows: Inline[][][] = [];
      while (i < lines.length && lines[i]!.trim() !== '' && lines[i]!.includes('|')) {
        rows.push(splitRow(lines[i]!).map(parseInline));
        i++;
      }
      out.push({ kind: 'table', head, align, rows });
      continue;
    }

    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        body.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      out.push({ kind: 'quote', inline: parseInline(body.join(' ')) });
      continue;
    }

    if (BULLET.test(line)) {
      const [block, next] = parseList(lines, i);
      out.push(block);
      i = next;
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^\s*(#{1,6}\s|>|`{3,}|~{3,})/.test(lines[i]!) &&
      !BULLET.test(lines[i]!)
    ) {
      body.push(lines[i]!);
      i++;
    }
    out.push({ kind: 'paragraph', inline: parseInline(body.join(' ')) });
  }

  return out;
}
