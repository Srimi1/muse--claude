import { describe, it, expect } from 'vitest';
import {
  parseNdjson,
  serializeResponse,
  makeSuccessResponse,
  makeErrorResponse,
  ERROR_CODES,
  type JsonRpcRequest,
} from '../src/broker/protocol.js';
import { BrokerError } from '../src/broker/types.js';

describe('Broker Protocol & Wire Parsing', () => {
  it('parses valid single and multi-line NDJSON requests', () => {
    const input = '{"jsonrpc":"2.0","id":1,"method":"join","params":{"room":"r1"}}\n{"jsonrpc":"2.0","id":2,"method":"status","params":{}}\n';
    const { requests, remainder } = parseNdjson(input);

    expect(requests.length).toBe(2);
    expect(requests[0]).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'join',
      params: { room: 'r1' },
    });
    expect(requests[1].method).toBe('status');
    expect(remainder).toBe('');
  });

  it('preserves incomplete buffer fragments in remainder', () => {
    const input = '{"jsonrpc":"2.0","id":1,"method":"join","params":{"room":"r1"}}\n{"jsonrpc":"2.0","id":2,"meth';
    const { requests, remainder } = parseNdjson(input);

    expect(requests.length).toBe(1);
    expect(remainder).toBe('{"jsonrpc":"2.0","id":2,"meth');
  });

  it('serializes responses with a trailing newline', () => {
    const resp = makeSuccessResponse(1, { ok: true });
    const serialized = serializeResponse(resp);
    expect(serialized.endsWith('\n')).toBe(true);
    expect(JSON.parse(serialized.trim())).toEqual(resp);
  });

  it('formats custom BrokerError codes properly', () => {
    const resp = makeErrorResponse(42, BrokerError.ROOM_FULL, 'Room is already full');
    expect(resp.error).toBeDefined();
    expect(resp.error?.code).toBe(ERROR_CODES.ROOM_FULL);
    expect(resp.error?.message).toBe('Room is already full');
    expect(resp.error?.data?.brokerError).toBe(BrokerError.ROOM_FULL);
  });

  it('correctly handles all BrokerError mappings', () => {
    expect(ERROR_CODES[BrokerError.ROOM_NOT_FOUND]).toBe(-32001);
    expect(ERROR_CODES[BrokerError.ROOM_FULL]).toBe(-32002);
    expect(ERROR_CODES[BrokerError.ROOM_DEADLINE_EXCEEDED]).toBe(-32003);
    expect(ERROR_CODES[BrokerError.MESSAGE_TOO_LARGE]).toBe(-32006);
    expect(ERROR_CODES[BrokerError.EXCHANGE_LIMIT_REACHED]).toBe(-32007);
  });
});
