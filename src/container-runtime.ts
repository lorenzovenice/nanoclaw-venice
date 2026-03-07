/**
 * Container runtime abstraction for NanoClaw.
 * All runtime-specific logic lives here so swapping runtimes means changing one file.
 */
import { execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';

import { DATA_DIR } from './config.js';
import { logger } from './logger.js';

/** The container runtime binary name. */
export const CONTAINER_RUNTIME_BIN = 'docker';

/** Returns CLI args for a readonly bind mount. */
export function readonlyMountArgs(hostPath: string, containerPath: string): string[] {
  return ['-v', `${hostPath}:${containerPath}:ro`];
}

/** Returns CLI args to stop a container by name. */
export function stopContainerArgs(name: string): string[] {
  return ['stop', name];
}

/** Returns the shell command to stop a container by name (legacy compat). */
export function stopContainer(name: string): string {
  return `${CONTAINER_RUNTIME_BIN} stop ${name}`;
}

/** Ensure the container runtime is running, starting it if needed. */
export function ensureContainerRuntimeRunning(): void {
  try {
    execFileSync(CONTAINER_RUNTIME_BIN, ['info'], { stdio: 'pipe', timeout: 10000 });
    logger.debug('Container runtime already running');
  } catch (err) {
    logger.error({ err }, 'Failed to reach container runtime');
    console.error(
      '\n╔════════════════════════════════════════════════════════════════╗',
    );
    console.error(
      '║  FATAL: Container runtime failed to start                      ║',
    );
    console.error(
      '║                                                                ║',
    );
    console.error(
      '║  Agents cannot run without a container runtime. To fix:        ║',
    );
    console.error(
      '║  1. Ensure Docker is installed and running                     ║',
    );
    console.error(
      '║  2. Run: docker info                                           ║',
    );
    console.error(
      '║  3. Restart NanoClaw                                           ║',
    );
    console.error(
      '╚════════════════════════════════════════════════════════════════╝\n',
    );
    throw new Error('Container runtime is required but failed to start');
  }
}

/**
 * Extract the group folder from a container name.
 * Container names follow the pattern: nanoclaw-{groupFolder}-{timestamp}
 */
function extractGroupFolder(containerName: string): string | null {
  const match = containerName.match(/^nanoclaw-(.+)-\d+$/);
  return match ? match[1] : null;
}

/** Send IPC close signal to a container's group folder so the agent can save state. */
function sendCloseSignal(groupFolder: string): void {
  const inputDir = path.join(DATA_DIR, 'ipc', groupFolder, 'input');
  try {
    fs.mkdirSync(inputDir, { recursive: true });
    fs.writeFileSync(path.join(inputDir, '_close'), '');
  } catch {
    // ignore — best effort
  }
}

/** Remove stale IPC input files left by dead containers. */
export function cleanupStaleIpcFiles(): void {
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  try {
    if (!fs.existsSync(ipcBaseDir)) return;
    const groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
      try { return fs.statSync(path.join(ipcBaseDir, f)).isDirectory() && f !== 'errors'; } catch { return false; }
    });

    let totalCleaned = 0;
    for (const folder of groupFolders) {
      const inputDir = path.join(ipcBaseDir, folder, 'input');
      try {
        if (!fs.existsSync(inputDir)) continue;
        const files = fs.readdirSync(inputDir);
        for (const file of files) {
          if (file.endsWith('.json') || file === '_close') {
            try { fs.unlinkSync(path.join(inputDir, file)); totalCleaned++; } catch {}
          }
        }
      } catch {}
    }

    if (totalCleaned > 0) {
      logger.info({ count: totalCleaned }, 'Cleaned up stale IPC input files');
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up stale IPC files');
  }
}

/** Kill orphaned NanoClaw containers from previous runs, with grace period. */
export function cleanupOrphans(): void {
  try {
    const output = execFileSync(
      CONTAINER_RUNTIME_BIN,
      ['ps', '--filter', 'name=nanoclaw-', '--format', '{{.Names}}'],
      { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
    );
    const orphans = output.trim().split('\n').filter(Boolean);
    if (orphans.length === 0) return;

    // Send close signal to each orphan so agents can save state
    for (const name of orphans) {
      const groupFolder = extractGroupFolder(name);
      if (groupFolder) sendCloseSignal(groupFolder);
    }

    logger.info(
      { count: orphans.length, names: orphans },
      'Sent close signal to orphaned containers, waiting 5s for wind-down',
    );

    // Give agents time to write session handoff notes
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      try {
        const remaining = execFileSync(
          CONTAINER_RUNTIME_BIN,
          ['ps', '--filter', 'name=nanoclaw-', '--format', '{{.Names}}'],
          { stdio: ['pipe', 'pipe', 'pipe'], encoding: 'utf-8' },
        ).trim().split('\n').filter(Boolean);
        if (remaining.length === 0) {
          logger.info('All orphaned containers exited during grace period');
          return;
        }
      } catch { /* ignore check errors */ }
      execFileSync('sleep', ['1'], { stdio: 'pipe' });
    }

    // Force-stop any that are still running
    for (const name of orphans) {
      try {
        execFileSync(CONTAINER_RUNTIME_BIN, stopContainerArgs(name), { stdio: 'pipe' });
      } catch { /* already stopped */ }
    }
    logger.info({ count: orphans.length, names: orphans }, 'Stopped orphaned containers after grace period');
  } catch (err) {
    logger.warn({ err }, 'Failed to clean up orphaned containers');
  }
}
