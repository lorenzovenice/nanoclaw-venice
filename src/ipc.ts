import fs from 'fs';
import path from 'path';

import { CronExpressionParser } from 'cron-parser';

import {
  DATA_DIR,
  IPC_POLL_INTERVAL,
  MAIN_GROUP_FOLDER,
  TIMEZONE,
} from './config.js';
import { AvailableGroup } from './container-runner.js';
import { createTask, deleteTask, getTaskById, updateTask } from './db.js';
import { isValidGroupFolder, resolveGroupIpcPath } from './group-folder.js';
import { logger } from './logger.js';
import { RegisteredGroup, ScheduledTask } from './types.js';

export interface IpcDeps {
  sendMessage: (jid: string, text: string) => Promise<void>;
  registeredGroups: () => Record<string, RegisteredGroup>;
  registerGroup: (jid: string, group: RegisteredGroup) => void;
  syncGroupMetadata: (force: boolean) => Promise<void>;
  getAvailableGroups: () => AvailableGroup[];
  writeGroupsSnapshot: (
    groupFolder: string,
    isMain: boolean,
    availableGroups: AvailableGroup[],
    registeredJids: Set<string>,
  ) => void;
  delegateTask?: (
    targetJid: string,
    prompt: string,
    contextMode: 'group' | 'isolated',
    model: string | null,
    taskName: string,
    sourceGroup: string,
  ) => void;
  onIpcActivity?: (sourceGroup: string) => void;
}

/**
 * Write an error message into a container's IPC input directory so the
 * agent learns that a direct file write failed and should use MCP tools.
 */
function sendIpcErrorToContainer(sourceGroup: string, detail: string): void {
  try {
    const inputDir = path.join(resolveGroupIpcPath(sourceGroup), 'input');
    fs.mkdirSync(inputDir, { recursive: true });
    const msg = {
      type: 'message',
      text: `[SYSTEM: An IPC file you wrote directly was rejected. ${detail} Do NOT write files to /workspace/ipc/ directly — always use your MCP tools (mcp__nanoclaw__send_message, mcp__nanoclaw__schedule_task, etc.). Retry using the correct tool now.]`,
    };
    const file = path.join(inputDir, `ipc-error-${Date.now()}.json`);
    fs.writeFileSync(file, JSON.stringify(msg));
  } catch (err) {
    logger.error({ err, sourceGroup }, 'Failed to send IPC error feedback to container');
  }
}

let ipcWatcherRunning = false;
let storedDeps: IpcDeps | null = null;

/**
 * Flush any remaining IPC message files for a specific group.
 * Called after a subagent container exits to process last-moment messages
 * before the safety net relay fires.
 */
export async function flushGroupIpcMessages(groupFolder: string): Promise<void> {
  if (!storedDeps) return;
  const deps = storedDeps;
  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  const messagesDir = path.join(ipcBaseDir, groupFolder, 'messages');
  const isMain = groupFolder === MAIN_GROUP_FOLDER;
  const registeredGroups = deps.registeredGroups();

  try {
    if (!fs.existsSync(messagesDir)) return;
    const messageFiles = fs.readdirSync(messagesDir).filter((f) => f.endsWith('.json'));
    if (messageFiles.length === 0) return;
    logger.info({ groupFolder, count: messageFiles.length }, 'Flushing remaining IPC messages after container exit');
    for (const file of messageFiles) {
      const filePath = path.join(messagesDir, file);
      try {
        const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
        if (data.type === 'message' && data.chatJid && data.text) {
          const targetGroup = registeredGroups[data.chatJid];
          if (isMain || (targetGroup && targetGroup.folder === groupFolder)) {
            await deps.sendMessage(data.chatJid, data.text);
            logger.info({ chatJid: data.chatJid, groupFolder }, 'IPC message sent (flush)');
          }
        }
        fs.unlinkSync(filePath);
      } catch (err) {
        logger.error({ file, groupFolder, err }, 'Error processing IPC message during flush');
        try { fs.unlinkSync(filePath); } catch {}
      }
    }
  } catch (err) {
    logger.error({ err, groupFolder }, 'Error during IPC flush');
  }
}

export function startIpcWatcher(deps: IpcDeps): void {
  if (ipcWatcherRunning) {
    logger.debug('IPC watcher already running, skipping duplicate start');
    return;
  }
  ipcWatcherRunning = true;
  storedDeps = deps;

  const ipcBaseDir = path.join(DATA_DIR, 'ipc');
  fs.mkdirSync(ipcBaseDir, { recursive: true });

  const processIpcFiles = async () => {
    // Scan all group IPC directories (identity determined by directory)
    let groupFolders: string[];
    try {
      groupFolders = fs.readdirSync(ipcBaseDir).filter((f) => {
        const stat = fs.statSync(path.join(ipcBaseDir, f));
        return stat.isDirectory() && f !== 'errors';
      });
    } catch (err) {
      logger.error({ err }, 'Error reading IPC base directory');
      setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
      return;
    }

    const registeredGroups = deps.registeredGroups();

    for (const sourceGroup of groupFolders) {
      const isMain = sourceGroup === MAIN_GROUP_FOLDER;
      const messagesDir = path.join(ipcBaseDir, sourceGroup, 'messages');
      const tasksDir = path.join(ipcBaseDir, sourceGroup, 'tasks');

      // Process messages from this group's IPC directory
      try {
        if (fs.existsSync(messagesDir)) {
          const messageFiles = fs
            .readdirSync(messagesDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of messageFiles) {
            const filePath = path.join(messagesDir, file);
            try {
              const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

              // Validate: message files must have type='message' with chatJid+text
              if (raw.type !== 'message' || !raw.chatJid || !raw.text) {
                logger.warn({ file, sourceGroup, type: raw.type }, 'Rejected invalid IPC message file');
                sendIpcErrorToContainer(sourceGroup, `The file "${file}" was rejected because it is not a valid message IPC file.`);
                fs.unlinkSync(filePath);
                continue;
              }

              const data = raw;
              // Authorization: verify this group can send to this chatJid
              const targetGroup = registeredGroups[data.chatJid];
              if (
                isMain ||
                (targetGroup && targetGroup.folder === sourceGroup)
              ) {
                await deps.sendMessage(data.chatJid, data.text);
                logger.info(
                  { chatJid: data.chatJid, sourceGroup },
                  'IPC message sent',
                );
                // Notify subagent IPC activity callback if registered
                deps.onIpcActivity?.(sourceGroup);
              } else {
                logger.warn(
                  { chatJid: data.chatJid, sourceGroup },
                  'Unauthorized IPC message attempt blocked',
                );
                sendIpcErrorToContainer(sourceGroup, `You tried to send a message to "${data.chatJid}" but your group is not authorized to do so.`);
              }
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC message',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error(
          { err, sourceGroup },
          'Error reading IPC messages directory',
        );
      }

      // Process tasks from this group's IPC directory
      try {
        if (fs.existsSync(tasksDir)) {
          const taskFiles = fs
            .readdirSync(tasksDir)
            .filter((f) => f.endsWith('.json'));
          for (const file of taskFiles) {
            const filePath = path.join(tasksDir, file);
            try {
              const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
              // Pass source group identity to processTaskIpc for authorization
              await processTaskIpc(data, sourceGroup, isMain, deps);
              fs.unlinkSync(filePath);
            } catch (err) {
              logger.error(
                { file, sourceGroup, err },
                'Error processing IPC task',
              );
              const errorDir = path.join(ipcBaseDir, 'errors');
              fs.mkdirSync(errorDir, { recursive: true });
              fs.renameSync(
                filePath,
                path.join(errorDir, `${sourceGroup}-${file}`),
              );
            }
          }
        }
      } catch (err) {
        logger.error({ err, sourceGroup }, 'Error reading IPC tasks directory');
      }
    }

    setTimeout(processIpcFiles, IPC_POLL_INTERVAL);
  };

  processIpcFiles();
  logger.info('IPC watcher started (per-group namespaces)');
}

export async function processTaskIpc(
  data: {
    type: string;
    taskId?: string;
    prompt?: string;
    schedule_type?: string;
    schedule_value?: string;
    context_mode?: string;
    groupFolder?: string;
    chatJid?: string;
    targetJid?: string;
    model?: string;
    taskName?: string;
    // For register_group
    jid?: string;
    name?: string;
    folder?: string;
    trigger?: string;
    requiresTrigger?: boolean;
    containerConfig?: RegisteredGroup['containerConfig'];
  },
  sourceGroup: string,
  isMain: boolean,
  deps: IpcDeps,
): Promise<void> {
  const registeredGroups = deps.registeredGroups();

  switch (data.type) {
    case 'schedule_task':
      if (
        data.prompt &&
        data.schedule_type &&
        data.schedule_value &&
        data.targetJid
      ) {
        const targetJid = data.targetJid as string;
        const targetGroupEntry = registeredGroups[targetJid];

        if (!targetGroupEntry) {
          logger.warn(
            { targetJid },
            'Cannot schedule task: target group not registered',
          );
          break;
        }

        const targetFolder = targetGroupEntry.folder;

        if (!isMain && targetFolder !== sourceGroup) {
          logger.warn(
            { sourceGroup, targetFolder },
            'Unauthorized schedule_task attempt blocked',
          );
          break;
        }

        const scheduleType = data.schedule_type as 'cron' | 'interval' | 'once';

        let nextRun: string | null = null;
        if (scheduleType === 'cron') {
          try {
            const interval = CronExpressionParser.parse(data.schedule_value, {
              tz: TIMEZONE,
            });
            nextRun = interval.next().toISOString();
          } catch {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid cron expression',
            );
            break;
          }
        } else if (scheduleType === 'interval') {
          const ms = parseInt(data.schedule_value, 10);
          if (isNaN(ms) || ms <= 0) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid interval',
            );
            break;
          }
          nextRun = new Date(Date.now() + ms).toISOString();
        } else if (scheduleType === 'once') {
          const scheduled = new Date(data.schedule_value);
          if (isNaN(scheduled.getTime())) {
            logger.warn(
              { scheduleValue: data.schedule_value },
              'Invalid timestamp',
            );
            break;
          }
          nextRun = scheduled.toISOString();
        }

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const contextMode =
          data.context_mode === 'group' || data.context_mode === 'isolated'
            ? data.context_mode
            : 'isolated';
        createTask({
          id: taskId,
          group_folder: targetFolder,
          chat_jid: targetJid,
          prompt: data.prompt,
          schedule_type: scheduleType,
          schedule_value: data.schedule_value,
          context_mode: contextMode,
          next_run: nextRun,
          status: 'active',
          created_at: new Date().toISOString(),
        });
        logger.info(
          { taskId, sourceGroup, targetFolder, contextMode },
          'Task created via IPC',
        );
      }
      break;

    case 'update_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (!task) {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Task not found for update');
          sendIpcErrorToContainer(sourceGroup, `Task "${data.taskId}" was not found.`);
          break;
        }
        if (!isMain && task.group_folder !== sourceGroup) {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Unauthorized task update attempt');
          sendIpcErrorToContainer(sourceGroup, `You are not authorized to update task "${data.taskId}".`);
          break;
        }
        const updates: Parameters<typeof updateTask>[1] = {};
        if (data.prompt !== undefined) updates.prompt = data.prompt;
        if (data.schedule_type !== undefined) {
          updates.schedule_type = data.schedule_type as ScheduledTask['schedule_type'];
        }
        if (data.schedule_value !== undefined) updates.schedule_value = data.schedule_value;
        updateTask(data.taskId, updates);
        logger.info({ taskId: data.taskId, updates, sourceGroup }, 'Task updated via IPC');
      }
      break;

    case 'pause_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'paused' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task paused via IPC',
          );
        } else if (!task) {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Task not found for pause');
          sendIpcErrorToContainer(sourceGroup, `Task "${data.taskId}" was not found.`);
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task pause attempt',
          );
          sendIpcErrorToContainer(sourceGroup, `You are not authorized to pause task "${data.taskId}".`);
        }
      }
      break;

    case 'resume_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          updateTask(data.taskId, { status: 'active' });
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task resumed via IPC',
          );
        } else if (!task) {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Task not found for resume');
          sendIpcErrorToContainer(sourceGroup, `Task "${data.taskId}" was not found.`);
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task resume attempt',
          );
          sendIpcErrorToContainer(sourceGroup, `You are not authorized to resume task "${data.taskId}".`);
        }
      }
      break;

    case 'cancel_task':
      if (data.taskId) {
        const task = getTaskById(data.taskId);
        if (task && (isMain || task.group_folder === sourceGroup)) {
          deleteTask(data.taskId);
          logger.info(
            { taskId: data.taskId, sourceGroup },
            'Task cancelled via IPC',
          );
        } else if (!task) {
          logger.warn({ taskId: data.taskId, sourceGroup }, 'Task not found for cancel');
          sendIpcErrorToContainer(sourceGroup, `Task "${data.taskId}" was not found.`);
        } else {
          logger.warn(
            { taskId: data.taskId, sourceGroup },
            'Unauthorized task cancel attempt',
          );
          sendIpcErrorToContainer(sourceGroup, `You are not authorized to cancel task "${data.taskId}".`);
        }
      }
      break;

    case 'refresh_groups':
      if (isMain) {
        logger.info(
          { sourceGroup },
          'Group metadata refresh requested via IPC',
        );
        await deps.syncGroupMetadata(true);
        const availableGroups = deps.getAvailableGroups();
        deps.writeGroupsSnapshot(
          sourceGroup,
          true,
          availableGroups,
          new Set(Object.keys(registeredGroups)),
        );
      } else {
        logger.warn(
          { sourceGroup },
          'Unauthorized refresh_groups attempt blocked',
        );
        sendIpcErrorToContainer(sourceGroup, 'Only the main group can request a groups refresh.');
      }
      break;

    case 'register_group':
      if (!isMain) {
        logger.warn(
          { sourceGroup },
          'Unauthorized register_group attempt blocked',
        );
        sendIpcErrorToContainer(sourceGroup, 'Only the main group can register new groups.');
        break;
      }
      if (data.jid && data.name && data.folder && data.trigger) {
        if (!isValidGroupFolder(data.folder)) {
          logger.warn(
            { sourceGroup, folder: data.folder },
            'Invalid register_group request - unsafe folder name',
          );
          break;
        }
        deps.registerGroup(data.jid, {
          name: data.name,
          folder: data.folder,
          trigger: data.trigger,
          added_at: new Date().toISOString(),
          containerConfig: data.containerConfig,
          requiresTrigger: data.requiresTrigger,
        });
      } else {
        logger.warn(
          { data },
          'Invalid register_group request - missing required fields',
        );
      }
      break;

    case 'delegate_task': {
      if (!data.prompt || !data.targetJid) {
        logger.warn({ sourceGroup }, 'Invalid delegate_task: missing prompt or targetJid');
        sendIpcErrorToContainer(sourceGroup, 'delegate_task requires prompt and targetJid.');
        break;
      }

      const targetJid = data.targetJid as string;
      const targetGroup = registeredGroups[targetJid];

      if (!targetGroup) {
        logger.warn({ targetJid, sourceGroup }, 'Cannot delegate task: target group not registered');
        sendIpcErrorToContainer(sourceGroup, `Target group "${targetJid}" is not registered.`);
        break;
      }

      const targetFolder = targetGroup.folder;

      if (!isMain && targetFolder !== sourceGroup) {
        logger.warn(
          { sourceGroup, targetFolder },
          'Unauthorized delegate_task attempt blocked',
        );
        sendIpcErrorToContainer(sourceGroup, `You are not authorized to delegate tasks to group "${targetJid}".`);
        break;
      }

      const contextMode =
        data.context_mode === 'group' || data.context_mode === 'isolated'
          ? data.context_mode
          : 'group';

      const taskName = data.taskName || 'Delegated task';

      if (deps.delegateTask) {
        deps.delegateTask(
          targetJid,
          data.prompt as string,
          contextMode,
          data.model || null,
          taskName,
          sourceGroup,
        );

        logger.info(
          { sourceGroup, targetFolder, taskName, contextMode },
          'Task delegated via IPC (immediate execution)',
        );
      } else {
        logger.warn({ sourceGroup }, 'delegate_task called but no delegateTask handler registered');
      }
      break;
    }

    default:
      logger.warn({ type: data.type }, 'Unknown IPC task type');
  }
}
