import net from 'net';
import { SOCKET_PATH } from '../config/constants.js';

/** How long a single CLI request waits for the broker before giving up. */
export const BROKER_REQUEST_TIMEOUT_MS = 35_000;

/**
 * Resolves which harness identity a `talk join` should use.
 * Explicit CLI option wins, then the TALK_HARNESS environment variable,
 * defaulting to 'claude'.
 */
export function resolveTalkHarness(option?: string, env: NodeJS.ProcessEnv = process.env): 'claude' | 'muse' {
  const value = option ?? env.TALK_HARNESS ?? 'claude';
  if (value !== 'claude' && value !== 'muse') {
    throw new Error(`Invalid harness '${value}': expected 'claude' or 'muse'`);
  }
  return value;
}

/**
 * Sends a JSON-RPC request to the broker and returns the result.
 *
 * The promise always settles: a broker that accepts the connection and then
 * goes away, or never answers, produces an error instead of hanging the CLI.
 * Partial TCP chunks are buffered until a full newline-delimited line arrives.
 */
export function brokerRequest(
  method: string,
  params: Record<string, unknown>,
  socketPath: string = SOCKET_PATH,
  timeoutMs: number = BROKER_REQUEST_TIMEOUT_MS
): Promise<any> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const finish = (err: Error | null, result?: unknown) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (err) reject(err);
      else resolve(result);
    };

    const socket = net.createConnection(socketPath, () => {
      const request = { jsonrpc: '2.0', id: 1, method, params };
      socket.write(JSON.stringify(request) + '\n');
    });

    const timer = setTimeout(
      () => finish(new Error(`Timed out after ${timeoutMs / 1000}s waiting for the broker.`)),
      timeoutMs
    );

    let buffer = '';
    socket.on('data', (data) => {
      buffer += data.toString();
      const lines = buffer.split('\n');
      // The final element is either empty or a partial line; keep it buffered.
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const response = JSON.parse(line);
          if (response.error) finish(new Error(response.error.message));
          else finish(null, response.result);
          return;
        } catch {
          // Not valid JSON: skip this line and keep reading.
        }
      }
    });

    socket.on('close', () => {
      finish(new Error('Broker closed the connection before responding.'));
    });

    socket.on('error', (err) => {
      finish(
        new Error(
          `Cannot connect to broker. Is it running?\n  Start it with: claude-muse talk broker\n  Error: ${err.message}`
        )
      );
    });
  });
}
