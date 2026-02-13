import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createApp } from './app.mjs';

export async function createServer(options = {}) {
  const app = await createApp(options);
  const server = http.createServer(async (req, res) => {
    try {
      await app.handleRequest(req, res);
    } catch (error) {
      app.errorHandler(res, error);
    }
  });

  return {
    app,
    server,
  };
}

export async function startServer(options = {}) {
  const port = Number(options.port || process.env.PORT || 3000);
  const host = options.host || process.env.HOST || '127.0.0.1';
  const { server, app } = await createServer(options);

  await new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off('listening', onListening);
      reject(error);
    };
    const onListening = () => {
      server.off('error', onError);
      resolve();
    };

    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, host);
  });

  const address = server.address();
  app.logger(`SOP Manager server listening on http://${address.address}:${address.port}`);

  return { server, app };
}

const entryUrl = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entryUrl && import.meta.url === entryUrl) {
  startServer().catch((error) => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
  });
}
