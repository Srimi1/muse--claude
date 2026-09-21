/**
 * Git worktree management for /talk participant isolation.
 * Ensures each participant operates in a separate branch/worktree,
 * preventing accidental overwrite, auto-merge, or conflicting edits.
 * @module git/worktree
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { CONFIG_DIR } from '../config/constants.js';

export interface WorktreeInfo {
  worktreePath: string;
  branch: string;
  baseCommit: string;
}

/**
 * Checks if git is operational and not blocked by Xcode license agreements.
 * @returns { operational: boolean; licenseBlocked: boolean; message?: string }
 */
export function checkGitStatus(): { operational: boolean; licenseBlocked: boolean; env?: Record<string, string>; message?: string } {
  try {
    execSync('git --version', { stdio: 'pipe' });
    return { operational: true, licenseBlocked: false };
  } catch (err: any) {
    const output = String(err.stderr || err.stdout || err.message);
    if (output.includes('Xcode') || output.includes('license')) {
      // Check if Apple CommandLineTools is available as an unblocked alternative
      if (fs.existsSync('/Library/Developer/CommandLineTools/usr/bin/git')) {
        try {
          execSync('git --version', {
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

  // Sanitize participant name for branch and path
  const sanitizedName = participantName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const worktreeDir = path.join(CONFIG_DIR, 'worktrees', roomId, sanitizedName);
  const branch = `talk/${roomId}/${sanitizedName}`;

  if (fs.existsSync(worktreeDir)) {
    // Worktree directory already exists
    return {
      worktreePath: worktreeDir,
      branch,
      baseCommit: getCurrentCommit(repoRoot),
    };
  }

  fs.mkdirSync(path.dirname(worktreeDir), { recursive: true });

  const baseCommit = getCurrentCommit(repoRoot);

  try {
    // Check if branch exists
    let branchExists = false;
    try {
      execSync(`git rev-parse --verify refs/heads/${branch}`, { cwd: repoRoot, stdio: 'pipe' });
      branchExists = true;
    } catch {
      branchExists = false;
    }

    if (branchExists) {
      execSync(`git worktree add "${worktreeDir}" "${branch}"`, { cwd: repoRoot, stdio: 'pipe' });
    } else {
      execSync(`git worktree add -b "${branch}" "${worktreeDir}" "${baseCommit}"`, {
        cwd: repoRoot,
        stdio: 'pipe',
      });
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

  const sanitizedName = participantName.replace(/[^a-zA-Z0-9_-]/g, '_');
  const worktreeDir = path.join(CONFIG_DIR, 'worktrees', roomId, sanitizedName);
  const branch = `talk/${roomId}/${sanitizedName}`;

  try {
    if (fs.existsSync(worktreeDir)) {
      execSync(`git worktree remove --force "${worktreeDir}"`, { cwd: repoRoot, stdio: 'pipe' });
    }
    if (deleteBranch) {
      execSync(`git branch -D "${branch}"`, { cwd: repoRoot, stdio: 'pipe' });
    }
  } catch {
    // Best-effort cleanup
  }
}

/**
 * Gets the current HEAD commit hash of a git repository.
 */
function getCurrentCommit(repoRoot: string): string {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, stdio: 'pipe', encoding: 'utf-8' }).trim();
  } catch {
    return 'HEAD';
  }
}
