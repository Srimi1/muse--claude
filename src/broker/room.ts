import { RoomState, ExchangeStage, BrokerError, type Room, type Participant, type ExchangeMessage, type RoomStatus, type ExchangeSummary } from './types.js';
import { Journal } from './journal.js';
import { MAX_MESSAGE_SIZE, MAX_EXCHANGE_MESSAGES, ROOM_DEADLINE_MS } from '../config/constants.js';

/**
 * Manages room lifecycle, participants, and exchange stage transitions.
 */
export class RoomManager {
  private deadlineTimers: Map<string, NodeJS.Timeout> = new Map();
  private rooms: Map<string, Room> = new Map();

  constructor(private journal: Journal) {}

  /** Creates a new room in WAITING state. */
  createRoom(id: string): Room {
    const now = Date.now();
    const room: Room = {
      id,
      state: RoomState.WAITING,
      currentStage: null,
      participants: [],
      messageCount: 0,
      createdAt: now,
      deadlineAt: now + ROOM_DEADLINE_MS,
      task: null,
      repoRoot: null,
    };
    this.rooms.set(id, room);
    try {
      this.journal.createRoom(id, room.deadlineAt);
    } catch {
      // Room might already exist in journal across restarts
    }
    return room;
  }

  /** Joins a room. Creates it if it doesn't exist. */
  joinRoom(
    roomId: string,
    sessionId: string,
    name: string,
    harness: 'claude' | 'muse',
    repoRoot?: string
  ): { room: Room; waitingForPeer: boolean } {
    let room = this.rooms.get(roomId);
    if (!room) {
      room = this.createRoom(roomId);
    }

    const existing = room.participants.find((p) => p.sessionId === sessionId);
    if (existing) {
      // Reconnect
      existing.connected = true;
      this.journal.setParticipantConnected(roomId, sessionId, true);
      return { room, waitingForPeer: room.state === RoomState.WAITING };
    }

    if (room.participants.length >= 2) {
      throw new Error(BrokerError.ROOM_FULL);
    }

    // Verify repo identity before the participant is recorded, so a rejected
    // join leaves nothing behind in memory or in the journal.
    if (repoRoot && room.repoRoot && room.repoRoot !== repoRoot) {
      throw new Error('Repository mismatch between participants');
    }

    const participant: Participant = {
      sessionId,
      name,
      harness,
      joinedAt: Date.now(),
      connected: true,
    };
    room.participants.push(participant);
    this.journal.addParticipant(roomId, participant);

    if (repoRoot) {
      room.repoRoot = repoRoot;
      this.journal.setRoomRepoRoot(roomId, repoRoot);
    }

    if (room.participants.length === 2 && room.state === RoomState.WAITING) {
      room.state = RoomState.ACTIVE;
      this.journal.updateRoomState(roomId, RoomState.ACTIVE);
      this.startDeadlineTimer(roomId);
    }

    return { room, waitingForPeer: room.state === RoomState.WAITING };
  }

  /** Starts an exchange with a task description. */
  startExchange(roomId: string, sessionId: string, task: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(BrokerError.ROOM_NOT_FOUND);
    if (room.state !== RoomState.ACTIVE) throw new Error(BrokerError.INVALID_STATE);
    if (!this.isParticipant(roomId, sessionId)) throw new Error(BrokerError.NOT_PARTICIPANT);

    room.task = task;
    room.state = RoomState.EXCHANGING;
    room.currentStage = ExchangeStage.PROPOSAL;
    this.journal.setRoomTask(roomId, task);
    this.journal.updateRoomState(roomId, room.state, room.currentStage);
  }

  /** Sends a message in the exchange. Advances stage automatically. */
  sendMessage(roomId: string, sessionId: string, content: string): ExchangeMessage {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(BrokerError.ROOM_NOT_FOUND);
    if (!this.isParticipant(roomId, sessionId)) throw new Error(BrokerError.NOT_PARTICIPANT);
    if (Buffer.byteLength(content, 'utf8') > MAX_MESSAGE_SIZE) {
      throw new Error(BrokerError.MESSAGE_TOO_LARGE);
    }

    const currentCount = this.journal.getMessageCount(roomId);
    if (room.state === RoomState.DONE || currentCount >= MAX_EXCHANGE_MESSAGES) {
      throw new Error(BrokerError.EXCHANGE_LIMIT_REACHED);
    }
    if (room.state !== RoomState.EXCHANGING && room.state !== RoomState.REVIEWING) {
      throw new Error(BrokerError.INVALID_STATE);
    }

    // Advance stage before creating the message
    const nextCount = currentCount + 1;
    this.advanceStage(roomId, nextCount);

    const sender = room.participants.find((p) => p.sessionId === sessionId)!;
    const msg = this.journal.addMessage(roomId, {
      senderId: sessionId,
      senderName: sender.name,
      stage: room.currentStage!,
      content,
      timestamp: new Date().toISOString(),
      acknowledged: false,
    });

    room.messageCount = nextCount;
    return msg;
  }

  /** Gets messages for a participant, optionally after a given seq. */
  receiveMessages(roomId: string, sessionId: string, afterSeq?: number): ExchangeMessage[] {
    if (!this.isParticipant(roomId, sessionId)) throw new Error(BrokerError.NOT_PARTICIPANT);
    return this.journal.getMessages(roomId, afterSeq);
  }

  /** Acknowledges receipt of a message. */
  acknowledgeMessage(roomId: string, sessionId: string, seq: number): void {
    if (!this.isParticipant(roomId, sessionId)) throw new Error(BrokerError.NOT_PARTICIPANT);
    this.journal.acknowledgeMessage(roomId, seq);
  }

  /** Gets the current status of a room. */
  getStatus(roomId: string): RoomStatus {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(BrokerError.ROOM_NOT_FOUND);

    const unackedBySession: Record<string, number> = {};
    for (const p of room.participants) {
      unackedBySession[p.sessionId] = this.journal.getUnackedCount(roomId, p.sessionId);
    }

    return {
      room,
      pendingMessages: this.journal.getMessageCount(roomId),
      unackedBySession,
    };
  }

  /** Stops the exchange cooperatively. */
  stopRoom(roomId: string, sessionId: string): void {
    const room = this.rooms.get(roomId);
    if (!room) throw new Error(BrokerError.ROOM_NOT_FOUND);
    if (!this.isParticipant(roomId, sessionId)) throw new Error(BrokerError.NOT_PARTICIPANT);

    room.state = RoomState.CANCELLED;
    this.journal.updateRoomState(roomId, room.state, room.currentStage);
    this.cancelDeadlineTimer(roomId);
  }

  /** Marks a participant as disconnected, in memory and in the journal. */
  handleDisconnect(sessionId: string): void {
    for (const room of this.rooms.values()) {
      const p = room.participants.find((p) => p.sessionId === sessionId);
      if (p) {
        p.connected = false;
        this.journal.setParticipantConnected(room.id, sessionId, false);
      }
    }
  }

  /**
   * Rebuilds in-memory room state from the journal.
   * Called once when the broker starts so that rooms, participants and
   * messages written by a previous run remain addressable.
   */
  restore(): void {
    const now = Date.now();

    for (const room of this.journal.listRooms()) {
      // No client holds a socket across a restart.
      for (const p of room.participants) p.connected = false;
      this.journal.setAllParticipantsDisconnected(room.id);

      const finished = room.state === RoomState.DONE || room.state === RoomState.CANCELLED;
      if (!finished && room.deadlineAt <= now) {
        room.state = RoomState.CANCELLED;
        this.journal.updateRoomState(room.id, room.state, room.currentStage);
      }

      this.rooms.set(room.id, room);

      if (room.state === RoomState.ACTIVE ||
          room.state === RoomState.EXCHANGING ||
          room.state === RoomState.REVIEWING) {
        this.startDeadlineTimer(room.id);
      }
    }
  }

  /**
   * Releases every pending deadline timer.
   * Without this the 30-minute timers keep the Node event loop alive and the
   * broker process refuses to exit after its socket has been closed.
   */
  shutdown(): void {
    for (const timer of this.deadlineTimers.values()) {
      clearTimeout(timer);
    }
    this.deadlineTimers.clear();
  }

  /** Gets the transcript entries for a room. */
  getTranscript(roomId: string) {
    return this.journal.getTranscript(roomId);
  }

  /** Builds a summary for a completed exchange. */
  getSummary(roomId: string): ExchangeSummary | null {
    const room = this.rooms.get(roomId);
    if (!room || room.state !== RoomState.DONE) return null;

    const msgs = this.journal.getMessages(roomId);
    const summary: ExchangeSummary = {
      roomId,
      task: room.task ?? '',
      participants: room.participants.map((p) => ({ name: p.name, harness: p.harness })),
      agreements: [],
      disagreements: [],
      changedFiles: [],
      testResults: [],
      completedAt: new Date().toISOString(),
    };

    for (const msg of msgs) {
      if (msg.stage === ExchangeStage.SYNTHESIS) {
        // Parse synthesis message for structured data
        const lines = msg.content.split('\n');
        for (const line of lines) {
          if (line.startsWith('AGREE:')) summary.agreements.push(line.slice(6).trim());
          else if (line.startsWith('DISAGREE:')) summary.disagreements.push(line.slice(9).trim());
          else if (line.startsWith('FILE:')) summary.changedFiles.push(line.slice(5).trim());
          else if (line.startsWith('TEST:')) summary.testResults.push(line.slice(5).trim());
        }
      }
    }

    return summary;
  }

  private isParticipant(roomId: string, sessionId: string): boolean {
    const room = this.rooms.get(roomId);
    return room?.participants.some((p) => p.sessionId === sessionId) ?? false;
  }

  private startDeadlineTimer(roomId: string): void {
    this.cancelDeadlineTimer(roomId);
    const room = this.rooms.get(roomId);
    if (!room) return;

    const timeout = Math.max(0, room.deadlineAt - Date.now());
    const timer = setTimeout(() => {
      const r = this.rooms.get(roomId);
      if (r && r.state !== RoomState.DONE && r.state !== RoomState.CANCELLED) {
        r.state = RoomState.CANCELLED;
        this.journal.updateRoomState(roomId, r.state, r.currentStage);
      }
      this.deadlineTimers.delete(roomId);
    }, timeout);

    this.deadlineTimers.set(roomId, timer);
  }

  private cancelDeadlineTimer(roomId: string): void {
    const timer = this.deadlineTimers.get(roomId);
    if (timer) {
      clearTimeout(timer);
      this.deadlineTimers.delete(roomId);
    }
  }

  private advanceStage(roomId: string, messageCount: number): void {
    const room = this.rooms.get(roomId);
    if (!room) return;

    if (messageCount === 1) room.currentStage = ExchangeStage.PROPOSAL;
    else if (messageCount === 2) room.currentStage = ExchangeStage.CRITIQUE_OWNERSHIP;
    else if (messageCount === 3) room.currentStage = ExchangeStage.IMPLEMENTATION_A;
    else if (messageCount === 4) room.currentStage = ExchangeStage.IMPLEMENTATION_B;
    else if (messageCount === 5) {
      room.currentStage = ExchangeStage.REVIEW;
      room.state = RoomState.REVIEWING;
    } else if (messageCount === 6) {
      room.currentStage = ExchangeStage.SYNTHESIS;
      room.state = RoomState.DONE;
      this.cancelDeadlineTimer(roomId);
    }

    // Persist the transition; otherwise the journal keeps reporting the stage
    // that startExchange wrote and a restart resumes from the wrong point.
    this.journal.updateRoomState(roomId, room.state, room.currentStage);
  }
}
