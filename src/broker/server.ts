import net from 'net';
import fs from 'fs';
import path from 'path';
import { SOCKET_PATH, CONFIG_DIR, MAX_EXCHANGE_MESSAGES } from '../config/constants.js';
import { Journal } from './journal.js';
import { RoomManager } from './room.js';
import { BrokerError } from './types.js';
import {
  type JsonRpcRequest,
  type JsonRpcResponse,
  parseNdjson,
  serializeResponse,
  makeSuccessResponse,
  makeErrorResponse,
  ERROR_CODES,
} from './protocol.js';

/**
 * Unix-domain socket broker server for the /talk protocol.
 */
export class BrokerServer {
  private server: net.Server | null = null;
  private journal: Journal;
  private roomManager: RoomManager;
  private clients: Map<net.Socket, { buffer: string; sessionId?: string }> = new Map();
  private socketPath: string;
  private stopping = false;

  constructor(socketPath?: string, dbPath?: string) {
    this.socketPath = socketPath ?? SOCKET_PATH;
    this.journal = new Journal(dbPath);
    this.roomManager = new RoomManager(this.journal);
  }

  /** Starts the broker, listening on the Unix socket. */
  async start(): Promise<void> {
    const socketDir = path.dirname(this.socketPath);
    if (!fs.existsSync(socketDir)) {
      fs.mkdirSync(socketDir, { recursive: true });
    }

    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }

    await this.journal.init();
    // Rebuild rooms from the journal so a restart does not orphan them.
    this.roomManager.restore();

    this.server = net.createServer((socket) => {
      this.clients.set(socket, { buffer: '' });

      socket.on('data', async (data) => {
        const clientState = this.clients.get(socket);
        if (!clientState) return;

        clientState.buffer += data.toString();
        const { requests, remainder } = parseNdjson(clientState.buffer);
        clientState.buffer = remainder;

        for (const req of requests) {
          await this.handleRequest(socket, req);
        }
      });

      socket.on('close', () => {
        const clientState = this.clients.get(socket);
        if (clientState?.sessionId) {
          try {
            this.roomManager.handleDisconnect(clientState.sessionId);
          } catch {
            // Ignore disconnect errors
          }
        }
        this.clients.delete(socket);
      });

      socket.on('error', () => {
        this.clients.delete(socket);
      });
    });

    await new Promise<void>((resolve) => {
      this.server!.listen(this.socketPath, () => {
        console.log(`Broker listening on ${this.socketPath}`);
        resolve();
      });
    });

  }

  /** Stops the server and cleans up. Safe to call more than once. */
  async stop(): Promise<void> {
    if (this.stopping) return;
    this.stopping = true;

    for (const socket of this.clients.keys()) {
      socket.destroy();
    }
    this.clients.clear();

    // Release the per-room deadline timers. They are 30 minutes long, and
    // while any of them is pending Node keeps the event loop alive, so the
    // broker process would ignore Ctrl+C and linger after its socket closed.
    this.roomManager.shutdown();

    if (this.server) {
      await new Promise<void>((resolve) => this.server!.close(() => resolve()));
      this.server = null;
    }

    this.journal.close();

    if (fs.existsSync(this.socketPath)) {
      fs.unlinkSync(this.socketPath);
    }
  }

  private async handleRequest(socket: net.Socket, request: JsonRpcRequest): Promise<void> {
    try {
      const clientSessionId = this.getSessionId(socket);
      const p = request.params as Record<string, any>;
      let sessionId = clientSessionId ?? p?.sessionId;
      if (!sessionId && p?.room) {
        try {
          sessionId = this.roomManager.getStatus(p.room).room.participants[0]?.sessionId;
        } catch {
          // Room might not exist yet
        }
      }

      switch (request.method) {
        case 'join': {
          requireNonEmptyString(p.room, 'room');
          requireNonEmptyString(p.name, 'name');
          const harness = p.harness ?? 'claude';
          if (harness !== 'claude' && harness !== 'muse') {
            throw new Error(`Invalid harness '${harness}': expected 'claude' or 'muse'`);
          }
          const result = this.roomManager.joinRoom(
            p.room,
            p.sessionId ?? p.name, // sessionId from adapter
            p.name,
            harness,
            p.repoRoot
          );
          const clientState = this.clients.get(socket);
          if (clientState) {
            clientState.sessionId = p.sessionId ?? p.name;
          }
          this.sendResponse(socket, makeSuccessResponse(request.id, {
            room: p.room,
            participantCount: result.room.participants.length,
            waitingForPeer: result.waitingForPeer,
          }));
          break;
        }

        case 'start': {
          requireNonEmptyString(p.room, 'room');
          requireNonEmptyString(p.task, 'task');
          this.roomManager.startExchange(p.room, sessionId!, p.task);
          this.sendResponse(socket, makeSuccessResponse(request.id, {
            room: p.room,
            started: true,
            stage: 'PROPOSAL',
          }));
          break;
        }

        case 'send': {
          requireNonEmptyString(p.room, 'room');
          requireNonEmptyString(p.content, 'content');
          const msg = this.roomManager.sendMessage(p.room, sessionId!, p.content);
          this.sendResponse(socket, makeSuccessResponse(request.id, {
            seq: msg.seq,
            stage: msg.stage,
            remainingMessages: MAX_EXCHANGE_MESSAGES - this.journal.getMessageCount(p.room),
          }));
          break;
        }

        case 'receive': {
          requireNonEmptyString(p.room, 'room');
          const timeoutMs = Math.min(p.timeoutMs ?? 30000, 30000);
          const afterSeq = p.afterSeq ?? 0;
          const start = Date.now();

          const poll = () => {
            // A client that hung up, or a broker that is shutting down, must
            // not keep rescheduling this timer.
            if (this.stopping || socket.destroyed) return;

            // Later polls run from a timer, outside handleRequest's try/catch,
            // so a failure here must be reported rather than thrown.
            try {
              const messages = this.roomManager.receiveMessages(p.room, sessionId!, afterSeq);
              const fromPeer = messages.filter((m) => m.senderId !== sessionId);
              if (fromPeer.length > 0) {
                const lastSeq = Math.max(...fromPeer.map((m) => m.seq));
                this.sendResponse(socket, makeSuccessResponse(request.id, {
                  messages: fromPeer,
                  lastSeq,
                }));
                return;
              }
              if (Date.now() - start >= timeoutMs) {
                this.sendResponse(socket, makeSuccessResponse(request.id, {
                  messages: [],
                  lastSeq: afterSeq,
                }));
                return;
              }
            } catch (err: any) {
              this.sendResponse(socket, makeErrorResponse(
                request.id,
                BrokerError.INVALID_STATE,
                err.message || 'Receive failed'
              ));
              return;
            }
            setTimeout(poll, 200).unref();
          };
          poll();
          break;
        }

        case 'ack': {
          requireNonEmptyString(p.room, 'room');
          if (typeof p.seq !== 'number') {
            throw new Error(`Invalid param 'seq': expected a number`);
          }
          this.roomManager.acknowledgeMessage(p.room, sessionId!, p.seq);
          this.sendResponse(socket, makeSuccessResponse(request.id, { acknowledged: true }));
          break;
        }

        case 'status': {
          requireNonEmptyString(p.room, 'room');
          const status = this.roomManager.getStatus(p.room);
          this.sendResponse(socket, makeSuccessResponse(request.id, status));
          break;
        }

        case 'stop': {
          requireNonEmptyString(p.room, 'room');
          this.roomManager.stopRoom(p.room, sessionId!);
          this.sendResponse(socket, makeSuccessResponse(request.id, {
            stopped: true,
            reason: 'Stopped by participant',
          }));
          break;
        }

        case 'transcript': {
          requireNonEmptyString(p.room, 'room');
          const entries = this.roomManager.getTranscript(p.room);
          const summary = this.roomManager.getSummary(p.room);
          this.sendResponse(socket, makeSuccessResponse(request.id, { entries, summary }));
          break;
        }

        default:
          this.sendResponse(socket, makeErrorResponse(
            request.id,
            BrokerError.INVALID_STATE,
            `Unknown method: ${request.method}`
          ));
          break;
      }
    } catch (err: any) {
      const brokerErr = Object.values(BrokerError).find((v) => v === err.message);
      if (brokerErr) {
        this.sendResponse(socket, makeErrorResponse(request.id, brokerErr, err.message));
      } else {
        this.sendResponse(socket, makeErrorResponse(
          request.id,
          BrokerError.INVALID_STATE,
          err.message || 'Internal error'
        ));
      }
    }
  }

  private getSessionId(socket: net.Socket): string | undefined {
    return this.clients.get(socket)?.sessionId;
  }

  private sendResponse(socket: net.Socket, response: JsonRpcResponse): void {
    if (!socket.destroyed) {
      socket.write(serializeResponse(response));
    }
  }
}

/**
 * Starts a broker and wires it to the process lifecycle.
 *
 * Signal handling lives here rather than in BrokerServer so that embedding the
 * server (in tests, or alongside other code) does not register process-wide
 * listeners, and so shutdown actually terminates the process.
 */
export async function startBroker(): Promise<BrokerServer> {
  const server = new BrokerServer();
  await server.start();

  let shuttingDown = false;
  const shutdown = async (signal: NodeJS.Signals) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\nReceived ${signal}, shutting down broker...`);
    try {
      await server.stop();
    } catch (err: any) {
      console.error(`Error during shutdown: ${err?.message ?? err}`);
    }
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  return server;
}

/**
 * Validates that a required string param is present and non-empty.
 * @throws Error describing the offending param.
 */
function requireNonEmptyString(value: unknown, name: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`Invalid param '${name}': expected a non-empty string`);
  }
}
