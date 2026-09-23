import initSqlJs, { Database } from 'sql.js';
import fs from 'fs';
import path from 'path';
import { JOURNAL_PATH, CONFIG_DIR } from '../config/constants.js';
import { RoomState, ExchangeStage, type ExchangeMessage, type Room, type Participant, type TranscriptEntry } from './types.js';

/**
 * Journal class for the /talk broker, backed by sql.js SQLite database.
 */
export class Journal {
  private db: Database | null = null;
  private dbPath: string | null;

  constructor(dbPath?: string | null) {
    this.dbPath = dbPath === undefined ? JOURNAL_PATH : dbPath;
  }

  /**
   * Initializes the sql.js database, loading an existing file if present,
   * or creating a new one with the necessary schema.
   */
  async init(): Promise<void> {
    const SQL = await initSqlJs();
    if (this.dbPath && fs.existsSync(this.dbPath)) {
      const fileBuffer = fs.readFileSync(this.dbPath);
      this.db = new SQL.Database(fileBuffer);
    } else {
      this.db = new SQL.Database();
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        id TEXT PRIMARY KEY,
        state TEXT,
        current_stage TEXT,
        task TEXT,
        repo_root TEXT,
        created_at INTEGER,
        deadline_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS participants (
        session_id TEXT,
        room_id TEXT,
        name TEXT,
        harness TEXT,
        joined_at INTEGER,
        connected INTEGER,
        PRIMARY KEY (room_id, session_id)
      );
      CREATE TABLE IF NOT EXISTS messages (
        seq INTEGER,
        room_id TEXT,
        sender_id TEXT,
        sender_name TEXT,
        stage TEXT,
        content TEXT,
        timestamp TEXT,
        acknowledged INTEGER,
        PRIMARY KEY(room_id, seq)
      );
    `);
    this.save();
  }

  /**
   * Closes the database and saves it to disk.
   */
  close(): void {
    if (!this.db) return;
    this.save();
    this.db.close();
    this.db = null;
  }

  /**
   * Saves the database to disk if a dbPath is configured.
   */
  private save(): void {
    if (!this.db || !this.dbPath) return;
    const data = this.db.export();
    const buffer = Buffer.from(data);
    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.dbPath, buffer);
  }

  /**
   * Inserts a room row and returns the Room object.
   */
  createRoom(id: string, deadlineAt: number): Room {
    if (!this.db) throw new Error('Database not initialized');
    const now = Date.now();
    // OR IGNORE, not OR REPLACE: a room that already exists in the journal keeps
    // its state, task and deadline instead of being silently reset.
    this.db.run(
      'INSERT OR IGNORE INTO rooms (id, state, current_stage, task, repo_root, created_at, deadline_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
      [id, RoomState.WAITING, null, null, null, now, deadlineAt]
    );
    this.save();
    return this.getRoom(id) as Room;
  }

  /**
   * Queries a room along with its participants and message count.
   */
  getRoom(id: string): Room | null {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT * FROM rooms WHERE id = ?');
    stmt.bind([id]);
    if (!stmt.step()) {
      stmt.free();
      return null;
    }
    const row = stmt.getAsObject();
    stmt.free();

    const participants = this.getParticipants(id);
    const msgCount = this.getMessageCount(id);

    return {
      id: row.id as string,
      state: row.state as RoomState,
      currentStage: row.current_stage as ExchangeStage | null,
      task: row.task as string | null,
      repoRoot: row.repo_root as string | null,
      createdAt: row.created_at as number,
      deadlineAt: row.deadline_at as number,
      participants,
      messageCount: msgCount
    } as any as Room;
  }

  /**
   * Updates the state and optionally the current stage of a room.
   */
  updateRoomState(id: string, state: RoomState, stage?: ExchangeStage | null): void {
    if (!this.db) throw new Error('Database not initialized');
    if (stage !== undefined) {
      this.db.run('UPDATE rooms SET state = ?, current_stage = ? WHERE id = ?', [state, stage, id]);
    } else {
      this.db.run('UPDATE rooms SET state = ? WHERE id = ?', [state, id]);
    }
    this.save();
  }

  /**
   * Sets the task description for a room.
   */
  setRoomTask(id: string, task: string): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run('UPDATE rooms SET task = ? WHERE id = ?', [task, id]);
    this.save();
  }

  /**
   * Sets the repository root for a room.
   */
  setRoomRepoRoot(id: string, repoRoot: string): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run('UPDATE rooms SET repo_root = ? WHERE id = ?', [repoRoot, id]);
    this.save();
  }

  /**
   * Deletes a room and its associated participants and messages.
   */
  deleteRoom(id: string): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run('DELETE FROM rooms WHERE id = ?', [id]);
    this.db.run('DELETE FROM participants WHERE room_id = ?', [id]);
    this.db.run('DELETE FROM messages WHERE room_id = ?', [id]);
    this.save();
  }

  /**
   * Lists all available rooms.
   */
  listRooms(): Room[] {
    if (!this.db) throw new Error('Database not initialized');
    const rooms: Room[] = [];
    const stmt = this.db.prepare('SELECT id FROM rooms');
    while (stmt.step()) {
      const row = stmt.getAsObject();
      const r = this.getRoom(row.id as string);
      if (r) rooms.push(r);
    }
    stmt.free();
    return rooms;
  }

  /**
   * Inserts a participant into a room, setting them to connected.
   */
  addParticipant(roomId: string, p: Omit<Participant, 'connected'>): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(
      'INSERT OR REPLACE INTO participants (session_id, room_id, name, harness, joined_at, connected) VALUES (?, ?, ?, ?, ?, ?)',
      [p.sessionId, roomId, p.name, p.harness, p.joinedAt, 1]
    );
    this.save();
  }

  /**
   * Queries participants for a specific room.
   */
  getParticipants(roomId: string): Participant[] {
    if (!this.db) throw new Error('Database not initialized');
    const participants: Participant[] = [];
    const stmt = this.db.prepare('SELECT * FROM participants WHERE room_id = ?');
    stmt.bind([roomId]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      participants.push({
        sessionId: row.session_id as string,
        name: row.name as string,
        harness: row.harness as 'claude' | 'muse',
        joinedAt: row.joined_at as number,
        connected: (row.connected as number) === 1
      });
    }
    stmt.free();
    return participants;
  }

  /**
   * Sets a participant's connected status within a single room.
   * Scoped by room because the same session id may appear in several rooms.
   */
  setParticipantConnected(roomId: string, sessionId: string, connected: boolean): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run(
      'UPDATE participants SET connected = ? WHERE room_id = ? AND session_id = ?',
      [connected ? 1 : 0, roomId, sessionId]
    );
    this.save();
  }

  /**
   * Marks every participant of a room as disconnected.
   * Used on broker startup, since no client holds a socket across a restart.
   */
  setAllParticipantsDisconnected(roomId: string): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run('UPDATE participants SET connected = 0 WHERE room_id = ?', [roomId]);
    this.save();
  }

  /**
   * Gets the total number of participants in a room.
   */
  getParticipantCount(roomId: string): number {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM participants WHERE room_id = ?');
    stmt.bind([roomId]);
    let count = 0;
    if (stmt.step()) {
      count = stmt.getAsObject().count as number;
    }
    stmt.free();
    return count;
  }

  /**
   * Gets the next sequence number for a new message in a room.
   */
  getNextSeq(roomId: string): number {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT MAX(seq) as maxSeq FROM messages WHERE room_id = ?');
    stmt.bind([roomId]);
    let nextSeq = 1;
    if (stmt.step()) {
      const row = stmt.getAsObject();
      if (row.maxSeq != null) {
        nextSeq = (row.maxSeq as number) + 1;
      }
    }
    stmt.free();
    return nextSeq;
  }

  /**
   * Adds a message to a room, assigns a sequence number, and saves it.
   */
  addMessage(roomId: string, msg: Omit<ExchangeMessage, 'seq'>): ExchangeMessage {
    if (!this.db) throw new Error('Database not initialized');
    const seq = this.getNextSeq(roomId);
    this.db.run(
      'INSERT INTO messages (seq, room_id, sender_id, sender_name, stage, content, timestamp, acknowledged) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
      [seq, roomId, msg.senderId, msg.senderName, msg.stage || null, msg.content, msg.timestamp, 0]
    );
    this.save();
    return { ...msg, seq } as ExchangeMessage;
  }

  /**
   * Gets messages for a room after a given sequence number.
   */
  getMessages(roomId: string, afterSeq: number = 0): ExchangeMessage[] {
    if (!this.db) throw new Error('Database not initialized');
    const messages: ExchangeMessage[] = [];
    const stmt = this.db.prepare('SELECT * FROM messages WHERE room_id = ? AND seq > ? ORDER BY seq ASC');
    stmt.bind([roomId, afterSeq]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      messages.push({
        seq: row.seq as number,
        senderId: row.sender_id as string,
        senderName: row.sender_name as string,
        stage: row.stage as ExchangeStage,
        content: row.content as string,
        timestamp: row.timestamp as string,
        acknowledged: (row.acknowledged as number) === 1
      } as ExchangeMessage);
    }
    stmt.free();
    return messages;
  }

  /**
   * Gets the total number of messages in a room.
   */
  getMessageCount(roomId: string): number {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE room_id = ?');
    stmt.bind([roomId]);
    let count = 0;
    if (stmt.step()) {
      count = stmt.getAsObject().count as number;
    }
    stmt.free();
    return count;
  }

  /**
   * Marks a message as acknowledged.
   */
  acknowledgeMessage(roomId: string, seq: number): void {
    if (!this.db) throw new Error('Database not initialized');
    this.db.run('UPDATE messages SET acknowledged = 1 WHERE room_id = ? AND seq = ?', [roomId, seq]);
    this.save();
  }

  /**
   * Counts unacknowledged messages sent to a specific session.
   */
  getUnackedCount(roomId: string, sessionId: string): number {
    if (!this.db) throw new Error('Database not initialized');
    const stmt = this.db.prepare('SELECT COUNT(*) as count FROM messages WHERE room_id = ? AND sender_id != ? AND acknowledged = 0');
    stmt.bind([roomId, sessionId]);
    let count = 0;
    if (stmt.step()) {
      count = stmt.getAsObject().count as number;
    }
    stmt.free();
    return count;
  }

  /**
   * Joins messages with participants to fetch transcripts including the harness.
   */
  getTranscript(roomId: string): TranscriptEntry[] {
    if (!this.db) throw new Error('Database not initialized');
    const transcript: TranscriptEntry[] = [];
    const stmt = this.db.prepare(`
      SELECT m.seq, m.sender_id, m.sender_name, m.stage, m.content, m.timestamp, p.harness
      FROM messages m
      LEFT JOIN participants p ON m.sender_id = p.session_id AND m.room_id = p.room_id
      WHERE m.room_id = ?
      ORDER BY m.seq ASC
    `);
    stmt.bind([roomId]);
    while (stmt.step()) {
      const row = stmt.getAsObject();
      transcript.push({
        seq: row.seq as number,
        senderName: row.sender_name as string,
        stage: row.stage as ExchangeStage,
        content: row.content as string,
        timestamp: row.timestamp as string,
        harness: (row.harness as string as 'claude' | 'muse') ?? 'claude',
      });
    }
    stmt.free();
    return transcript;
  }

  /**
   * Formats the room's transcript as Markdown.
   */
  exportMarkdown(roomId: string): string {
    const room = this.getRoom(roomId);
    if (!room) throw new Error('Room not found');

    const transcript = this.getTranscript(roomId);
    
    let md = `# Room Transcript: ${roomId}\n`;
    md += `**Task:** ${room.task || 'None'}\n`;
    md += `**Repository:** ${room.repoRoot || 'None'}\n`;
    md += `**Created At:** ${new Date(room.createdAt).toISOString()}\n\n`;
    
    md += `## Messages\n\n`;

    for (const entry of transcript) {
      md += `### [${entry.timestamp}] ${entry.senderName} (${entry.harness || 'Unknown'})\n`;
      if (entry.stage) {
        md += `*Stage: ${entry.stage}*\n\n`;
      }
      md += `${entry.content}\n\n---\n\n`;
    }

    return md;
  }
}
