/**
 * Mock HTTP server simulating Meta Model API for offline testing.
 * @module test/fixtures/mock-meta-api
 */

import http from 'http';

export interface MockServerInfo {
  server: http.Server;
  port: number;
  baseUrl: string;
  close: () => Promise<void>;
}

export function startMockMetaServer(): Promise<MockServerInfo> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '', `http://${req.headers.host}`);
      const auth = req.headers.authorization;

      if (!auth || !auth.startsWith('Bearer ')) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'Missing or invalid token' } }));
        return;
      }

      if (url.pathname === '/v1/models' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            data: [
              {
                id: 'muse-spark-1.3',
                name: 'Muse Spark 1.3',
                created: 1725235200,
                owned_by: 'meta',
                description: 'Latest Muse Spark model for agentic coding',
              },
              {
                id: 'muse-spark-1.3-contributor',
                name: 'Muse Spark 1.3 (Contributor)',
                created: 1725235200,
                owned_by: 'meta',
                description: 'Contributor tier with training data opt-in',
              },
              {
                id: 'sam-3',
                name: 'Segment Anything Model 3',
                created: 1725000000,
                owned_by: 'meta',
              },
            ],
          })
        );
        return;
      }

      if (url.pathname === '/v1/messages' && req.method === 'POST') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        res.write('event: message_start\ndata: {"type":"message_start","message":{"id":"msg_123"}}\n\n');
        res.write(
          'event: content_block_delta\ndata: {"type":"content_block_delta","delta":{"type":"text_delta","text":"Hello"}}\n\n'
        );
        res.write('event: message_stop\ndata: {"type":"message_stop"}\n\n');
        res.end();
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found' } }));
    });

    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as any;
      const port = address.port;
      const baseUrl = `http://127.0.0.1:${port}/v1`;

      resolve({
        server,
        port,
        baseUrl,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
