import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function extractMatches(content, regex) {
  const values = new Set();
  let match;
  // eslint-disable-next-line no-cond-assign
  while ((match = regex.exec(content)) !== null) {
    values.add(match[1]);
  }
  return values;
}

async function listScriptFiles(rootDir) {
  const files = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      const target = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // eslint-disable-next-line no-await-in-loop
        await walk(target);
        continue;
      }
      if (entry.isFile() && (target.endsWith('.js') || target.endsWith('.mjs'))) {
        files.push(target);
      }
    }
  }
  await walk(rootDir);
  return files;
}

test('All rendered data-action values have click/submit handlers', async () => {
  const publicRoot = path.join(__dirname, '..', 'src', 'public');
  const allFiles = await listScriptFiles(publicRoot);

  const declaredActions = new Set();
  const handledActions = new Set();

  for (const filePath of allFiles) {
    // eslint-disable-next-line no-await-in-loop
    const content = await fs.readFile(filePath, 'utf8');
    for (const value of extractMatches(content, /data-action="([a-z0-9-]+)"/g)) {
      declaredActions.add(value);
    }
    for (const value of extractMatches(content, /action === '([a-z0-9-]+)'/g)) {
      handledActions.add(value);
    }
  }

  const missing = [...declaredActions].filter((action) => !handledActions.has(action));
  assert.deepEqual(missing, []);
});
