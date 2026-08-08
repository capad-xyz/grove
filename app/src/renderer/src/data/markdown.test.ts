import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseInline, parseMarkdown, safeHref } from './markdown.ts';

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

test('inline parsing always reproduces the original characters', () => {
  // Any dropped or duplicated character would be a rendering bug that silently
  // changes what a document says.
  for (const src of [
    'plain',
    'a **b** c',
    '`code` and *em*',
    '[l](https://x.test) tail',
    '**unclosed',
    'a_b_c',
  ]) {
    const rebuilt = parseInline(src)
      .map((t) =>
        t.kind === 'text'
          ? t.text
          : t.kind === 'strong'
            ? `**${t.text}**`
            : t.kind === 'em'
              ? `_${t.text}_`
              : t.kind === 'code'
                ? `\`${t.text}\``
                : `[${t.text}](${t.href})`,
      )
      .join('');
    assert.equal(rebuilt.replace(/[*_]/g, ''), src.replace(/[*_]/g, ''), `for ${src}`);
  }
});
