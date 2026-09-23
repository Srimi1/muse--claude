#!/usr/bin/env node
/**
 * Stdio-based MCP server adapter for the /talk protocol.
 * One instance runs per session, connecting to the broker via Unix socket.
 *
 * Environment:
 *   TALK_HARNESS - 'claude' or 'muse' (default: 'claude')
 *   TALK_SESSION_ID - Optional session ID override
 *
 * @module mcp/talk-adapter
 */
import net from 'net';
import { randomUUID } from 'crypto';
import { SOCKET_PATH } from '../config/constants.js';
import { TALK_TOOLS } from './tools.js';
const HARNESS = (process.env.TALK_HARNESS ?? 'claude') as 'claude' | 'muse';
const SESSION_ID = process.env.TALK_SESSION_ID ?? randomUUID();
let requestId = 0;
let brokerSocket: net.Socket | null = null;
let brokerBuffer = '';
const pendingRequests = new Map<
  number,
  { resolve: (value: unknown) => void; reject: (reason: Error) => void }
>();
// ── Broker Connection ──
function connectToBroker(): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(SOCKET_PATH, () => {
      brokerSocket = socket;
      resolve(socket);
    });
    socket.on('data', (data) => {
      brokerBuffer += data.toString();
      const lines = brokerBuffer.split('\n');
      brokerBuffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim())
          continue;
        try {
          const response = JSON.parse(line);
          const pending = pendingRequests.get(response.id);
          if (pending) {
            pendingRequests.delete(response.id);
            if (response.error) {
              pending.reject(new Error(response.error.message));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch {
          // Skip malformed responses
        }
      }
    });
    socket.on('error', (err) => {
      reject(new Error(`Cannot connect to broker at ${SOCKET_PATH}: ${err.message}`));
    });
    socket.on('close', () => {
      brokerSocket = null;
      for (const pending of pendingRequests.values()) {
        pending.reject(new Error('Broker connection closed'));
      }
      pendingRequests.clear();
    });
  });
}
async function brokerCall(method: string, params: Record<string, unknown>): Promise<unknown> {
  if (!brokerSocket) {
    await connectToBroker();
  }
  const id = ++requestId;
  const request = {
    jsonrpc: '2.0',
    id,
    method,
    params: { ...params, sessionId: SESSION_ID, harness: HARNESS },
  };
  return new Promise((resolve, reject) => {
    pendingRequests.set(id, { resolve, reject });
    brokerSocket!.write(JSON.stringify(request) + '\n');
  });
}
// ── MCP Stdio Protocol ──
let stdinBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  stdinBuffer += chunk;
  const lines = stdinBuffer.split('\n');
  stdinBuffer = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim())
      continue;
    try {
      handleMcpRequest(JSON.parse(line));
    } catch {
      // Skip malformed input
    }
  }
});
function sendMcpResponse(id: number | string, result: unknown): void {
  const response = { jsonrpc: '2.0', id, result };
  process.stdout.write(JSON.stringify(response) + '\n');
}
function sendMcpError(id: number | string, code: number, message: string): void {
  const response = { jsonrpc: '2.0', id, error: { code, message } };
  process.stdout.write(JSON.stringify(response) + '\n');
}
async function handleMcpRequest(request: any): Promise<void> {
  const { id, method, params } = request;
  // Notifications carry no id and must never receive a response.
  if (id === undefined)
    return;
  try {
    switch (method) {
      case 'initialize': {
        sendMcpResponse(id, {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'talk-adapter', version: '0.1.0' },
        });
        break;
      }
      case 'notifications/initialized': {
        // No response needed for notifications
        break;
      }
      case 'tools/list': {
        sendMcpResponse(id, { tools: TALK_TOOLS });
        break;
      }
      case 'tools/call': {
        const { name, arguments: args } = params;
        const result = await handleToolCall(name, args ?? {});
        sendMcpResponse(id, { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] });
        break;
      }
      default:
        sendMcpError(id, -32601, `Method not found: ${method}`);
    }
  } catch (err: any) {
    sendMcpError(id, -32000, err.message ?? 'Internal error');
  }
}
async function handleToolCall(name: string, args: Record<string, any>): Promise<unknown> {
  switch (name) {
    case 'talk_join':
      return brokerCall('join', { room: args.room, name: args.name });
    case 'talk_send':
      return brokerCall('send', { room: args.room, content: args.content });
    case 'talk_receive': {
      const raw = args.afterSeq;
      const afterSeq = typeof raw === 'number' ? raw : raw ? parseInt(String(raw), 10) : undefined;
      return brokerCall('receive', { room: args.room, afterSeq });
    }
    case 'talk_status':
      return brokerCall('status', { room: args.room });
    case 'talk_stop':
      return brokerCall('stop', { room: args.room });
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
// Start
connectToBroker().catch((err) => {
  console.error(`Failed to connect to broker: ${err.message}`);
  console.error('Make sure the broker is running: claude-muse talk broker');
  process.exit(1);
});
