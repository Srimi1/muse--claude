import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import net from 'net';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { BrokerServer } from '../src/broker/server.js';
import { RoomState, ExchangeStage } from '../src/broker/types.js';

describe('End-to-End Two-Terminal /talk Simulation', () => {
  let tempDir: string;
  let socketPath: string;
  let dbPath: string;
  let server: BrokerServer;

  beforeAll(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-e2e-'));
    socketPath = path.join(tempDir, 'talk-e2e.sock');
    dbPath = path.join(tempDir, 'journal-e2e.db');

    server = new BrokerServer(socketPath, dbPath);
    await server.start();
  });

  afterAll(async () => {
    await server.stop();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  function createClient(): Promise<{
    socket: net.Socket;
    call: (method: string, params: Record<string, unknown>) => Promise<any>;
    close: () => void;
  }> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(socketPath, () => {
        let reqId = 0;
        let buffer = '';
        const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

        socket.on('data', (data) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() ?? '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const res = JSON.parse(line);
              const p = pending.get(res.id);
              if (p) {
                pending.delete(res.id);
                if (res.error) p.reject(new Error(res.error.message));
                else p.resolve(res.result);
              }
            } catch {
              // ignore parse errors
            }
          }
        });

        const call = (method: string, params: Record<string, unknown>): Promise<any> => {
          const id = ++reqId;
          const req = { jsonrpc: '2.0', id, method, params };
          return new Promise((res, rej) => {
            pending.set(id, { resolve: res, reject: rej });
            socket.write(JSON.stringify(req) + '\n');
          });
        };

        resolve({
          socket,
          call,
          close: () => socket.destroy(),
        });
      });

      socket.on('error', reject);
    });
  }

  it('runs a full 6-stage cross-terminal collaborative exchange', async () => {
    const client1 = await createClient(); // Claude Code terminal
    const client2 = await createClient(); // Muse Code terminal

    // 1. Client 1 joins room
    const join1 = await client1.call('join', {
      room: 'feature-auth',
      name: 'claude-agent',
      sessionId: 'session-claude',
      harness: 'claude',
    });
    expect(join1.waitingForPeer).toBe(true);

    // 2. Client 2 joins room
    const join2 = await client2.call('join', {
      room: 'feature-auth',
      name: 'muse-agent',
      sessionId: 'session-muse',
      harness: 'muse',
    });
    expect(join2.waitingForPeer).toBe(false);
    expect(join2.participantCount).toBe(2);

    // 3. Status check: room is ACTIVE
    const status1 = await client1.call('status', { room: 'feature-auth' });
    expect(status1.room.state).toBe(RoomState.ACTIVE);

    // 4. Client 1 starts exchange
    const start = await client1.call('start', {
      room: 'feature-auth',
      task: 'Standardize error codes across API endpoints',
    });
    expect(start.started).toBe(true);

    // 5. Stage 1: Proposal (Client 1)
    const send1 = await client1.call('send', {
      room: 'feature-auth',
      content: 'Proposal: Use RFC 7807 problem details format for all error responses.',
    });
    expect(send1.stage).toBe(ExchangeStage.PROPOSAL);

    // Client 2 receives Proposal
    const rec1 = await client2.call('receive', { room: 'feature-auth', timeoutMs: 1000 });
    expect(rec1.messages.length).toBe(1);
    expect(rec1.messages[0].stage).toBe(ExchangeStage.PROPOSAL);
    expect(rec1.messages[0].senderName).toBe('claude-agent');

    // Client 2 acks
    await client2.call('ack', { room: 'feature-auth', seq: rec1.messages[0].seq });

    // 6. Stage 2: Critique & Ownership (Client 2)
    const send2 = await client2.call('send', {
      room: 'feature-auth',
      content: 'Critique: Agreed. I will implement error classes in src/errors, you wire the middleware.',
    });
    expect(send2.stage).toBe(ExchangeStage.CRITIQUE_OWNERSHIP);

    // 7. Stage 3: Implementation A (Client 1)
    const send3 = await client1.call('send', {
      room: 'feature-auth',
      content: 'Implementation: Created express error-handling middleware in src/middleware/error.ts',
    });
    expect(send3.stage).toBe(ExchangeStage.IMPLEMENTATION_A);

    // 8. Stage 4: Implementation B (Client 2)
    const send4 = await client2.call('send', {
      room: 'feature-auth',
      content: 'Implementation: Added HttpError, ValidationError classes and unit tests in test/errors.test.ts',
    });
    expect(send4.stage).toBe(ExchangeStage.IMPLEMENTATION_B);

    // 9. Stage 5: Review (Client 1)
    const send5 = await client1.call('send', {
      room: 'feature-auth',
      content: 'Review: Middleware integration tests passing. Status codes mapped cleanly.',
    });
    expect(send5.stage).toBe(ExchangeStage.REVIEW);

    // 10. Stage 6: Synthesis (Client 2)
    const send6 = await client2.call('send', {
      room: 'feature-auth',
      content:
        'AGREE: RFC 7807 format implemented\nDISAGREE: None\nFILE: src/middleware/error.ts\nFILE: src/errors/index.ts\nTEST: 12/12 unit tests passed',
    });
    expect(send6.stage).toBe(ExchangeStage.SYNTHESIS);

    // 11. Verify room is DONE
    const finalStatus = await client1.call('status', { room: 'feature-auth' });
    expect(finalStatus.room.state).toBe(RoomState.DONE);
    expect(finalStatus.room.messageCount).toBe(6);

    // 12. Verify Transcript and Summary
    const transcriptRes = await client1.call('transcript', { room: 'feature-auth' });
    expect(transcriptRes.entries.length).toBe(6);
    expect(transcriptRes.entries[0].harness).toBe('claude');
    expect(transcriptRes.entries[1].harness).toBe('muse');

    expect(transcriptRes.summary).toBeDefined();
    expect(transcriptRes.summary.agreements).toContain('RFC 7807 format implemented');
    expect(transcriptRes.summary.changedFiles).toContain('src/middleware/error.ts');
    expect(transcriptRes.summary.testResults).toContain('12/12 unit tests passed');

    client1.close();
    client2.close();
  });
});
