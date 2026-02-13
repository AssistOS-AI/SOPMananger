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

test('All rendered data-action values have click/submit handlers', async () => {
  const filePath = path.join(__dirname, '..', 'src', 'public', 'app.js');
  const content = await fs.readFile(filePath, 'utf8');

  const declaredActions = extractMatches(content, /data-action="([a-z0-9-]+)"/g);
  const handledActions = extractMatches(content, /action === '([a-z0-9-]+)'/g);

  const missing = [...declaredActions].filter((action) => !handledActions.has(action));
  assert.deepEqual(missing, []);
});
