import assert from 'node:assert/strict';
import { test } from 'node:test';

import { base64Size, imageFiles, isImage, mimeFor } from './images.ts';

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
