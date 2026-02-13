import { randomUUID } from 'node:crypto';

export class HttpError extends Error {
  constructor(status, message, details = null) {
    super(message);
    this.name = 'HttpError';
    this.status = status;
    this.details = details;
  }
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'same-origin',
  'Content-Security-Policy': "default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
};

function withSecurityHeaders(headers = {}) {
  return {
    ...SECURITY_HEADERS,
    ...headers,
  };
}

export async function readBody(req, maxBytes = 1_000_000) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new HttpError(413, 'Request body is too large.');
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks).toString('utf8');
}

export async function readJsonBody(req, maxBytes = 1_000_000) {
  const raw = await readBody(req, maxBytes);
  if (!raw) {
    return {};
  }

  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Invalid JSON payload.');
  }
}

export function sendJson(res, status, payload, extraHeaders = {}) {
  const data = JSON.stringify(payload);
  res.writeHead(status, {
    ...withSecurityHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(data),
    ...extraHeaders,
  });
  res.end(data);
}

export function sendHtml(res, status, html, extraHeaders = {}) {
  res.writeHead(status, {
    ...withSecurityHeaders(),
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Length': Buffer.byteLength(html),
    ...extraHeaders,
  });
  res.end(html);
}

export function sendNoContent(res, extraHeaders = {}) {
  res.writeHead(204, withSecurityHeaders(extraHeaders));
  res.end();
}

export function parseCookies(cookieHeader = '') {
  return cookieHeader
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .reduce((acc, part) => {
      const index = part.indexOf('=');
      if (index === -1) {
        return acc;
      }
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (!key) {
        return acc;
      }
      acc[key] = decodeURIComponent(value);
      return acc;
    }, {});
}

export function buildCookie(name, value, options = {}) {
  const {
    httpOnly = true,
    secure = false,
    sameSite = 'Lax',
    path = '/',
    maxAge = null,
  } = options;

  const parts = [`${name}=${encodeURIComponent(value)}`, `Path=${path}`, `SameSite=${sameSite}`];
  if (httpOnly) {
    parts.push('HttpOnly');
  }
  if (secure) {
    parts.push('Secure');
  }
  if (Number.isInteger(maxAge)) {
    parts.push(`Max-Age=${maxAge}`);
  }
  return parts.join('; ');
}

export function escapeHtml(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function jsonErrorResponse(res, error) {
  if (error instanceof HttpError) {
    sendJson(res, error.status, {
      error: error.message,
      details: error.details ?? undefined,
    });
    return;
  }

  sendJson(res, 500, {
    error: 'Internal Server Error',
    requestId: randomUUID(),
  });
}
