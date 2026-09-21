import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import os from 'os';

const configDir = path.join(os.tmpdir(), `wt-config-${process.pid}`);

// CONFIG_DIR is derived from the real home directory at module load, so it is
// redirected here to keep the test off the developer's actual machine state.
vi.mock('../src/config/constants.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/config/constants.js')>();
  return { ...actual, CONFIG_DIR: configDir };
});

const { createParticipantWorktree, removeParticipantWorktree } = await import('../src/git/worktree.js');

/** A room name carrying shell metacharacters, as a user could supply. */
const HOSTILE_ROOM = 'room"; touch MARKER; echo "x';
const HOSTILE_NAME = 'name$(touch MARKER)`id`';

describe('Participant worktree isolation', () => {
  let repo: string;
  let marker: string;

  beforeEach(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), 'wt-repo-'));
    marker = path.join(repo, 'MARKER');
    const git = (args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'pipe' });
    git(['init', '-q', '-b', 'main']);
    git(['config', 'user.email', 'test@example.com']);
    git(['config', 'user.name', 'Test']);
    fs.writeFileSync(path.join(repo, 'README.md'), '# test\n');
    git(['add', '.']);
    git(['commit', '-qm', 'initial']);
  });

  afterEach(() => {
    fs.rmSync(repo, { recursive: true, force: true });
    fs.rmSync(configDir, { recursive: true, force: true });
  });

  it('does not execute shell metacharacters from a room or participant name', () => {
    const info = createParticipantWorktree(repo, HOSTILE_ROOM, HOSTILE_NAME);

    // The injected `touch MARKER` must never have run.
    expect(fs.existsSync(marker)).toBe(false);
    expect(fs.existsSync(path.join(process.cwd(), 'MARKER'))).toBe(false);

    // Both segments are reduced to ref-safe characters.
    expect(info.branch).toBe('talk/room___touch_MARKER__echo__x/name__touch_MARKER__id_');
    expect(info.branch).not.toMatch(/["`$;]/);
    expect(fs.existsSync(info.worktreePath)).toBe(true);

    const branches = execFileSync('git', ['branch', '--list'], { cwd: repo, encoding: 'utf-8' });
    expect(branches).toContain(info.branch);

    removeParticipantWorktree(repo, HOSTILE_ROOM, HOSTILE_NAME, true);
    expect(fs.existsSync(info.worktreePath)).toBe(false);
  });

  it('keeps separate rooms in separate worktrees', () => {
    const a = createParticipantWorktree(repo, 'room-a', 'alice');
    const b = createParticipantWorktree(repo, 'room-b', 'alice');

    expect(a.worktreePath).not.toBe(b.worktreePath);
    expect(a.branch).toBe('talk/room-a/alice');
    expect(b.branch).toBe('talk/room-b/alice');
    expect(a.baseCommit).toMatch(/^[0-9a-f]{40}$/);

    removeParticipantWorktree(repo, 'room-a', 'alice', true);
    removeParticipantWorktree(repo, 'room-b', 'alice', true);
  });

  it('falls back to a placeholder when a name sanitizes to nothing', () => {
    const info = createParticipantWorktree(repo, '///', '%%%');
    expect(info.branch).toBe('talk/___/___');
    removeParticipantWorktree(repo, '///', '%%%', true);
  });
});
