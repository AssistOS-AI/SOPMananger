import { HttpError } from './http.mjs';

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compilePathPattern(pattern) {
  const paramNames = [];
  const segments = pattern.split('/').filter(Boolean);

  const regexParts = segments.map((segment) => {
    if (segment.startsWith(':')) {
      const name = segment.slice(1);
      if (!name) {
        throw new Error(`Invalid path segment in "${pattern}".`);
      }
      paramNames.push(name);
      return '([^/]+)';
    }
    return escapeRegExp(segment);
  });

  const source = `^/${regexParts.join('/')}/?$`;
  const regex = new RegExp(source);

  return { regex, paramNames };
}

export class Router {
  constructor() {
    this.routes = [];
  }

  add(method, pattern, handler) {
    if (typeof handler !== 'function') {
      throw new Error('Route handler must be a function.');
    }
    const upperMethod = method.toUpperCase();
    const compiled = compilePathPattern(pattern);

    this.routes.push({
      method: upperMethod,
      pattern,
      handler,
      ...compiled,
    });
  }

  async handle(req, res, context = {}) {
    const method = req.method.toUpperCase();
    const path = context.pathname ?? '/';

    for (const route of this.routes) {
      if (route.method !== method) {
        continue;
      }

      const match = route.regex.exec(path);
      if (!match) {
        continue;
      }

      const params = {};
      route.paramNames.forEach((name, index) => {
        params[name] = decodeURIComponent(match[index + 1] ?? '');
      });

      return route.handler(req, res, {
        ...context,
        params,
      });
    }

    throw new HttpError(404, 'Route not found.');
  }
}
