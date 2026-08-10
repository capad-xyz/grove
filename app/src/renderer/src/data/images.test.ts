import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  base64Size,
  imageFiles,
  isImage,
  isRemote,
  mimeFor,
  resolveRepoPath,
} from './images.ts';

test('recognises the image types we render', () => {
  assert.equal(mimeFor('a/b/logo.png'), 'image/png');
  assert.equal(mimeFor('photo.JPG'), 'image/jpeg');
  assert.equal(mimeFor('icon.svg'), 'image/svg+xml');
  assert.equal(mimeFor('anim.webp'), 'image/webp');
});

test('anything else is not an image', () => {
  assert.equal(mimeFor('src/index.ts'), null);
  assert.equal(mimeFor('README.md'), null);
  assert.equal(mimeFor('no-extension'), null);
  assert.equal(isImage('src/png.ts'), false); // extension, not a substring
});

test('finds image files in a patch', () => {
  const patch = [
    'diff --git a/app/icon.png b/app/icon.png',
    'index 111..222 100644',
    'Binary files a/app/icon.png and b/app/icon.png differ',
    'diff --git a/src/read.ts b/src/read.ts',
    '@@ -1,2 +1,2 @@',
    '-old',
    '+new',
  ].join('\n');
  assert.deepEqual(imageFiles(patch), ['app/icon.png']);
});

test('finds an added image, where +++/--- would have lost the name', () => {
  // git writes /dev/null on one side of an add, so reading the ---/+++ lines
  // loses the filename exactly when a new image is what you want to see.
  const patch = [
    'diff --git a/packaging/icon.png b/packaging/icon.png',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/packaging/icon.png',
  ].join('\n');
  assert.deepEqual(imageFiles(patch), ['packaging/icon.png']);
});

test('handles paths containing spaces', () => {
  const patch = 'diff --git a/my folder/my image.png b/my folder/my image.png';
  assert.deepEqual(imageFiles(patch), ['my folder/my image.png']);
});

test('deduplicates and preserves order', () => {
  const patch = [
    'diff --git a/b.png b/b.png',
    'diff --git a/a.svg b/a.svg',
    'diff --git a/b.png b/b.png',
  ].join('\n');
  assert.deepEqual(imageFiles(patch), ['b.png', 'a.svg']);
});

test('a patch with no images yields nothing', () => {
  assert.deepEqual(imageFiles('diff --git a/x.ts b/x.ts\n+hello'), []);
  assert.deepEqual(imageFiles(''), []);
});

test('base64Size accounts for padding', () => {
  // "AAAA" is 3 bytes; "AAA=" is 2; "AA==" is 1.
  assert.equal(base64Size('AAAA'), '3 B');
  assert.equal(base64Size('AAA='), '2 B');
  assert.equal(base64Size('AA=='), '1 B');
  assert.equal(base64Size('A'.repeat(4096)), '3.0 KB');
});

test('resolves a relative image against the document that references it', () => {
  assert.equal(resolveRepoPath('docs/PRD.md', 'shot.png'), 'docs/shot.png');
  assert.equal(resolveRepoPath('docs/PRD.md', './shot.png'), 'docs/shot.png');
  assert.equal(resolveRepoPath('docs/PRD.md', '../logo.svg'), 'logo.svg');
  assert.equal(resolveRepoPath('README.md', 'docs/a/b.png'), 'docs/a/b.png');
  assert.equal(resolveRepoPath('a/b/c.md', '../../top.png'), 'top.png');
  // A leading slash means the repository root, not the filesystem root.
  assert.equal(resolveRepoPath('docs/PRD.md', '/assets/x.png'), 'assets/x.png');
  // Query and fragment are addressing for the web, not part of the path.
  assert.equal(resolveRepoPath('README.md', 'x.png?v=2#frag'), 'x.png');
});

test('a relative image cannot escape the repository', () => {
  // Refused rather than clamped: clamping would silently resolve to some other
  // real file, which is worse than showing nothing.
  assert.equal(resolveRepoPath('README.md', '../../../etc/passwd'), null);
  assert.equal(resolveRepoPath('docs/PRD.md', '../../secrets.env'), null);
  assert.equal(resolveRepoPath('README.md', ''), null);
  assert.equal(resolveRepoPath('README.md', '.'), null);
});

test('remote sources are recognised so they are never fetched', () => {
  assert.equal(isRemote('https://example.com/badge.svg'), true);
  assert.equal(isRemote('http://x.test/a.png'), true);
  assert.equal(isRemote('data:image/png;base64,AAAA'), true);
  assert.equal(isRemote('javascript:alert(1)'), true);

  assert.equal(isRemote('docs/shot.png'), false);
  assert.equal(isRemote('./a.png'), false);
  assert.equal(isRemote('/assets/a.png'), false);
});
