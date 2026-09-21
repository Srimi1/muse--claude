/**
 * JSON-RPC 2.0 wire protocol for the /talk broker.
 * Defines request/response types for all broker methods.
 * @module broker/protocol
 */

import type {
  ExchangeMessage,
  RoomStatus,
  TranscriptEntry,
  ExchangeSummary,
  BrokerError,
} from './types.js';

// ── JSON-RPC Base Types ──

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: number | string;
  method: string;
  params: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: number | string;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: { brokerError: BrokerError };
}

// ── Method: join ──

export interface JoinParams {
  room: string;
  name: string;
  sessionId: string;
  harness: 'claude' | 'muse';
  repoRoot?: string;
}

export interface JoinResult {
  room: string;
  participantCount: number;
  waitingForPeer: boolean;
}

// ── Method: start ──

export interface StartParams {
  room: string;
  sessionId: string;
  task: string;
}

export interface StartResult {
  room: string;
  started: boolean;
  stage: string;
}

// ── Method: send ──

export interface SendParams {
  room: string;
  sessionId: string;
  content: string;
}

export interface SendResult {
  seq: number;
  stage: string;
  remainingMessages: number;
}

// ── Method: receive ──

export interface ReceiveParams {
  room: string;
  sessionId: string;
  /** Last seq the client has seen; broker sends only newer messages */
  afterSeq?: number;
  /** Long-poll timeout in ms (default 30000, max 30000) */
  timeoutMs?: number;
}

export interface ReceiveResult {
  messages: ExchangeMessage[];
  /** Highest seq returned */
  lastSeq: number;
}

// ── Method: ack ──

export interface AckParams {
  room: string;
  sessionId: string;
  seq: number;
}

export interface AckResult {
  acknowledged: boolean;
}

// ── Method: status ──

export interface StatusParams {
  room: string;
}

export type StatusResult = RoomStatus;

// ── Method: stop ──

export interface StopParams {
  room: string;
  sessionId: string;
}

export interface StopResult {
  stopped: boolean;
  reason: string;
}

// ── Method: transcript ──

export interface TranscriptParams {
  room: string;
}

export interface TranscriptResult {
  entries: TranscriptEntry[];
  summary: ExchangeSummary | null;
}

// ── Error Code Mapping ──

/**
 * Maps BrokerError codes to JSON-RPC error codes.
 * Standard JSON-RPC codes: -32600 to -32603.
 * Custom codes: -32000 to -32099.
 */
export const ERROR_CODES: Record<string, number> = {
  ROOM_NOT_FOUND: -32001,
  ROOM_FULL: -32002,
  ROOM_DEADLINE_EXCEEDED: -32003,
  NOT_PARTICIPANT: -32004,
  STALE_TARGET: -32005,
  MESSAGE_TOO_LARGE: -32006,
  EXCHANGE_LIMIT_REACHED: -32007,
  INVALID_STATE: -32008,
  DUPLICATE_MESSAGE: -32009,
  PEER_DISCONNECTED: -32010,
  AUTH_FAILURE: -32011,
};

/**
 * Creates a JSON-RPC error response.
 */
export function makeErrorResponse(
  id: number | string,
  brokerError: BrokerError,
  message: string
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: ERROR_CODES[brokerError] ?? -32000,
      message,
      data: { brokerError },
    },
  };
}

/**
 * Creates a JSON-RPC success response.
 */
export function makeSuccessResponse(
  id: number | string,
  result: unknown
): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    result,
  };
}

/**
 * Parses a newline-delimited JSON buffer into JSON-RPC requests.
 * Returns parsed requests and any remaining partial data.
 */
export function parseNdjson(buffer: string): {
  requests: JsonRpcRequest[];
  remainder: string;
} {
  const lines = buffer.split('\n');
  const remainder = lines.pop() ?? ''; // last element may be incomplete
  const requests: JsonRpcRequest[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed.jsonrpc === '2.0' && parsed.method) {
        requests.push(parsed as JsonRpcRequest);
      }
    } catch {
      // Skip malformed lines
    }
  }

  return { requests, remainder };
}

/**
 * Serializes a JSON-RPC response to newline-delimited JSON.
 */
export function serializeResponse(response: JsonRpcResponse): string {
  return JSON.stringify(response) + '\n';
}
