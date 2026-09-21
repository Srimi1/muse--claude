import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import net from 'net';
import path from 'path';
import os from 'os';
import initSqlJs from 'sql.js';
import { Journal } from '../src/broker/journal.js';
import { RoomManager } from '../src/broker/room.js';
import { BrokerServer } from '../src/broker/server.js';
import { RoomState, ExchangeStage } from '../src/broker/types.js';
import { shouldDefaultToLaunch } from '../src/cli-args.js';

/** Reads room rows straight off disk, bypassing the in-memory view. */
async function readRoomRow(dbPath: string, roomId: string) {
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  const res = db.exec('SELECT state, current_stage FROM rooms WHERE id = ?', [roomId]);
  db.close();
  const row = res[0]?.values?.[0];
  return row ? { state: row[0], stage: row[1] } : null;
}

/** Minimal NDJSON JSON-RPC client over the broker's unix socket. */
function connect(sockPath: string): Promise<{
  call: (method: string, params: Record<string, unknown>) => Promise<any>;
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(sockPath, () => {
      let id = 0;
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
              res.error ? p.reject(new Error(res.error.message)) : p.resolve(res.result);
            }
          } catch {
            // ignore malformed lines
          }
        }
      });

      resolve({
        call: (method, params) => {
          const reqId = ++id;
          return new Promise((res, rej) => {
            pending.set(reqId, { resolve: res, reject: rej });
            socket.write(JSON.stringify({ jsonrpc: '2.0', id: reqId, method, params }) + '\n');
          });
        },
        close: () => socket.destroy(),
      });
    });
    socket.on('error', reject);
  });
}

describe('Journal persistence of room state', () => {
  let tempDir: string;
  let dbPath: string;
  let journal: Journal;
  let rooms: RoomManager;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'regress-'));
    dbPath = path.join(tempDir, 'journal.db');
    journal = new Journal(dbPath);
    await journal.init();
    rooms = new RoomManager(journal);
  });

  afterEach(() => {
    rooms.shutdown();
    journal.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('writes every stage transition through to the journal', async () => {
    rooms.joinRoom('r', 's1', 'Alice', 'claude');
    rooms.joinRoom('r', 's2', 'Bob', 'muse');
    rooms.startExchange('r', 's1', 'Task');

    const expected = [
      ExchangeStage.PROPOSAL,
      ExchangeStage.CRITIQUE_OWNERSHIP,
      ExchangeStage.IMPLEMENTATION_A,
      ExchangeStage.IMPLEMENTATION_B,
      ExchangeStage.REVIEW,
      ExchangeStage.SYNTHESIS,
    ];

    for (let i = 0; i < expected.length; i++) {
      rooms.sendMessage('r', i % 2 === 0 ? 's1' : 's2', `m${i}`);
      const persisted = await readRoomRow(dbPath, 'r');
      expect(persisted?.stage).toBe(expected[i]);
    }

    const final = await readRoomRow(dbPath, 'r');
    expect(final?.state).toBe(RoomState.DONE);
    expect(final?.stage).toBe(ExchangeStage.SYNTHESIS);
  });

  it('persists a cooperative stop', async () => {
    rooms.joinRoom('r', 's1', 'Alice', 'claude');
    rooms.stopRoom('r', 's1');

    expect(rooms.getStatus('r').room.state).toBe(RoomState.CANCELLED);
    expect((await readRoomRow(dbPath, 'r'))?.state).toBe(RoomState.CANCELLED);
  });

  it('scopes the connected flag to a single room', () => {
    rooms.joinRoom('room-a', 'shared', 'Alice', 'claude');
    rooms.joinRoom('room-b', 'shared', 'Alice', 'claude');

    journal.setParticipantConnected('room-a', 'shared', false);

    expect(journal.getParticipants('room-a')[0].connected).toBe(false);
    expect(journal.getParticipants('room-b')[0].connected).toBe(true);
  });

  it('reports the acknowledged flag on read-back', () => {
    rooms.joinRoom('r', 's1', 'Alice', 'claude');
    rooms.joinRoom('r', 's2', 'Bob', 'muse');
    rooms.startExchange('r', 's1', 'Task');
    const msg = rooms.sendMessage('r', 's1', 'hello');

    expect(journal.getMessages('r')[0].acknowledged).toBe(false);
    rooms.acknowledgeMessage('r', 's2', msg.seq);
    expect(journal.getMessages('r')[0].acknowledged).toBe(true);
  });

  it('leaves no participant row behind when a join is rejected', () => {
    rooms.joinRoom('r', 's1', 'Alice', 'claude', '/repo/one');
    expect(() => rooms.joinRoom('r', 's2', 'Bob', 'muse', '/repo/two')).toThrow(/Repository mismatch/);

    expect(journal.getParticipants('r')).toHaveLength(1);
    expect(rooms.getStatus('r').room.participants).toHaveLength(1);
  });
});

describe('Broker restart', () => {
  let tempDir: string;
  let dbPath: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'restart-'));
    dbPath = path.join(tempDir, 'journal.db');
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('rehydrates rooms, participants and stage from the journal', async () => {
    const j1 = new Journal(dbPath);
    await j1.init();
    const r1 = new RoomManager(j1);
    r1.joinRoom('carryover', 's1', 'Alice', 'claude');
    r1.joinRoom('carryover', 's2', 'Bob', 'muse');
    r1.startExchange('carryover', 's1', 'Ship the thing');
    r1.sendMessage('carryover', 's1', 'proposal');
    r1.sendMessage('carryover', 's2', 'critique');
    r1.shutdown();
    j1.close();

    // Restart: fresh journal and manager over the same database file.
    const j2 = new Journal(dbPath);
    await j2.init();
    const r2 = new RoomManager(j2);
    r2.restore();

    const status = r2.getStatus('carryover');
    expect(status.room.state).toBe(RoomState.EXCHANGING);
    expect(status.room.currentStage).toBe(ExchangeStage.CRITIQUE_OWNERSHIP);
    expect(status.room.task).toBe('Ship the thing');
    expect(status.room.messageCount).toBe(2);
    expect(status.room.participants.map((p) => p.name).sort()).toEqual(['Alice', 'Bob']);

    // Nobody holds a socket across a restart.
    expect(status.room.participants.every((p) => !p.connected)).toBe(true);

    // The exchange is resumable rather than orphaned.
    const next = r2.sendMessage('carryover', 's1', 'implementation a');
    expect(next.stage).toBe(ExchangeStage.IMPLEMENTATION_A);
    expect(next.seq).toBe(3);

    r2.shutdown();
    j2.close();
  });

  it('does not reset an existing room when a peer rejoins after a restart', async () => {
    const j1 = new Journal(dbPath);
    await j1.init();
    const r1 = new RoomManager(j1);
    r1.joinRoom('keep', 's1', 'Alice', 'claude');
    r1.joinRoom('keep', 's2', 'Bob', 'muse');
    r1.startExchange('keep', 's1', 'Original task');
    r1.shutdown();
    j1.close();

    const j2 = new Journal(dbPath);
    await j2.init();
    const r2 = new RoomManager(j2);
    r2.restore();
    r2.joinRoom('keep', 's1', 'Alice', 'claude'); // reconnect

    expect(r2.getStatus('keep').room.task).toBe('Original task');
    expect(r2.getStatus('keep').room.state).toBe(RoomState.EXCHANGING);
    expect(r2.getStatus('keep').room.participants.find((p) => p.sessionId === 's1')?.connected).toBe(true);

    r2.shutdown();
    j2.close();
  });

  it('cancels a room whose deadline lapsed while the broker was down', async () => {
    const j1 = new Journal(dbPath);
    await j1.init();
    const r1 = new RoomManager(j1);
    r1.joinRoom('stale', 's1', 'Alice', 'claude');
    r1.joinRoom('stale', 's2', 'Bob', 'muse');
    r1.shutdown();
    // Backdate the deadline to simulate downtime past the 30-minute window.
    (j1 as any).db.run('UPDATE rooms SET deadline_at = ? WHERE id = ?', [Date.now() - 1000, 'stale']);
    (j1 as any).save();
    j1.close();

    const j2 = new Journal(dbPath);
    await j2.init();
    const r2 = new RoomManager(j2);
    r2.restore();

    expect(r2.getStatus('stale').room.state).toBe(RoomState.CANCELLED);
    r2.shutdown();
    j2.close();
  });
});

describe('Broker shutdown', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'shutdown-'));
  });

  afterEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('releases the deadline timers that keep the event loop alive', async () => {
    const journal = new Journal(path.join(tempDir, 'j.db'));
    await journal.init();
    const rooms = new RoomManager(journal);

    rooms.joinRoom('a', 's1', 'A', 'claude');
    rooms.joinRoom('a', 's2', 'B', 'muse');
    rooms.joinRoom('b', 's3', 'C', 'claude');
    rooms.joinRoom('b', 's4', 'D', 'muse');

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    rooms.shutdown();

    // One armed timer per ACTIVE room.
    expect(clearSpy).toHaveBeenCalledTimes(2);

    // Idempotent: nothing left to clear on a second call.
    clearSpy.mockClear();
    rooms.shutdown();
    expect(clearSpy).not.toHaveBeenCalled();

    journal.close();
  });

  it('stops a live broker that has an ACTIVE room, and tolerates a second stop', async () => {
    const sock = path.join(tempDir, 'b.sock');
    const server = new BrokerServer(sock, path.join(tempDir, 'b.db'));
    await server.start();

    // Two participants push the room to ACTIVE, which arms its 30-minute
    // deadline timer. That timer used to survive stop() and pin the loop.
    const a = await connect(sock);
    const b = await connect(sock);
    await a.call('join', { room: 'live', name: 'A', sessionId: 'sa', harness: 'claude' });
    await b.call('join', { room: 'live', name: 'B', sessionId: 'sb', harness: 'muse' });

    const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
    await server.stop();
    await expect(server.stop()).resolves.toBeUndefined();

    expect(clearSpy).toHaveBeenCalled();
    expect(fs.existsSync(sock)).toBe(false);

    a.close();
    b.close();
  });

  it('does not register process signal listeners when embedded', async () => {
    const before = process.listenerCount('SIGTERM');
    const server = new BrokerServer(
      path.join(tempDir, 'c.sock'),
      path.join(tempDir, 'c.db')
    );
    await server.start();
    expect(process.listenerCount('SIGTERM')).toBe(before);
    await server.stop();
  });
});

describe('CLI argument normalisation', () => {
  it('defaults to launch for a bare invocation and for launch flags', () => {
    expect(shouldDefaultToLaunch([])).toBe(true);
    expect(shouldDefaultToLaunch(['--model', 'muse-spark-1.3'])).toBe(true);
  });

  it('leaves program-level flags alone', () => {
    for (const flag of ['--help', '-h', '--version', '-V']) {
      expect(shouldDefaultToLaunch([flag])).toBe(false);
    }
  });

  it('leaves real subcommands alone', () => {
    for (const cmd of ['setup', 'models', 'doctor', 'launch', 'talk', 'help']) {
      expect(shouldDefaultToLaunch([cmd])).toBe(false);
    }
  });

  it('does not swallow an unknown command into launch', () => {
    expect(shouldDefaultToLaunch(['bogus'])).toBe(false);
    expect(shouldDefaultToLaunch(['talk', 'broker'])).toBe(false);
  });
});
