/**
 * Git worktree management for /talk participant isolation.
 * Ensures each participant operates in a separate branch/worktree,
 * preventing accidental overwrite, auto-merge, or conflicting edits.
 * @module git/worktree
 */

import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CONFIG_DIR } from '../config/constants.js';

export interface WorktreeInfo {
  worktreePath: string;
  branch: string;
  baseCommit: string;
}

/** Extra environment needed to reach a working git, if any. */
type GitEnv = Record<string, string> | undefined;

/**
 * Reduces a caller-supplied identifier to characters that are safe in a git
 * ref and a filesystem path. Room names and participant names both arrive
 * from user input, so neither is trusted.
 */
function sanitizeSegment(value: string): string {
  const cleaned = value.replace(/[^a-zA-Z0-9_-]/g, '_');
  return cleaned.length > 0 ? cleaned : 'unnamed';
}

/** Runs a git command with arguments passed as argv, never through a shell. */
function git(args: string[], cwd: string, env: GitEnv): string {
  return execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    encoding: 'utf-8',
    env: env ? { ...process.env, ...env } : process.env,
  });
}

/**
 * Checks if git is operational and not blocked by Xcode license agreements.
 * @returns { operational: boolean; licenseBlocked: boolean; message?: string }
 */
export function checkGitStatus(): { operational: boolean; licenseBlocked: boolean; env?: Record<string, string>; message?: string } {
  try {
    execFileSync('git', ['--version'], { stdio: 'pipe' });
    return { operational: true, licenseBlocked: false };
  } catch (err: any) {
    const output = String(err.stderr || err.stdout || err.message);
    if (output.includes('Xcode') || output.includes('license')) {
      // Check if Apple CommandLineTools is available as an unblocked alternative
      if (fs.existsSync('/Library/Developer/CommandLineTools/usr/bin/git')) {
        try {
          execFileSync('git', ['--version'], {
            stdio: 'pipe',
            env: { ...process.env, DEVELOPER_DIR: '/Library/Developer/CommandLineTools' },
          });
          return {
            operational: true,
            licenseBlocked: false,
            env: { DEVELOPER_DIR: '/Library/Developer/CommandLineTools' },
          };
        } catch {
          // fall through
        }
      }
      return {
        operational: false,
        licenseBlocked: true,
        message: 'Git is blocked by unaccepted Xcode license. Please run: sudo xcodebuild -license accept',
      };
    }
    return {
      operational: false,
      licenseBlocked: false,
      message: `Git is not available: ${err.message}`,
    };
  }
}

/**
 * Creates an isolated worktree for a /talk participant.
 *
 * @param repoRoot - Path to the git repository
 * @param roomId - The active /talk room ID
 * @param participantName - The participant's display name or session ID
 * @returns Information about the created worktree
 */
export function createParticipantWorktree(
  repoRoot: string,
  roomId: string,
  participantName: string
): WorktreeInfo {
  const gitCheck = checkGitStatus();
  if (!gitCheck.operational) {
    throw new Error(gitCheck.message || 'Git is not operational');
  }
  // checkGitStatus may have found git only via DEVELOPER_DIR; every git call
  // below has to run with that same environment or it will fail again.
  const env = gitCheck.env;

  // Sanitize both segments for branch and path
  const sanitizedRoom = sanitizeSegment(roomId);
  const sanitizedName = sanitizeSegment(participantName);
  const worktreeDir = path.join(CONFIG_DIR, 'worktrees', sanitizedRoom, sanitizedName);
  const branch = `talk/${sanitizedRoom}/${sanitizedName}`;

  if (fs.existsSync(worktreeDir)) {
    // Worktree directory already exists
    return {
      worktreePath: worktreeDir,
      branch,
      baseCommit: getCurrentCommit(repoRoot, env),
    };
  }

  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });

  const baseCommit = getCurrentCommit(repoRoot, env);

  try {
    // Check if branch exists
    let branchExists = false;
    try {
      git(['rev-parse', '--verify', `refs/heads/${branch}`], repoRoot, env);
      branchExists = true;
    } catch {
      branchExists = false;
    }

    if (branchExists) {
      git(['worktree', 'add', worktreeDir, branch], repoRoot, env);
    } else {
      git(['worktree', 'add', '-b', branch, worktreeDir, baseCommit], repoRoot, env);
    }

    return {
      worktreePath: worktreeDir,
      branch,
      baseCommit,
    };
  } catch (err: any) {
    throw new Error(`Failed to create worktree: ${err.message}`);
  }
}

/**
 * Removes a participant worktree and optionally deletes the branch.
 *
 * @param repoRoot - Path to the git repository
 * @param roomId - The active /talk room ID
 * @param participantName - The participant's display name or session ID
 * @param deleteBranch - Whether to delete the associated git branch
 */
export function removeParticipantWorktree(
  repoRoot: string,
  roomId: string,
  participantName: string,
  deleteBranch = false
): void {
  const gitCheck = checkGitStatus();
  if (!gitCheck.operational) return;
  const env = gitCheck.env;

  const sanitizedRoom = sanitizeSegment(roomId);
  const sanitizedName = sanitizeSegment(participantName);
  const worktreeDir = path.join(CONFIG_DIR, 'worktrees', sanitizedRoom, sanitizedName);
  const branch = `talk/${sanitizedRoom}/${sanitizedName}`;

  try {
    if (fs.existsSync(worktreeDir)) {
      git(['worktree', 'remove', '--force', worktreeDir], repoRoot, env);
    }
    if (deleteBranch) {
      git(['branch', '-D', branch], repoRoot, env);
    }
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Gets the current HEAD commit hash of a git repository.
 */
function getCurrentCommit(repoRoot: string, env?: GitEnv): string {
  try {
    return git(['rev-parse', 'HEAD'], repoRoot, env).trim();
  } catch {
    return 'HEAD';
  }
}
