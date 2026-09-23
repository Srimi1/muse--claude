import { describe, it, expect } from 'vitest';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { brokerRequest, resolveTalkHarness } from '../src/cli/request.js';

describe('CLI brokerRequest', () => {
  function startStubServer(
    onRequest: (req: any, socket: net.Socket) => void
  ): Promise<{ socketPath: string; close: () => Promise<void> }> {
    return new Promise((resolve) => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-cli-req-'));
      const socketPath = path.join(dir, 'stub.sock');
      const server = net.createServer((socket) => {
        let buffer = '';
        socket.on('data', (data) => {
          buffer += data.toString();
          const idx = buffer.indexOf('\n');
          if (idx !== -1) {
            const req = JSON.parse(buffer.slice(0, idx));
            onRequest(req, socket);
          }
        });
      });
      server.listen(socketPath, () => {
        resolve({
          socketPath,
          close: () =>
            new Promise<void>((r) => {
              server.close(() => {
                fs.rmSync(dir, { recursive: true, force: true });
                r();
              });
            }),
        });
      });
    });
  }

  it('sends a JSON-RPC request and resolves with the result', async () => {
    const stub = await startStubServer((req, socket) => {
      expect(req.method).toBe('status');
      expect(req.params.room).toBe('r1');
      socket.write(JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }) + '\n');
    });
    try {
      const result = await brokerRequest('status', { room: 'r1' }, stub.socketPath);
      expect(result).toEqual({ ok: true });
    } finally {
      await stub.close();
    }
  });

  it('reassembles a response split across TCP chunks', async () => {
    const stub = await startStubServer((req, socket) => {
      const payload = JSON.stringify({ jsonrpc: '2.0', id: req.id, result: { ok: true } }) + '\n';
      socket.write(payload.slice(0, 10));
      setTimeout(() => socket.write(payload.slice(10)), 20);
    });
    try {
      const result = await brokerRequest('status', { room: 'r1' }, stub.socketPath);
      expect(result).toEqual({ ok: true });
    } finally {
      await stub.close();
    }
  });

  it('rejects with the broker error message', async () => {
    const stub = await startStubServer((req, socket) => {
      socket.write(
        JSON.stringify({ jsonrpc: '2.0', id: req.id, error: { code: -32001, message: 'Room gone' } }) + '\n'
      );
    });
    try {
      await expect(brokerRequest('status', { room: 'r1' }, stub.socketPath)).rejects.toThrow('Room gone');
    } finally {
      await stub.close();
    }
  });

  it('rejects when the broker closes without responding', async () => {
    const stub = await startStubServer((_req, socket) => {
      socket.destroy();
    });
    try {
      await expect(brokerRequest('status', { room: 'r1' }, stub.socketPath)).rejects.toThrow(
        'before responding'
      );
    } finally {
      await stub.close();
    }
  });

  it('times out when the broker accepts but never answers', async () => {
    const stub = await startStubServer(() => {
      // Read the request, never reply.
    });
    try {
      await expect(brokerRequest('status', { room: 'r1' }, stub.socketPath, 50)).rejects.toThrow('Timed out');
    } finally {
      await stub.close();
    }
  });

  it('rejects with a helpful message when the broker is not running', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-cli-dead-'));
    const socketPath = path.join(dir, 'nope.sock');
    try {
      await expect(brokerRequest('status', { room: 'r1' }, socketPath)).rejects.toThrow(
        'Cannot connect to broker'
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('resolveTalkHarness', () => {
  it('defaults to claude', () => {
    expect(resolveTalkHarness(undefined, {})).toBe('claude');
  });

  it('honors TALK_HARNESS', () => {
    expect(resolveTalkHarness(undefined, { TALK_HARNESS: 'muse' })).toBe('muse');
  });

  it('prefers the explicit CLI option over the environment', () => {
    expect(resolveTalkHarness('claude', { TALK_HARNESS: 'muse' })).toBe('claude');
    expect(resolveTalkHarness('muse', {})).toBe('muse');
  });

  it('rejects invalid values', () => {
    expect(() => resolveTalkHarness('gpt', {})).toThrow("Invalid harness 'gpt'");
    expect(() => resolveTalkHarness(undefined, { TALK_HARNESS: 'bogus' })).toThrow(
      "Invalid harness 'bogus'"
    );
  });
});
