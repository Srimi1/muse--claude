import { describe, it, expect } from 'vitest';
import { TALK_TOOLS } from '../src/mcp/tools.js';

describe('MCP Tools Schema & Definitions', () => {
  it('exposes all 5 required talk tools', () => {
    const toolNames = TALK_TOOLS.map((t) => t.name);
    expect(toolNames).toContain('talk_join');
    expect(toolNames).toContain('talk_send');
    expect(toolNames).toContain('talk_receive');
    expect(toolNames).toContain('talk_status');
    expect(toolNames).toContain('talk_stop');
    expect(TALK_TOOLS.length).toBe(5);
  });

  it('validates schema for talk_join', () => {
    const tool = TALK_TOOLS.find((t) => t.name === 'talk_join');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(['room', 'name']);
    expect(tool?.inputSchema.properties.room.type).toBe('string');
    expect(tool?.inputSchema.properties.name.type).toBe('string');
  });

  it('validates schema for talk_send with 8 KiB guidance in description', () => {
    const tool = TALK_TOOLS.find((t) => t.name === 'talk_send');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(['room', 'content']);
    expect(tool?.description).toContain('8 KiB');
  });

  it('validates schema for talk_receive with optional afterSeq parameter', () => {
    const tool = TALK_TOOLS.find((t) => t.name === 'talk_receive');
    expect(tool).toBeDefined();
    expect(tool?.inputSchema.required).toEqual(['room']);
    expect(tool?.inputSchema.properties.afterSeq).toBeDefined();
    expect(tool?.inputSchema.properties.afterSeq.type).toBe('number');
  });

  it('validates schema for talk_status and talk_stop', () => {
    const statusTool = TALK_TOOLS.find((t) => t.name === 'talk_status');
    expect(statusTool?.inputSchema.required).toEqual(['room']);

    const stopTool = TALK_TOOLS.find((t) => t.name === 'talk_stop');
    expect(stopTool?.inputSchema.required).toEqual(['room']);
  });
});
