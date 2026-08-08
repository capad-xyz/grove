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
 */

export type Inline =
  | { kind: 'text'; text: string }
  | { kind: 'strong'; text: string }
  | { kind: 'em'; text: string }
  | { kind: 'code'; text: string }
  | { kind: 'link'; text: string; href: string };

export type Block =
  | { kind: 'heading'; level: number; inline: Inline[] }
  | { kind: 'paragraph'; inline: Inline[] }
  | { kind: 'code'; lang: string; text: string }
  | { kind: 'list'; ordered: boolean; items: Inline[][] }
  | { kind: 'quote'; inline: Inline[] }
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

/** Parse the inline span of one block. */
export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let rest = src;

  // Ordered by precedence: code first, so `**` inside backticks stays literal.
  const rules: [RegExp, (m: RegExpMatchArray) => Inline][] = [
    [/^`([^`]+)`/, (m) => ({ kind: 'code', text: m[1]! })],
    [
      /^\[([^\]]*)\]\(([^)\s]+)\)/,
      (m) => {
        const href = safeHref(m[2]!);
        return href
          ? { kind: 'link', text: m[1]!, href }
          : { kind: 'text', text: `[${m[1]}](${m[2]})` };
      },
    ],
    [/^\*\*([^*]+)\*\*/, (m) => ({ kind: 'strong', text: m[1]! })],
    [/^__([^_]+)__/, (m) => ({ kind: 'strong', text: m[1]! })],
    [/^\*([^*]+)\*/, (m) => ({ kind: 'em', text: m[1]! })],
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
      const m = rest.match(re);
      if (m) {
        flush();
        out.push(make(m));
        rest = rest.slice(m[0].length);
        matched = true;
        break;
      }
    }
    if (!matched) {
      plain += rest[0];
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
    // like other markdown — that is the entire point of a fence.
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      const lang = fence[1] ?? '';
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i]!.startsWith('```')) {
        body.push(lines[i]!);
        i++;
      }
      out.push({ kind: 'code', lang, text: body.join('\n') });
      i++; // step past the closing fence
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
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

    if (line.startsWith('>')) {
      const body: string[] = [];
      while (i < lines.length && lines[i]!.startsWith('>')) {
        body.push(lines[i]!.replace(/^>\s?/, ''));
        i++;
      }
      out.push({ kind: 'quote', inline: parseInline(body.join(' ')) });
      continue;
    }

    const bullet = /^\s*([-*+]|\d+\.)\s+(.*)$/;
    if (bullet.test(line)) {
      const ordered = /^\s*\d+\./.test(line);
      const items: Inline[][] = [];
      while (i < lines.length && bullet.test(lines[i]!)) {
        items.push(parseInline(lines[i]!.match(bullet)![2]!));
        i++;
      }
      out.push({ kind: 'list', ordered, items });
      continue;
    }

    // Paragraph: consume until a blank line or the start of another block.
    const body: string[] = [];
    while (
      i < lines.length &&
      lines[i]!.trim() !== '' &&
      !/^(#{1,6}\s|>|```)/.test(lines[i]!) &&
      !bullet.test(lines[i]!)
    ) {
      body.push(lines[i]!);
      i++;
    }
    out.push({ kind: 'paragraph', inline: parseInline(body.join(' ')) });
  }

  return out;
}
