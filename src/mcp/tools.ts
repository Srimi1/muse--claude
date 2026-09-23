/**
 * MCP tool definitions for the /talk protocol.
 * @module mcp/tools
 */

/** MCP tool schema definition. */
export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, { type: string; description: string }>;
    required: string[];
  };
}

/** All /talk MCP tools. */
export const TALK_TOOLS: McpToolDefinition[] = [
  {
    name: 'talk_join',
    description: 'Join a /talk room. Creates the room if it does not exist. Waits for a peer to join.',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string', description: 'Room name to join' },
        name: { type: 'string', description: 'Your display name in this room' },
      },
      required: ['room', 'name'],
    },
  },
  {
    name: 'talk_send',
    description:
      'Send a message to your peer in the /talk room. Max 8 KiB. Exchange has 6 stages: Proposal → Critique → Implementation A → Implementation B → Review → Synthesis.',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string', description: 'Room name' },
        content: { type: 'string', description: 'Message content (max 8 KiB)' },
      },
      required: ['room', 'content'],
    },
  },
  {
    name: 'talk_receive',
    description: 'Wait for and receive the next message from your peer. Long-polls for up to 30 seconds.',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string', description: 'Room name' },
        afterSeq: { type: 'number', description: 'Only return messages after this sequence number (optional)' },
      },
      required: ['room'],
    },
  },
  {
    name: 'talk_status',
    description: 'Get the current status of a /talk room: participants, stage, pending messages.',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string', description: 'Room name' },
      },
      required: ['room'],
    },
  },
  {
    name: 'talk_stop',
    description: 'Stop the /talk exchange cooperatively. Both participants are notified.',
    inputSchema: {
      type: 'object',
      properties: {
        room: { type: 'string', description: 'Room name' },
      },
      required: ['room'],
    },
  },
];
