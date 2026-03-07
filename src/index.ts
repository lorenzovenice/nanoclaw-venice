import fs from 'fs';
import path from 'path';

import {
  ASSISTANT_NAME,
  IDLE_TIMEOUT,
  MAIN_GROUP_FOLDER,
  MAX_MESSAGE_AGE,
  POLL_INTERVAL,
  SESSION_IDLE_TTL_MS,
  TELEGRAM_BOT_TOKEN,
  TELEGRAM_ONLY,
  TRIGGER_PATTERN,
} from './config.js';
import { WhatsAppChannel } from './channels/whatsapp.js';
import { TelegramChannel } from './channels/telegram.js';
import {
  ContainerOutput,
  runContainerAgent,
  writeGroupsSnapshot,
  writeTasksSnapshot,
} from './container-runner.js';
import { shouldUseFastPath, runFastPath } from './fast-path.js';
import { cleanupOrphans, cleanupStaleIpcFiles, ensureContainerRuntimeRunning } from './container-runtime.js';
import {
  deleteSession,
  getAllChats,
  getAllRegisteredGroups,
  getAllSessions,
  getAllTasks,
  getMessagesSince,
  getNewMessages,
  getRouterState,
  getSessionMeta,
  initDatabase,
  setRegisteredGroup,
  setRouterState,
  setSession,
  storeChatMetadata,
  storeMessage,
} from './db.js';
import { GroupQueue } from './group-queue.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { flushGroupIpcMessages, startIpcWatcher } from './ipc.js';
import { findChannel, formatMessages, formatOutbound } from './router.js';
import { startSchedulerLoop } from './task-scheduler.js';
import { Channel, NewMessage, RegisteredGroup } from './types.js';
import { logger } from './logger.js';

// Re-export for backwards compatibility during refactor
export { escapeXml, formatMessages } from './router.js';

let lastTimestamp = '';
let sessions: Record<string, string> = {};
let registeredGroups: Record<string, RegisteredGroup> = {};
let lastAgentTimestamp: Record<string, string> = {};
let messageLoopRunning = false;

let whatsapp: WhatsAppChannel | undefined;
const channels: Channel[] = [];
const queue = new GroupQueue();

function loadState(): void {
  lastTimestamp = getRouterState('last_timestamp') || '';
  const agentTs = getRouterState('last_agent_timestamp');
  try {
    lastAgentTimestamp = agentTs ? JSON.parse(agentTs) : {};
  } catch {
    logger.warn('Corrupted last_agent_timestamp in DB, resetting');
    lastAgentTimestamp = {};
  }
  sessions = getAllSessions();
  registeredGroups = getAllRegisteredGroups();
  logger.info(
    { groupCount: Object.keys(registeredGroups).length },
    'State loaded',
  );
}

function saveState(): void {
  setRouterState('last_timestamp', lastTimestamp);
  setRouterState(
    'last_agent_timestamp',
    JSON.stringify(lastAgentTimestamp),
  );
}

function registerGroup(jid: string, group: RegisteredGroup): void {
  let groupDir: string;
  try {
    groupDir = resolveGroupFolderPath(group.folder);
  } catch (err) {
    logger.warn(
      { jid, folder: group.folder, err },
      'Rejecting group registration with invalid folder',
    );
    return;
  }

  registeredGroups[jid] = group;
  setRegisteredGroup(jid, group);

  // Create group folder
  fs.mkdirSync(path.join(groupDir, 'logs'), { recursive: true });

  logger.info(
    { jid, name: group.name, folder: group.folder },
    'Group registered',
  );
}

/**
 * Get available groups list for the agent.
 * Returns groups ordered by most recent activity.
 */
export function getAvailableGroups(): import('./container-runner.js').AvailableGroup[] {
  const chats = getAllChats();
  const registeredJids = new Set(Object.keys(registeredGroups));

  return chats
    .filter((c) => c.jid !== '__group_sync__' && c.is_group)
    .map((c) => ({
      jid: c.jid,
      name: c.name,
      lastActivity: c.last_message_time,
      isRegistered: registeredJids.has(c.jid),
    }));
}

/** @internal - exported for testing */
export function _setRegisteredGroups(groups: Record<string, RegisteredGroup>): void {
  registeredGroups = groups;
}

/**
 * Filter out messages older than MAX_MESSAGE_AGE.
 * Advances the cursor past stale messages so they're never retried.
 */
function filterStaleMessages(
  allMessages: NewMessage[],
  chatJid: string,
  groupName: string,
): NewMessage[] {
  const cutoff = new Date(Date.now() - MAX_MESSAGE_AGE).toISOString();
  const staleCount = allMessages.filter((m) => m.timestamp < cutoff).length;
  const fresh = allMessages.filter((m) => m.timestamp >= cutoff);

  if (staleCount > 0) {
    logger.warn(
      { group: groupName, staleCount, cutoff },
      'Dropped stale messages (older than MAX_MESSAGE_AGE)',
    );
    if (fresh.length === 0 && allMessages.length > 0) {
      lastAgentTimestamp[chatJid] = allMessages[allMessages.length - 1].timestamp;
      saveState();
    }
  }

  return fresh;
}

/**
 * Process all pending messages for a group.
 * Called by the GroupQueue when it's this group's turn.
 */
async function processGroupMessages(chatJid: string): Promise<boolean> {
  const group = registeredGroups[chatJid];
  if (!group) return true;

  const channel = findChannel(channels, chatJid);
  if (!channel) {
    console.log(`Warning: no channel owns JID ${chatJid}, skipping messages`);
    return true;
  }

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;

  const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
  const allMissed = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
  const missedMessages = filterStaleMessages(allMissed, chatJid, group.name);

  if (missedMessages.length === 0) return true;

  // For non-main groups, check if trigger is required and present
  if (!isMainGroup && group.requiresTrigger !== false) {
    const hasTrigger = missedMessages.some((m) =>
      TRIGGER_PATTERN.test(m.content.trim()),
    );
    if (!hasTrigger) return true;
  }

  // Fast path: simple conversational messages go directly to Venice API
  // without spawning a container or going through the Claude Agent SDK.
  if (shouldUseFastPath(missedMessages, isMainGroup)) {
    logger.info({ group: group.name, messageCount: missedMessages.length }, 'Fast path');

    lastAgentTimestamp[chatJid] = missedMessages[missedMessages.length - 1].timestamp;
    saveState();

    await channel.setTyping?.(chatJid, true);
    const response = await runFastPath(chatJid, group.folder, ASSISTANT_NAME, missedMessages);
    await channel.setTyping?.(chatJid, false);

    if (response) {
      await channel.sendMessage(chatJid, response);
      return true;
    }
    // Fast path returned null (API error) — fall through to container path
    logger.info({ group: group.name }, 'Fast path failed, falling back to container');
  }

  const prompt = formatMessages(missedMessages);

  // Advance cursor so the piping path in startMessageLoop won't re-fetch
  // these messages. Save the old cursor so we can roll back on error.
  const previousCursor = lastAgentTimestamp[chatJid] || '';
  lastAgentTimestamp[chatJid] =
    missedMessages[missedMessages.length - 1].timestamp;
  saveState();

  logger.info(
    { group: group.name, messageCount: missedMessages.length },
    'Processing messages (container path)',
  );

  // Track idle timer for closing stdin when agent is idle
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const resetIdleTimer = () => {
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      logger.debug({ group: group.name }, 'Idle timeout, closing container stdin');
      queue.closeStdin(chatJid);
    }, IDLE_TIMEOUT);
  };

  // Expire idle sessions: if the last activity was more than SESSION_IDLE_TTL_MS ago,
  // clear the session so the agent starts fresh instead of resuming stale context.
  const sessionMeta = getSessionMeta(group.folder);
  if (sessionMeta?.lastUsed) {
    const idleMs = Date.now() - new Date(sessionMeta.lastUsed).getTime();
    if (idleMs > SESSION_IDLE_TTL_MS) {
      logger.info(
        { group: group.name, idleMin: Math.round(idleMs / 60000), ttlMin: Math.round(SESSION_IDLE_TTL_MS / 60000) },
        'Session idle too long, clearing for fresh start',
      );
      delete sessions[group.folder];
      deleteSession(group.folder);
    }
  }

  await channel.setTyping?.(chatJid, true);
  // Telegram's typing indicator expires after ~5s, so resend it periodically
  const typingInterval = setInterval(() => {
    channel.setTyping?.(chatJid, true)?.catch(() => {});
  }, 4000);
  let hadError = false;
  let outputSentToUser = false;

  // Wire up streaming drafts for channels that support it (e.g. Telegram)
  const onStreamDelta = channel.sendStreamDelta
    ? (text: string) => {
        channel.sendStreamDelta!(chatJid, text).catch((err) =>
          logger.debug({ chatJid, err }, 'Stream delta error'),
        );
      }
    : undefined;

  const output = await runAgent(group, prompt, chatJid, async (result) => {
    // Streaming output callback — called for each agent result
    queue.notifyActivity(chatJid);
    if (result.result) {
      const raw = typeof result.result === 'string' ? result.result : JSON.stringify(result.result);
      // Strip <internal>...</internal> blocks — agent uses these for internal reasoning
      const text = raw.replace(/<internal>[\s\S]*?<\/internal>/g, '').trim();
      logger.info({ group: group.name }, `Agent output: ${raw.slice(0, 200)}`);
      if (text) {
        await channel.sendMessage(chatJid, text);
        outputSentToUser = true;
      }
      // Only reset idle timer on actual results, not session-update markers (result: null)
      resetIdleTimer();
    }

    if (result.status === 'success') {
      queue.notifyIdle(chatJid);
    }

    if (result.status === 'error') {
      hadError = true;
    }
  }, onStreamDelta);

  clearInterval(typingInterval);
  await channel.setTyping?.(chatJid, false);
  if (idleTimer) clearTimeout(idleTimer);

  if (output === 'error' || hadError) {
    // If we already sent output to the user, don't roll back the cursor —
    // the user got their response and re-processing would send duplicates.
    if (outputSentToUser) {
      logger.warn({ group: group.name }, 'Agent error after output was sent, skipping cursor rollback to prevent duplicates');
      return true;
    }
    // Roll back cursor so retries can re-process these messages
    lastAgentTimestamp[chatJid] = previousCursor;
    saveState();
    logger.warn({ group: group.name }, 'Agent error, rolled back message cursor for retry');
    return false;
  }

  return true;
}

async function runAgent(
  group: RegisteredGroup,
  prompt: string,
  chatJid: string,
  onOutput?: (output: ContainerOutput) => Promise<void>,
  onStreamDelta?: (text: string) => void,
): Promise<'success' | 'error'> {
  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const sessionId = sessions[group.folder];

  // Update tasks snapshot for container to read (filtered by group)
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMain,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  // Update available groups snapshot (main group only can see all groups)
  const availableGroups = getAvailableGroups();
  writeGroupsSnapshot(
    group.folder,
    isMain,
    availableGroups,
    new Set(Object.keys(registeredGroups)),
  );

  // Wrap onOutput to track session ID from streamed results
  const wrappedOnOutput = onOutput
    ? async (output: ContainerOutput) => {
        if (output.newSessionId) {
          sessions[group.folder] = output.newSessionId;
          setSession(group.folder, output.newSessionId);
        }
        await onOutput(output);
      }
    : undefined;

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        assistantName: ASSISTANT_NAME,
      },
      (proc, containerName) => queue.registerProcess(chatJid, proc, containerName, group.folder),
      wrappedOnOutput,
      onStreamDelta,
    );

    if (output.newSessionId) {
      sessions[group.folder] = output.newSessionId;
      setSession(group.folder, output.newSessionId);
    }

    if (output.status === 'error') {
      logger.error(
        { group: group.name, error: output.error },
        'Container agent error',
      );
      return 'error';
    }

    return 'success';
  } catch (err) {
    logger.error({ group: group.name, err }, 'Agent error');
    return 'error';
  }
}

// Registry for subagent IPC activity callbacks.
// When the IPC watcher processes a message from a group with an active subagent,
// it calls the registered callback to reset the stale timer.
const subagentIpcCallbacks = new Map<string, () => void>();

function registerSubagentIpcCallback(groupFolder: string, cb: () => void): void {
  subagentIpcCallbacks.set(groupFolder, cb);
}

function unregisterSubagentIpcCallback(groupFolder: string): void {
  subagentIpcCallbacks.delete(groupFolder);
}

export function notifySubagentIpcActivity(groupFolder: string): void {
  const cb = subagentIpcCallbacks.get(groupFolder);
  if (cb) cb();
}

/**
 * Run a delegated subagent task in an independent container.
 * The subagent runs immediately in the background, non-blocking.
 */
async function runDelegatedTask(
  chatJid: string,
  prompt: string,
  contextMode: 'group' | 'isolated',
  model: string | null,
  taskName: string,
): Promise<void> {
  const group = registeredGroups[chatJid];
  if (!group) {
    logger.error({ chatJid }, 'Group not found for delegated task');
    return;
  }

  const isMain = group.folder === MAIN_GROUP_FOLDER;
  const modelLabel = model || 'Sonnet';
  const wrappedPrompt = `[DELEGATED TASK: "${taskName}"]

You are a subagent running in an independent container. Your parent agent delegated this task to you.

IMPORTANT RULES:
• Your text output is NOT automatically sent to the user. You MUST use mcp__nanoclaw__send_message to deliver your final result.
• EVERY message you send MUST start with 🤖. Format: "🤖 ${modelLabel} | ${taskName} | [status]"

PROGRESS UPDATES — send exactly these:
1. When you START: send_message "🤖 ${modelLabel} | ${taskName} | Starting"
2. When you START a major step: send_message "🤖 ${modelLabel} | ${taskName} | [what you're starting]"
3. When you FINISH a major step: send_message "🤖 ${modelLabel} | ${taskName} | ✓ [what you finished]"
4. When DONE with everything: send_message "🤖 ${modelLabel} | ${taskName} | ✅ Complete"

TASK:
${prompt}`;

  // Subagents always start fresh — resuming the main session causes context confusion
  const sessionId = undefined;

  const taskQueueJid = `__task__${chatJid}`;
  const TASK_CLOSE_DELAY_MS = 10000;
  let closeTimer: ReturnType<typeof setTimeout> | null = null;
  let staleTimer: ReturnType<typeof setTimeout> | null = null;

  const scheduleClose = () => {
    if (closeTimer) return;
    closeTimer = setTimeout(() => {
      logger.debug({ taskName }, 'Closing delegated task container after result');
      queue.closeStdin(taskQueueJid);
    }, TASK_CLOSE_DELAY_MS);
  };

  const resetStaleTimer = () => {
    if (staleTimer) clearTimeout(staleTimer);
    const STALE_SUBAGENT_MS = 600000; // 10 min
    staleTimer = setTimeout(() => {
      const idleMin = Math.round(STALE_SUBAGENT_MS / 60000);
      logger.warn({ taskName, taskQueueJid, idleMin }, 'Killing stale subagent');
      queue.closeStdin(taskQueueJid);
      const ch = findChannel(channels, chatJid);
      ch?.sendMessage(chatJid, `Killed stale subagent "${taskName}" — it was idle for ${idleMin} minutes.`).catch(() => {});
    }, STALE_SUBAGENT_MS);
  };
  resetStaleTimer();

  registerSubagentIpcCallback(group.folder, resetStaleTimer);

  const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
  const tasks = getAllTasks();
  writeTasksSnapshot(
    group.folder,
    isMainGroup,
    tasks.map((t) => ({
      id: t.id,
      groupFolder: t.group_folder,
      prompt: t.prompt,
      schedule_type: t.schedule_type,
      schedule_value: t.schedule_value,
      status: t.status,
      next_run: t.next_run,
    })),
  );

  const startTime = Date.now();

  try {
    const output = await runContainerAgent(
      group,
      {
        prompt: wrappedPrompt,
        sessionId,
        groupFolder: group.folder,
        chatJid,
        isMain,
        isScheduledTask: true,
        assistantName: ASSISTANT_NAME,
        modelOverride: model || undefined,
      },
      (proc, containerName) => queue.registerProcess(taskQueueJid, proc, containerName, group.folder),
      async (streamedOutput: ContainerOutput) => {
        queue.notifyActivity(taskQueueJid);
        if (streamedOutput.result) {
          scheduleClose();
        }
        if (streamedOutput.status === 'success') {
          queue.notifyIdle(taskQueueJid);
        }
        resetStaleTimer();
      },
    );

    if (closeTimer) clearTimeout(closeTimer);
    if (staleTimer) clearTimeout(staleTimer);
    unregisterSubagentIpcCallback(group.folder);

    // Flush any IPC messages the subagent wrote in its final moments.
    await flushGroupIpcMessages(group.folder);

    // Safety net: relay non-internal result text to chat.
    if (output.result) {
      const raw = typeof output.result === 'string' ? output.result : JSON.stringify(output.result);
      const text = raw
        .replace(/<internal>[\s\S]*?<\/internal>/g, '')
        .trim();
      if (text) {
        const ch = findChannel(channels, chatJid);
        if (ch) {
          await ch.sendMessage(chatJid, text).catch((err) => {
            logger.error({ taskName, err }, 'Failed to relay subagent result');
          });
        }
      }
    }

    logger.info(
      { taskName, durationMs: Date.now() - startTime, status: output.status },
      'Delegated task completed',
    );
  } catch (err) {
    if (closeTimer) clearTimeout(closeTimer);
    if (staleTimer) clearTimeout(staleTimer);
    unregisterSubagentIpcCallback(group.folder);
    logger.error({ taskName, error: err }, 'Delegated task failed');
  }
}

async function startMessageLoop(): Promise<void> {
  if (messageLoopRunning) {
    logger.debug('Message loop already running, skipping duplicate start');
    return;
  }
  messageLoopRunning = true;

  logger.info(`NanoClaw running (trigger: @${ASSISTANT_NAME})`);

  while (true) {
    try {
      const jids = Object.keys(registeredGroups);
      const { messages, newTimestamp } = getNewMessages(jids, lastTimestamp, ASSISTANT_NAME);

      if (messages.length > 0) {
        logger.info({ count: messages.length }, 'New messages');

        // Advance the "seen" cursor for all messages immediately
        lastTimestamp = newTimestamp;
        saveState();

        // Deduplicate by group
        const messagesByGroup = new Map<string, NewMessage[]>();
        for (const msg of messages) {
          const existing = messagesByGroup.get(msg.chat_jid);
          if (existing) {
            existing.push(msg);
          } else {
            messagesByGroup.set(msg.chat_jid, [msg]);
          }
        }

        for (const [chatJid, groupMessages] of messagesByGroup) {
          const group = registeredGroups[chatJid];
          if (!group) continue;

          const channel = findChannel(channels, chatJid);
          if (!channel) {
            console.log(`Warning: no channel owns JID ${chatJid}, skipping messages`);
            continue;
          }

          const isMainGroup = group.folder === MAIN_GROUP_FOLDER;
          const needsTrigger = !isMainGroup && group.requiresTrigger !== false;

          // For non-main groups, only act on trigger messages.
          // Non-trigger messages accumulate in DB and get pulled as
          // context when a trigger eventually arrives.
          if (needsTrigger) {
            const hasTrigger = groupMessages.some((m) =>
              TRIGGER_PATTERN.test(m.content.trim()),
            );
            if (!hasTrigger) continue;
          }

          // Pull all messages since lastAgentTimestamp so non-trigger
          // context that accumulated between triggers is included.
          const allPending = getMessagesSince(
            chatJid,
            lastAgentTimestamp[chatJid] || '',
            ASSISTANT_NAME,
          );
          const messagesToSend =
            allPending.length > 0 ? allPending : groupMessages;
          const formatted = formatMessages(messagesToSend);

          if (queue.sendMessage(chatJid, formatted)) {
            logger.debug(
              { chatJid, count: messagesToSend.length },
              'Piped messages to active container',
            );
            lastAgentTimestamp[chatJid] =
              messagesToSend[messagesToSend.length - 1].timestamp;
            saveState();
            // Show typing indicator while the container processes the piped message
            channel.setTyping?.(chatJid, true)?.catch((err) =>
              logger.warn({ chatJid, err }, 'Failed to set typing indicator'),
            );
          } else {
            // No active container — enqueue for a new one
            queue.enqueueMessageCheck(chatJid);
          }
        }
      }
    } catch (err) {
      logger.error({ err }, 'Error in message loop');
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL));
  }
}

/**
 * Startup recovery: check for unprocessed messages in registered groups.
 * Handles crash between advancing lastTimestamp and processing messages.
 */
function recoverPendingMessages(): void {
  for (const [chatJid, group] of Object.entries(registeredGroups)) {
    const sinceTimestamp = lastAgentTimestamp[chatJid] || '';
    const pending = getMessagesSince(chatJid, sinceTimestamp, ASSISTANT_NAME);
    if (pending.length > 0) {
      logger.info(
        { group: group.name, pendingCount: pending.length },
        'Recovery: found unprocessed messages',
      );
      queue.enqueueMessageCheck(chatJid);
    }
  }
}

function ensureContainerSystemRunning(): void {
  ensureContainerRuntimeRunning();
  cleanupOrphans();
  cleanupStaleIpcFiles();
}

async function main(): Promise<void> {
  ensureContainerSystemRunning();
  initDatabase();
  logger.info('Database initialized');
  loadState();

  // Graceful shutdown handlers
  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'Shutdown signal received');
    await queue.shutdown(10000);
    for (const ch of channels) await ch.disconnect();
    process.exit(0);
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Channel callbacks (shared by all channels)
  const channelOpts = {
    onMessage: (_chatJid: string, msg: NewMessage) => storeMessage(msg),
    onChatMetadata: (chatJid: string, timestamp: string, name?: string, channel?: string, isGroup?: boolean) =>
      storeChatMetadata(chatJid, timestamp, name, channel, isGroup),
    registeredGroups: () => registeredGroups,
  };

  // Create and connect channels
  if (!TELEGRAM_ONLY) {
    whatsapp = new WhatsAppChannel(channelOpts);
    channels.push(whatsapp);
    await whatsapp.connect();
  }

  if (TELEGRAM_BOT_TOKEN) {
    const telegram = new TelegramChannel(TELEGRAM_BOT_TOKEN, channelOpts);
    channels.push(telegram);
    await telegram.connect();
  }

  // Start subsystems (independently of connection handler)
  startSchedulerLoop({
    registeredGroups: () => registeredGroups,
    getSessions: () => sessions,
    queue,
    onProcess: (groupJid, proc, containerName, groupFolder) => queue.registerProcess(groupJid, proc, containerName, groupFolder),
    sendMessage: async (jid, rawText) => {
      const channel = findChannel(channels, jid);
      if (!channel) {
        console.log(`Warning: no channel owns JID ${jid}, cannot send message`);
        return;
      }
      const text = formatOutbound(rawText);
      if (text) await channel.sendMessage(jid, text);
    },
  });
  startIpcWatcher({
    sendMessage: (jid, text) => {
      const channel = findChannel(channels, jid);
      if (!channel) throw new Error(`No channel for JID: ${jid}`);
      return channel.sendMessage(jid, text);
    },
    registeredGroups: () => registeredGroups,
    registerGroup,
    syncGroupMetadata: (force) => whatsapp?.syncGroupMetadata(force) ?? Promise.resolve(),
    getAvailableGroups,
    writeGroupsSnapshot: (gf, im, ag, rj) => writeGroupsSnapshot(gf, im, ag, rj),
    delegateTask: (targetJid, prompt, contextMode, model, taskName, _sourceGroup) => {
      runDelegatedTask(targetJid, prompt, contextMode, model, taskName).catch((err) =>
        logger.error({ targetJid, taskName, err }, 'Delegated task failed'),
      );
    },
    onIpcActivity: (sourceGroup) => notifySubagentIpcActivity(sourceGroup),
  });
  queue.setProcessMessagesFn(processGroupMessages);
  queue.setOnUnreadIpcFn((groupJid) => {
    // Roll back the cursor so processGroupMessages re-fetches messages
    // that were queued but never read by the exiting container
    delete lastAgentTimestamp[groupJid];
    saveState();
    logger.info({ groupJid }, 'Rolled back cursor due to unread IPC messages');
  });
  recoverPendingMessages();
  startMessageLoop().catch((err) => {
    logger.fatal({ err }, 'Message loop crashed unexpectedly');
    process.exit(1);
  });
}

// Guard: only run when executed directly, not when imported by tests
const isDirectRun =
  process.argv[1] &&
  new URL(import.meta.url).pathname === new URL(`file://${process.argv[1]}`).pathname;

if (isDirectRun) {
  main().catch((err) => {
    logger.error({ err }, 'Failed to start NanoClaw');
    process.exit(1);
  });
}
