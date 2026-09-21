/**
 * Shared types for the /talk broker protocol.
 * @module broker/types
 */

/** Possible states for a room. */
export enum RoomState {
  /** Waiting for second participant to join */
  WAITING = 'WAITING',
  /** Both participants joined, ready to start */
  ACTIVE = 'ACTIVE',
  /** Exchange in progress */
  EXCHANGING = 'EXCHANGING',
  /** Participants reviewing each other's work */
  REVIEWING = 'REVIEWING',
  /** Exchange complete */
  DONE = 'DONE',
  /** Exchange cancelled */
  CANCELLED = 'CANCELLED',
}

/** Exchange stage within the EXCHANGING/REVIEWING states. */
export enum ExchangeStage {
  PROPOSAL = 'PROPOSAL',
  CRITIQUE_OWNERSHIP = 'CRITIQUE_OWNERSHIP',
  IMPLEMENTATION_A = 'IMPLEMENTATION_A',
  IMPLEMENTATION_B = 'IMPLEMENTATION_B',
  REVIEW = 'REVIEW',
  SYNTHESIS = 'SYNTHESIS',
}

/** Participant identity. */
export interface Participant {
  /** Display name chosen at join time */
  name: string;
  /** Unique session ID assigned by the adapter */
  sessionId: string;
  /** Which CLI harness: 'claude' or 'muse' */
  harness: 'claude' | 'muse';
  /** When the participant joined */
  joinedAt: number;
  /** Whether the participant is currently connected */
  connected: boolean;
}

/** A message in the exchange. */
export interface ExchangeMessage {
  /** Monotonically increasing sequence ID within the room */
  seq: number;
  /** Session ID of the sender */
  senderId: string;
  /** Display name of the sender */
  senderName: string;
  /** Which exchange stage this message belongs to */
  stage: ExchangeStage;
  /** Message content (max 8 KiB) */
  content: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Whether the recipient has acknowledged receipt */
  acknowledged: boolean;
}

/** Room metadata. */
export interface Room {
  /** Room identifier */
  id: string;
  /** Current state */
  state: RoomState;
  /** Current exchange stage (null if not in exchange) */
  currentStage: ExchangeStage | null;
  /** Participants (max 2) */
  participants: Participant[];
  /** Total messages sent */
  messageCount: number;
  /** When the room was created */
  createdAt: number;
  /** When the room deadline expires */
  deadlineAt: number;
  /** The task being discussed (set by /talk start) */
  task: string | null;
  /** Repository root path for identity verification */
  repoRoot: string | null;
}

/** Status response. */
export interface RoomStatus {
  room: Room;
  pendingMessages: number;
  /** Messages awaiting acknowledgement from each participant */
  unackedBySession: Record<string, number>;
}

/** Transcript entry for export. */
export interface TranscriptEntry {
  seq: number;
  senderName: string;
  harness: 'claude' | 'muse';
  stage: ExchangeStage;
  content: string;
  timestamp: string;
}

/** Final summary generated at exchange completion. */
export interface ExchangeSummary {
  roomId: string;
  task: string;
  participants: Array<{ name: string; harness: 'claude' | 'muse' }>;
  agreements: string[];
  disagreements: string[];
  changedFiles: string[];
  testResults: string[];
  completedAt: string;
}

/** Error codes for the broker protocol. */
export enum BrokerError {
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  ROOM_FULL = 'ROOM_FULL',
  ROOM_DEADLINE_EXCEEDED = 'ROOM_DEADLINE_EXCEEDED',
  NOT_PARTICIPANT = 'NOT_PARTICIPANT',
  STALE_TARGET = 'STALE_TARGET',
  MESSAGE_TOO_LARGE = 'MESSAGE_TOO_LARGE',
  EXCHANGE_LIMIT_REACHED = 'EXCHANGE_LIMIT_REACHED',
  INVALID_STATE = 'INVALID_STATE',
  DUPLICATE_MESSAGE = 'DUPLICATE_MESSAGE',
  PEER_DISCONNECTED = 'PEER_DISCONNECTED',
  AUTH_FAILURE = 'AUTH_FAILURE',
}
