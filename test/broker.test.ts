import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Journal } from '../src/broker/journal.js';
import { RoomManager } from '../src/broker/room.js';
import { RoomState, ExchangeStage, BrokerError } from '../src/broker/types.js';
import fs from 'fs';
import path from 'path';
import os from 'os';

describe('Broker RoomManager & SQLite Journal', () => {
  let tempDir: string;
  let journal: Journal;
  let roomManager: RoomManager;

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'talk-test-'));
    journal = new Journal(path.join(tempDir, 'test-journal.db'));
    await journal.init();
    roomManager = new RoomManager(journal);
  });

  afterEach(() => {
    journal.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  it('manages room creation and participant joins with waiting state', () => {
    const { room, waitingForPeer } = roomManager.joinRoom('test-room', 'session-1', 'Alice', 'claude');
    expect(waitingForPeer).toBe(true);
    expect(room.state).toBe(RoomState.WAITING);
    expect(room.participants.length).toBe(1);

    // Second participant joins -> becomes ACTIVE
    const { room: activeRoom, waitingForPeer: stillWaiting } = roomManager.joinRoom(
      'test-room',
      'session-2',
      'Bob',
      'muse'
    );
    expect(stillWaiting).toBe(false);
    expect(activeRoom.state).toBe(RoomState.ACTIVE);
    expect(activeRoom.participants.length).toBe(2);
  });

  it('rejects a 3rd participant with ROOM_FULL', () => {
    roomManager.joinRoom('full-room', 's1', 'Alice', 'claude');
    roomManager.joinRoom('full-room', 's2', 'Bob', 'muse');

    expect(() => {
      roomManager.joinRoom('full-room', 's3', 'Eve', 'claude');
    }).toThrow(BrokerError.ROOM_FULL);
  });

  it('rejects starting exchange before room is ACTIVE', () => {
    roomManager.joinRoom('early-room', 's1', 'Alice', 'claude');
    expect(() => {
      roomManager.startExchange('early-room', 's1', 'Build feature');
    }).toThrow(BrokerError.INVALID_STATE);
  });

  it('starts exchange and enforces 6-stage progression', () => {
    roomManager.joinRoom('prog-room', 's1', 'Alice', 'claude');
    roomManager.joinRoom('prog-room', 's2', 'Bob', 'muse');

    roomManager.startExchange('prog-room', 's1', 'Refactor auth');
    const status1 = roomManager.getStatus('prog-room');
    expect(status1.room.state).toBe(RoomState.EXCHANGING);
    expect(status1.room.currentStage).toBe(ExchangeStage.PROPOSAL);

    // Message 1: Proposal
    const m1 = roomManager.sendMessage('prog-room', 's1', 'I propose JWT auth');
    expect(m1.stage).toBe(ExchangeStage.PROPOSAL);

    // Message 2: Critique
    const m2 = roomManager.sendMessage('prog-room', 's2', 'Agreed, I will take tests');
    expect(m2.stage).toBe(ExchangeStage.CRITIQUE_OWNERSHIP);

    // Message 3: Implementation A
    const m3 = roomManager.sendMessage('prog-room', 's1', 'Implemented JWT token parser');
    expect(m3.stage).toBe(ExchangeStage.IMPLEMENTATION_A);

    // Message 4: Implementation B
    const m4 = roomManager.sendMessage('prog-room', 's2', 'Added unit tests for JWT validation');
    expect(m4.stage).toBe(ExchangeStage.IMPLEMENTATION_B);

    // Message 5: Review
    const m5 = roomManager.sendMessage('prog-room', 's1', 'Reviewed tests, look solid');
    expect(m5.stage).toBe(ExchangeStage.REVIEW);
    expect(roomManager.getStatus('prog-room').room.state).toBe(RoomState.REVIEWING);

    // Message 6: Synthesis
    const m6 = roomManager.sendMessage(
      'prog-room',
      's2',
      'AGREE: JWT format standardized\nFILE: src/auth/jwt.ts\nTEST: 5/5 passing'
    );
    expect(m6.stage).toBe(ExchangeStage.SYNTHESIS);
    expect(roomManager.getStatus('prog-room').room.state).toBe(RoomState.DONE);

    // Message 7: Exceeds limit
    expect(() => {
      roomManager.sendMessage('prog-room', 's1', 'Extra message');
    }).toThrow(BrokerError.EXCHANGE_LIMIT_REACHED);
  });

  it('rejects messages larger than 8 KiB with MESSAGE_TOO_LARGE', () => {
    roomManager.joinRoom('size-room', 's1', 'Alice', 'claude');
    roomManager.joinRoom('size-room', 's2', 'Bob', 'muse');
    roomManager.startExchange('size-room', 's1', 'Task');

    const oversized = 'x'.repeat(8193);
    expect(() => {
      roomManager.sendMessage('size-room', 's1', oversized);
    }).toThrow(BrokerError.MESSAGE_TOO_LARGE);
  });

  it('allows stopping an exchange cooperatively', () => {
    roomManager.joinRoom('stop-room', 's1', 'Alice', 'claude');
    roomManager.stopRoom('stop-room', 's1');

    const status = roomManager.getStatus('stop-room');
    expect(status.room.state).toBe(RoomState.CANCELLED);
  });

  it('extracts structured synthesis summary and transcript from finished room', () => {
    roomManager.joinRoom('sum-room', 's1', 'Alice', 'claude');
    roomManager.joinRoom('sum-room', 's2', 'Bob', 'muse');
    roomManager.startExchange('sum-room', 's1', 'Task XYZ');

    roomManager.sendMessage('sum-room', 's1', 'M1');
    roomManager.sendMessage('sum-room', 's2', 'M2');
    roomManager.sendMessage('sum-room', 's1', 'M3');
    roomManager.sendMessage('sum-room', 's2', 'M4');
    roomManager.sendMessage('sum-room', 's1', 'M5');
    roomManager.sendMessage(
      'sum-room',
      's2',
      'AGREE: Approach validated\nDISAGREE: Redis caching deferred\nFILE: src/auth.ts\nTEST: All passed'
    );

    const summary = roomManager.getSummary('sum-room');
    expect(summary).not.toBeNull();
    expect(summary?.agreements).toContain('Approach validated');
    expect(summary?.disagreements).toContain('Redis caching deferred');
    expect(summary?.changedFiles).toContain('src/auth.ts');
    expect(summary?.testResults).toContain('All passed');

    const transcript = roomManager.getTranscript('sum-room');
    expect(transcript.length).toBe(6);
    expect(transcript[0].senderName).toBe('Alice');
    expect(transcript[1].senderName).toBe('Bob');
  });
});
