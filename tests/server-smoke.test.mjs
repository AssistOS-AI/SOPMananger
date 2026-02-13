import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createApp } from '../src/app.mjs';

function createMockRequest({ method = 'GET', url = '/', headers = {}, body = '' } = {}) {
  const chunks = body ? [Buffer.from(body)] : [];
  const req = Readable.from(chunks);
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function createMockResponse() {
  const state = {
    statusCode: 200,
    headers: {},
    body: '',
  };
  return {
    writeHead(statusCode, headers = {}) {
      state.statusCode = statusCode;
      state.headers = headers;
    },
    end(chunk = '') {
      if (chunk) {
        state.body += chunk;
      }
    },
    getState() {
      return state;
    },
  };
}

test('App request handler responds on /health', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sop-server-test-'));
  const app = await createApp({
    dataRoot: root,
    quiet: true,
    llmEnabled: false,
  });

  const req = createMockRequest({ method: 'GET', url: '/health' });
  const res = createMockResponse();
  await app.handleRequest(req, res);

  const response = res.getState();
  const body = JSON.parse(response.body);

  assert.equal(response.statusCode, 200);
  assert.equal(body.ok, true);

  await fs.rm(root, { recursive: true, force: true });
});
