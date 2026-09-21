import net from 'net';
import fs from 'fs';
import path from 'path';
import { SOCKET_PATH, CONFIG_DIR } from '../config/constants.js';
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

    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /** Stops the server and cleans up. */
  async stop(): Promise<void> {
    for (const socket of this.clients.keys()) {
      socket.destroy();
    }
    this.clients.clear();

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
      const sessionId = this.getSessionId(socket);
      const p = request.params as Record<string, any>;

      switch (request.method) {
        case 'join': {
          const result = this.roomManager.joinRoom(
            p.room,
            p.sessionId ?? p.name, // sessionId from adapter
            p.name,
            p.harness ?? 'claude',
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
          this.roomManager.startExchange(p.room, sessionId!, p.task);
          this.sendResponse(socket, makeSuccessResponse(request.id, {
            room: p.room,
            started: true,
            stage: 'PROPOSAL',
          }));
          break;
        }

        case 'send': {
          const msg = this.roomManager.sendMessage(p.room, sessionId!, p.content);
          this.sendResponse(socket, makeSuccessResponse(request.id, {
            seq: msg.seq,
            stage: msg.stage,
            remainingMessages: 6 - (this.journal.getMessageCount(p.room)),
          }));
          break;
        }

        case 'receive': {
          const timeoutMs = Math.min(p.timeoutMs ?? 30000, 30000);
          const afterSeq = p.afterSeq ?? 0;
          const start = Date.now();

          const poll = () => {
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
            setTimeout(poll, 200);
          };
          poll();
          break;
        }

        case 'ack': {
          this.roomManager.acknowledgeMessage(p.room, sessionId!, p.seq);
          this.sendResponse(socket, makeSuccessResponse(request.id, { acknowledged: true }));
          break;
        }

        case 'status': {
          const status = this.roomManager.getStatus(p.room);
          this.sendResponse(socket, makeSuccessResponse(request.id, status));
          break;
        }

        case 'stop': {
          this.roomManager.stopRoom(p.room, sessionId!);
          this.sendResponse(socket, makeSuccessResponse(request.id, {
            stopped: true,
            reason: 'Stopped by participant',
          }));
          break;
        }

        case 'transcript': {
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

/** Starts and returns a new BrokerServer instance. */
export async function startBroker(): Promise<BrokerServer> {
  const server = new BrokerServer();
  await server.start();
  return server;
}
