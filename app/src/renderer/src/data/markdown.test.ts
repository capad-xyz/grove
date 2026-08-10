import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { Inline } from './markdown.ts';
import { parseInline, parseMarkdown, safeHref, splitRow } from './markdown.ts';

test('rejects every scheme that can execute', () => {
  assert.equal(safeHref('https://capad.fyi'), 'https://capad.fyi');
  assert.equal(safeHref('http://x.test'), 'http://x.test');
  assert.equal(safeHref('mailto:oss@capad.fyi'), 'mailto:oss@capad.fyi');

  assert.equal(safeHref('javascript:alert(1)'), null);
  assert.equal(safeHref('JaVaScRiPt:alert(1)'), null);
  // data: can carry HTML, so it is refused even though it looks inert.
  assert.equal(safeHref('data:text/html,<script>x</script>'), null);
  assert.equal(safeHref('./relative.md'), null);
});

test('an unsafe link renders as literal text, not an anchor', () => {
  const out = parseInline('[click](javascript:alert(1))');
  assert.deepEqual(out, [{ kind: 'text', text: '[click](javascript:alert(1))' }]);
});

test('raw HTML is text, never markup', () => {
  // The parser has no concept of HTML; a script tag is characters, and the
  // renderer puts characters in a text node.
  const blocks = parseMarkdown('<script>alert(1)</script>');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.kind, 'paragraph');
  assert.deepEqual(blocks[0]!.kind === 'paragraph' && blocks[0]!.inline, [
    { kind: 'text', text: '<script>alert(1)</script>' },
  ]);
});

test('parses headings at every level', () => {
  const blocks = parseMarkdown('# One\n\n### Three');
  assert.deepEqual(
    blocks.map((b) => b.kind === 'heading' && b.level),
    [1, 3],
  );
});

test('parses emphasis, code and links inline', () => {
  const out = parseInline('a **b** c `d` e [f](https://g.test)');
  assert.deepEqual(out, [
    { kind: 'text', text: 'a ' },
    { kind: 'strong', text: 'b' },
    { kind: 'text', text: ' c ' },
    { kind: 'code', text: 'd' },
    { kind: 'text', text: ' e ' },
    { kind: 'link', text: 'f', href: 'https://g.test' },
  ]);
});

test('code spans win over emphasis inside them', () => {
  // Otherwise `**not bold**` in a code span would render bold, which is wrong
  // and, in a diff of markdown source, actively misleading.
  const out = parseInline('`**not bold**`');
  assert.deepEqual(out, [{ kind: 'code', text: '**not bold**' }]);
});

test('fenced code keeps its contents literal', () => {
  const blocks = parseMarkdown('```ts\nconst x = **1**;\n# not a heading\n```');
  assert.equal(blocks.length, 1);
  assert.deepEqual(blocks[0], {
    kind: 'code',
    lang: 'ts',
    text: 'const x = **1**;\n# not a heading',
  });
});

test('parses both kinds of list', () => {
  const blocks = parseMarkdown('- one\n- two');
  assert.equal(blocks[0]!.kind, 'list');
  assert.equal(blocks[0]!.kind === 'list' && blocks[0]!.ordered, false);
  assert.equal(blocks[0]!.kind === 'list' && blocks[0]!.items.length, 2);

  const ordered = parseMarkdown('1. one\n2. two');
  assert.equal(ordered[0]!.kind === 'list' && ordered[0]!.ordered, true);
});

test('an ordered list keeps the number it started at', () => {
  const blocks = parseMarkdown('3. three\n4. four');
  assert.equal(blocks[0]!.kind === 'list' && blocks[0]!.start, 3);
});

test('a nested list hangs off the item above it', () => {
  const blocks = parseMarkdown('- outer\n  - inner one\n  - inner two\n- outer two');
  const list = blocks[0]!;
  assert.equal(list.kind, 'list');
  if (list.kind !== 'list') return;

  // Flattening this was the old behaviour: four siblings, indentation lost.
  assert.equal(list.items.length, 2);
  const child = list.items[0]!.children;
  assert.equal(child?.kind, 'list');
  assert.equal(child?.kind === 'list' && child.items.length, 2);
  assert.equal(list.items[1]!.children, null);
});

test('a wrapped list item stays one item', () => {
  const blocks = parseMarkdown('- a list item that\n  continues on the next line');
  const list = blocks[0]!;
  assert.equal(list.kind === 'list' && list.items.length, 1);
  assert.deepEqual(list.kind === 'list' && list.items[0]!.inline, [
    { kind: 'text', text: 'a list item that continues on the next line' },
  ]);
});

test('task list boxes carry their state, and plain items carry none', () => {
  const blocks = parseMarkdown('- [ ] todo\n- [x] done\n- [X] also done\n- plain');
  const list = blocks[0]!;
  assert.equal(list.kind, 'list');
  if (list.kind !== 'list') return;
  assert.deepEqual(
    list.items.map((i) => i.checked),
    [false, true, true, null],
  );
  // The marker is consumed, not left in the text.
  assert.deepEqual(list.items[0]!.inline, [{ kind: 'text', text: 'todo' }]);
});

test('parses quotes and rules', () => {
  const blocks = parseMarkdown('> quoted\n\n---');
  assert.deepEqual(blocks.map((b) => b.kind), ['quote', 'hr']);
});

test('joins wrapped paragraph lines', () => {
  const blocks = parseMarkdown('one\ntwo\n\nthree');
  assert.equal(blocks.length, 2);
  assert.deepEqual(blocks[0]!.kind === 'paragraph' && blocks[0]!.inline, [
    { kind: 'text', text: 'one two' },
  ]);
});

test('a heading immediately after a paragraph still parses', () => {
  const blocks = parseMarkdown('text\n# Heading');
  assert.deepEqual(blocks.map((b) => b.kind), ['paragraph', 'heading']);
});

test('empty input yields no blocks', () => {
  assert.deepEqual(parseMarkdown(''), []);
  assert.deepEqual(parseMarkdown('\n\n  \n'), []);
});

test('an underscore inside a word is not emphasis', () => {
  // Grove previews technical documentation. `snake_case_name` is one
  // identifier, and rendering it as snake<em>case</em>name silently corrupts
  // the thing the reader came to read.
  assert.deepEqual(parseInline('snake_case_name'), [
    { kind: 'text', text: 'snake_case_name' },
  ]);
  assert.deepEqual(parseInline('MAX_BUFFER_SIZE and PATH_MAX'), [
    { kind: 'text', text: 'MAX_BUFFER_SIZE and PATH_MAX' },
  ]);
  // At a word boundary it still means emphasis.
  assert.deepEqual(parseInline('_real em_'), [{ kind: 'em', text: 'real em' }]);
  assert.deepEqual(parseInline('(_yes_)'), [
    { kind: 'text', text: '(' },
    { kind: 'em', text: 'yes' },
    { kind: 'text', text: ')' },
  ]);
});

test('parses images, and never as a link with a stray bang', () => {
  assert.deepEqual(parseInline('![a shot](docs/shot.png)'), [
    { kind: 'image', alt: 'a shot', src: 'docs/shot.png' },
  ]);
  // A relative src is kept verbatim: resolving it needs the document's path,
  // which is the renderer's job, not the parser's.
  assert.deepEqual(parseInline('![](../logo.svg)'), [
    { kind: 'image', alt: '', src: '../logo.svg' },
  ]);
});

test('parses strikethrough and autolinks', () => {
  assert.deepEqual(parseInline('this is ~~gone~~'), [
    { kind: 'text', text: 'this is ' },
    { kind: 'strike', text: 'gone' },
  ]);
  assert.deepEqual(parseInline('<https://x.test>'), [
    { kind: 'link', text: 'https://x.test', href: 'https://x.test' },
  ]);
  // Angle brackets around anything else stay literal, so `<div>` in prose
  // still looks like `<div>`.
  assert.deepEqual(parseInline('<div>'), [{ kind: 'text', text: '<div>' }]);
});

test('parses a GFM table with alignment', () => {
  const blocks = parseMarkdown('| a | b | c |\n|:--|:-:|--:|\n| 1 | 2 | 3 |\n| 4 | 5 | 6 |');
  const table = blocks[0]!;
  assert.equal(table.kind, 'table');
  if (table.kind !== 'table') return;

  assert.deepEqual(table.align, ['left', 'center', 'right']);
  assert.equal(table.head.length, 3);
  assert.equal(table.rows.length, 2);
  assert.deepEqual(table.rows[1], [
    [{ kind: 'text', text: '4' }],
    [{ kind: 'text', text: '5' }],
    [{ kind: 'text', text: '6' }],
  ]);
});

test('table cells parse inline markup', () => {
  const blocks = parseMarkdown('| cmd | what |\n|---|---|\n| `pytest -q` | runs **fast** |');
  const table = blocks[0]!;
  assert.equal(table.kind === 'table' && table.rows[0]![0]![0]!.kind, 'code');
  assert.deepEqual(table.kind === 'table' && table.rows[0]![1], [
    { kind: 'text', text: 'runs ' },
    { kind: 'strong', text: 'fast' },
  ]);
});

test('a pipe in prose is not a table without a delimiter row', () => {
  // `a | b` appears constantly in shell examples and type unions. Requiring the
  // delimiter row is what stops those becoming one-row tables.
  const blocks = parseMarkdown('run `foo | bar` to pipe');
  assert.equal(blocks[0]!.kind, 'paragraph');
});

test('an escaped pipe stays inside its cell', () => {
  assert.deepEqual(splitRow('| a \\| b | c |'), ['a | b', 'c']);
});

test('setext headings, and the hr that looks like one', () => {
  assert.deepEqual(
    parseMarkdown('Title\n=====').map((b) => b.kind === 'heading' && b.level),
    [1],
  );
  assert.deepEqual(
    parseMarkdown('Title\n-----').map((b) => b.kind === 'heading' && b.level),
    [2],
  );
  // With nothing above it to underline, the same characters are a rule.
  assert.deepEqual(parseMarkdown('para\n\n---').map((b) => b.kind), ['paragraph', 'hr']);
});

test('thematic breaks in their spaced forms', () => {
  for (const src of ['- - -', '***', '_ _ _', '- - - -']) {
    assert.deepEqual(parseMarkdown(src).map((b) => b.kind), ['hr'], `for ${src}`);
  }
});

test('tilde fences hold code as literally as backtick fences', () => {
  const blocks = parseMarkdown('~~~js\nconst x = **1**;\n~~~');
  assert.deepEqual(blocks[0], { kind: 'code', lang: 'js', text: 'const x = **1**;' });
});

test('a longer fence can contain a shorter one', () => {
  const blocks = parseMarkdown('````\n```\ninner\n```\n````');
  assert.equal(blocks.length, 1);
  assert.equal(blocks[0]!.kind === 'code' && blocks[0]!.text, '```\ninner\n```');
});

test('inline parsing always reproduces the original characters', () => {
  // Any dropped or duplicated character would be a rendering bug that silently
  // changes what a document says.
  // The switch is exhaustive on purpose: adding an Inline kind without
  // teaching this test to rebuild it is a compile error, not a silent gap.
  const rebuild = (t: Inline): string => {
    switch (t.kind) {
      case 'text':
        return t.text;
      case 'strong':
        return `**${t.text}**`;
      case 'em':
        return `_${t.text}_`;
      case 'strike':
        return `~~${t.text}~~`;
      case 'code':
        return `\`${t.text}\``;
      case 'link':
        return `[${t.text}](${t.href})`;
      case 'image':
        return `![${t.alt}](${t.src})`;
    }
  };

  for (const src of [
    'plain',
    'a **b** c',
    '`code` and *em*',
    '[l](https://x.test) tail',
    '**unclosed',
    'a_b_c',
    'MAX_BUFFER_SIZE',
    '~~struck~~ through',
    '![alt](docs/a.png) after',
    'mixed ![i](a.png) and [l](https://x.test) and `c`',
  ]) {
    const rebuilt = parseInline(src).map(rebuild).join('');
    // Emphasis markers are normalised (`*em*` rebuilds as `_em_`), so they are
    // excluded from the comparison; every other character must survive.
    assert.equal(rebuilt.replace(/[*_]/g, ''), src.replace(/[*_]/g, ''), `for ${src}`);
  }
});
