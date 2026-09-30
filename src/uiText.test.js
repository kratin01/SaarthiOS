import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';

const root = fileURLToPath(new URL('.', import.meta.url));
const LONG_DASH = /[\u2013\u2014]/;

const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return files(path);
    return entry.name.endsWith('.js') && !entry.name.endsWith('.test.js') ? [path] : [];
  });

test('text sent to users, the model and the logs never uses em or en dashes', () => {
  const found = [];
  for (const file of files(root)) {
    readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
      const code = line.trim();
      if (/^(\*|\/\*|\/\/)/.test(code)) return;
      if (LONG_DASH.test(code.replace(/\s\/\/\s.*$/, ''))) {
        found.push(`${relative(root, file)}:${index + 1}`);
      }
    });
  }
  assert.deepEqual(found, []);
});
