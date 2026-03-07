import { ChildProcess, execFile } from 'child_process';
import fs from 'fs';
import path from 'path';

import {
  CIRCUIT_BREAKER_THRESHOLD,
  DATA_DIR,
  MAX_CONCURRENT_CONTAINERS,
  MAX_IPC_MESSAGES_PER_CONTAINER,
} from './config.js';
import { logger } from './logger.js';

const MAX_CONCURRENT_TASKS = 2;
const MAX_PENDING_TASKS_PER_GROUP = 10;

interface QueuedTask {
  id: string;
  groupJid: string;
  fn: () => Promise<void>;
}

const MAX_RETRIES = 5;
const BASE_RETRY_MS = 5000;
const CIRCUIT_BREAKER_RESET_MS = 300000; // 5 min auto-reset

interface GroupState {
  active: boolean;
  idleWaiting: boolean;
  isTaskContainer: boolean;
  pendingMessages: boolean;
  pendingTasks: QueuedTask[];
  runningTaskId: string | null;
  process: ChildProcess | null;
  containerName: string | null;
  groupFolder: string | null;
  retryCount: number;
  ipcMessageCount: number;
  activeStartTime: number | null;
  consecutiveFailures: number;
  circuitBreakerTrippedAt: number | null;
  lastActivityTime: number | null;
}

export class GroupQueue {
  private groups = new Map<string, GroupState>();
  private messageCount = 0;
  private taskCount = 0;
  private waitingGroups: string[] = [];
  private processMessagesFn: ((groupJid: string) => Promise<boolean>) | null = null;
  private onUnreadIpcFn: ((groupJid: string) => void) | null = null;
  private shuttingDown = false;

  private getGroup(groupJid: string): GroupState {
    let state = this.groups.get(groupJid);
    if (!state) {
      state = {
        active: false,
        idleWaiting: false,
        isTaskContainer: false,
        pendingMessages: false,
        pendingTasks: [],
        runningTaskId: null,
        process: null,
        containerName: null,
        groupFolder: null,
        retryCount: 0,
        ipcMessageCount: 0,
        activeStartTime: null,
        consecutiveFailures: 0,
        circuitBreakerTrippedAt: null,
        lastActivityTime: null,
      };
      this.groups.set(groupJid, state);
    }
    return state;
  }

  setProcessMessagesFn(fn: (groupJid: string) => Promise<boolean>): void {
    this.processMessagesFn = fn;
  }

  setOnUnreadIpcFn(fn: (groupJid: string) => void): void {
    this.onUnreadIpcFn = fn;
  }

  enqueueMessageCheck(groupJid: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    if (state.circuitBreakerTrippedAt !== null) {
      const elapsed = Date.now() - state.circuitBreakerTrippedAt;
      if (elapsed < CIRCUIT_BREAKER_RESET_MS) {
        logger.debug(
          { groupJid, elapsed, resetIn: CIRCUIT_BREAKER_RESET_MS - elapsed },
          'Circuit breaker open, skipping processing',
        );
        return;
      } else {
        logger.info({ groupJid }, 'Circuit breaker auto-reset after cooldown');
        state.circuitBreakerTrippedAt = null;
        state.consecutiveFailures = 0;
      }
    }

    if (state.active) {
      // User messages preempt scheduled tasks — close the task container
      // so the message gets a fresh container immediately
      if (state.isTaskContainer) {
        state.pendingMessages = true;
        logger.info({ groupJid }, 'User message preempting scheduled task');
        this.closeStdin(groupJid);
        return;
      }

      state.pendingMessages = true;
      logger.debug({ groupJid }, 'Container active, message queued');
      return;
    }

    if (this.messageCount >= MAX_CONCURRENT_CONTAINERS) {
      state.pendingMessages = true;
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug(
        { groupJid, messageCount: this.messageCount },
        'At message concurrency limit, queued',
      );
      return;
    }

    this.runForGroup(groupJid, 'messages').catch((err) =>
      logger.error({ groupJid, err }, 'Unhandled error in runForGroup'),
    );
  }

  enqueueTask(groupJid: string, taskId: string, fn: () => Promise<void>): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    if (state.pendingTasks.some((t) => t.id === taskId) || state.runningTaskId === taskId) {
      logger.debug({ groupJid, taskId }, 'Task already queued or running, skipping');
      return;
    }

    if (state.pendingTasks.length >= MAX_PENDING_TASKS_PER_GROUP) {
      logger.warn({ groupJid, taskId, pending: state.pendingTasks.length }, 'Pending task queue full, dropping task');
      return;
    }

    if (state.active) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      if (state.idleWaiting) {
        this.closeStdin(groupJid);
      }
      logger.debug({ groupJid, taskId }, 'Container active, task queued');
      return;
    }

    if (this.taskCount >= MAX_CONCURRENT_TASKS) {
      state.pendingTasks.push({ id: taskId, groupJid, fn });
      if (!this.waitingGroups.includes(groupJid)) {
        this.waitingGroups.push(groupJid);
      }
      logger.debug(
        { groupJid, taskId, taskCount: this.taskCount },
        'At task concurrency limit, queued',
      );
      return;
    }

    this.runTask(groupJid, { id: taskId, groupJid, fn }).catch((err) =>
      logger.error({ groupJid, taskId, err }, 'Unhandled error in runTask'),
    );
  }

  registerProcess(groupJid: string, proc: ChildProcess, containerName: string, groupFolder?: string): void {
    const state = this.getGroup(groupJid);
    state.process = proc;
    state.containerName = containerName;
    if (groupFolder) state.groupFolder = groupFolder;
  }

  /**
   * Mark the container as idle-waiting (finished work, waiting for IPC input).
   * If tasks are pending, preempt the idle container immediately.
   */
  notifyIdle(groupJid: string): void {
    const state = this.getGroup(groupJid);
    state.idleWaiting = true;
    state.lastActivityTime = Date.now();
    if (state.pendingTasks.length > 0) {
      this.closeStdin(groupJid);
    }
  }

  /**
   * Bump the activity timer without changing any other state.
   * Call on every container output so idle detection knows it's alive.
   */
  notifyActivity(groupJid: string): void {
    const state = this.getGroup(groupJid);
    if (state.active) {
      state.lastActivityTime = Date.now();
    }
  }

  /**
   * Send a follow-up message to the active container via IPC file.
   * Returns true if the message was written, false if no active container.
   */
  sendMessage(groupJid: string, text: string): boolean {
    const state = this.getGroup(groupJid);
    if (!state.active || !state.groupFolder || state.isTaskContainer) return false;

    state.idleWaiting = false;

    state.ipcMessageCount++;
    if (state.ipcMessageCount >= MAX_IPC_MESSAGES_PER_CONTAINER) {
      logger.info(
        { groupJid, ipcMessageCount: state.ipcMessageCount },
        'Max IPC messages reached, recycling container',
      );
      state.pendingMessages = true;
      this.closeStdin(groupJid);
      return false;
    }

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}.json`;
      const filepath = path.join(inputDir, filename);
      const tempPath = `${filepath}.tmp`;
      fs.writeFileSync(tempPath, JSON.stringify({ type: 'message', text }));
      fs.renameSync(tempPath, filepath);
      return true;
    } catch (err) {
      logger.error({ groupJid, err }, 'Failed to write IPC message file');
      return false;
    }
  }

  /**
   * Signal the active container to wind down by writing a close sentinel.
   * If the container doesn't exit within 60s, force-kill it.
   */
  closeStdin(groupJid: string): void {
    const state = this.getGroup(groupJid);
    if (!state.active || !state.groupFolder) return;

    const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
    try {
      fs.mkdirSync(inputDir, { recursive: true });
      fs.writeFileSync(path.join(inputDir, '_close'), '');
    } catch {
      // ignore
    }

    // Safety net: if the container is stuck and never reads _close, force-kill after 60s
    const proc = state.process;
    const containerName = state.containerName;
    if (proc) {
      setTimeout(() => {
        if (state.active && state.process === proc) {
          logger.warn({ groupJid, containerName }, 'Container ignored close signal, force-killing');
          proc.kill('SIGKILL');
          // proc.kill only kills the host-side `docker run` process —
          // the Docker container itself can keep running as a zombie.
          if (containerName) {
            execFile('docker', ['kill', containerName], (err) => {
              if (err) {
                logger.debug({ containerName, err }, 'docker kill failed (container may already be gone)');
              } else {
                logger.info({ containerName }, 'Force-killed Docker container');
              }
            });
          }
        }
      }, 60000);
    }
  }

  private async runForGroup(
    groupJid: string,
    reason: 'messages' | 'drain',
  ): Promise<void> {
    const state = this.getGroup(groupJid);
    state.active = true;
    state.idleWaiting = false;
    state.isTaskContainer = false;
    state.pendingMessages = false;
    state.ipcMessageCount = 0;
    state.activeStartTime = Date.now();
    state.lastActivityTime = Date.now();
    this.messageCount++;

    logger.debug(
      { groupJid, reason, messageCount: this.messageCount },
      'Starting container for group',
    );

    try {
      if (this.processMessagesFn) {
        const success = await this.processMessagesFn(groupJid);
        if (success) {
          state.retryCount = 0;
          if (state.circuitBreakerTrippedAt !== null) {
            logger.info({ groupJid }, 'Circuit breaker reset after successful processing');
            state.circuitBreakerTrippedAt = null;
          }
          state.consecutiveFailures = 0;
        } else {
          state.consecutiveFailures++;
          if (state.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
            state.circuitBreakerTrippedAt = Date.now();
            logger.warn(
              { groupJid, consecutiveFailures: state.consecutiveFailures },
              'Circuit breaker tripped after consecutive failures',
            );
          }
          this.scheduleRetry(groupJid, state);
        }
      }
    } catch (err) {
      logger.error({ groupJid, err }, 'Error processing messages for group');
      state.consecutiveFailures++;
      if (state.consecutiveFailures >= CIRCUIT_BREAKER_THRESHOLD) {
        state.circuitBreakerTrippedAt = Date.now();
        logger.warn(
          { groupJid, consecutiveFailures: state.consecutiveFailures },
          'Circuit breaker tripped after consecutive failures',
        );
      }
      this.scheduleRetry(groupJid, state);
    } finally {
      // Check for unread IPC messages the container never consumed.
      // This handles the race where sendMessage() wrote a file and advanced
      // the cursor, but the container exited before reading it.
      if (state.groupFolder) {
        const inputDir = path.join(DATA_DIR, 'ipc', state.groupFolder, 'input');
        try {
          const files = fs.readdirSync(inputDir).filter(f => f.endsWith('.json'));
          if (files.length > 0) {
            logger.info({ groupJid, unread: files.length }, 'Unread IPC messages after container exit');
            state.pendingMessages = true;
            // Roll back the cursor so processGroupMessages re-fetches the lost messages
            if (this.onUnreadIpcFn) this.onUnreadIpcFn(groupJid);
            // Clean up the stale IPC files — messages will be re-fetched from DB
            for (const f of files) {
              try { fs.unlinkSync(path.join(inputDir, f)); } catch {}
            }
          }
          // Clean up close sentinel
          try { fs.unlinkSync(path.join(inputDir, '_close')); } catch {}
        } catch {}
      }
      state.active = false;
      state.activeStartTime = null;
      state.lastActivityTime = null;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      this.messageCount--;
      this.drainGroup(groupJid);
    }
  }

  private async runTask(groupJid: string, task: QueuedTask): Promise<void> {
    const state = this.getGroup(groupJid);
    state.active = true;
    state.idleWaiting = false;
    state.isTaskContainer = true;
    state.runningTaskId = task.id;
    this.taskCount++;

    logger.debug(
      { groupJid, taskId: task.id, taskCount: this.taskCount },
      'Running queued task',
    );

    try {
      await task.fn();
    } catch (err) {
      logger.error({ groupJid, taskId: task.id, err }, 'Error running task');
    } finally {
      state.active = false;
      state.isTaskContainer = false;
      state.runningTaskId = null;
      state.activeStartTime = null;
      state.lastActivityTime = null;
      state.process = null;
      state.containerName = null;
      state.groupFolder = null;
      this.taskCount--;
      this.drainGroup(groupJid);
    }
  }

  private scheduleRetry(groupJid: string, state: GroupState): void {
    state.retryCount++;
    if (state.retryCount > MAX_RETRIES) {
      logger.error(
        { groupJid, retryCount: state.retryCount },
        'Max retries exceeded, dropping messages (will retry on next incoming message)',
      );
      state.retryCount = 0;
      return;
    }

    const delayMs = BASE_RETRY_MS * Math.pow(2, state.retryCount - 1);
    logger.info(
      { groupJid, retryCount: state.retryCount, delayMs },
      'Scheduling retry with backoff',
    );
    setTimeout(() => {
      if (!this.shuttingDown) {
        this.enqueueMessageCheck(groupJid);
      }
    }, delayMs);
  }

  private drainGroup(groupJid: string): void {
    if (this.shuttingDown) return;

    const state = this.getGroup(groupJid);

    // Tasks first (they won't be re-discovered from SQLite like messages)
    if (state.pendingTasks.length > 0) {
      const task = state.pendingTasks.shift()!;
      this.runTask(groupJid, task).catch((err) =>
        logger.error({ groupJid, taskId: task.id, err }, 'Unhandled error in runTask (drain)'),
      );
      return;
    }

    // Then pending messages
    if (state.pendingMessages) {
      this.runForGroup(groupJid, 'drain').catch((err) =>
        logger.error({ groupJid, err }, 'Unhandled error in runForGroup (drain)'),
      );
      return;
    }

    this.drainWaiting();
  }

  private drainWaiting(): void {
    while (this.waitingGroups.length > 0) {
      const nextJid = this.waitingGroups[0];
      const state = this.getGroup(nextJid);

      if (state.pendingTasks.length > 0 && this.taskCount < MAX_CONCURRENT_TASKS) {
        this.waitingGroups.shift();
        const task = state.pendingTasks.shift()!;
        this.runTask(nextJid, task).catch((err) =>
          logger.error({ groupJid: nextJid, taskId: task.id, err }, 'Unhandled error in runTask (waiting)'),
        );
      } else if (state.pendingMessages && this.messageCount < MAX_CONCURRENT_CONTAINERS) {
        this.waitingGroups.shift();
        this.runForGroup(nextJid, 'drain').catch((err) =>
          logger.error({ groupJid: nextJid, err }, 'Unhandled error in runForGroup (waiting)'),
        );
      } else {
        break;
      }
    }
  }

  async shutdown(gracePeriodMs: number): Promise<void> {
    this.shuttingDown = true;

    const activeContainers: string[] = [];
    for (const [jid, state] of this.groups) {
      if (state.active && state.groupFolder) {
        this.closeStdin(jid);
        if (state.containerName) activeContainers.push(state.containerName);
      }
    }

    if (activeContainers.length > 0) {
      logger.info(
        { containers: activeContainers, gracePeriodMs },
        'Sent close signal to active containers, waiting for wind-down',
      );
      await new Promise((resolve) => setTimeout(resolve, Math.min(gracePeriodMs, 10000)));
    }

    logger.info(
      { messageCount: this.messageCount, taskCount: this.taskCount },
      'GroupQueue shutdown complete',
    );
  }
}
