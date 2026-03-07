/**
 * Fast Path — Direct Venice API call for simple conversational messages.
 *
 * Bypasses: container spawn, Claude Agent SDK, proxy translation.
 * Talks directly to Venice in OpenAI format from the host process.
 *
 * Use for: greetings, questions, short conversations, anything that
 * doesn't need tools (file I/O, bash, web browsing, task scheduling).
 *
 * The full container path remains for agentic tasks.
 */
import fs from 'fs';
import path from 'path';
import OpenAI from 'openai';

import { readEnvFile } from './env.js';
import { logger } from './logger.js';
import { GROUPS_DIR } from './config.js';
import { resolveGroupFolderPath } from './group-folder.js';
import { getMessagesSince } from './db.js';
import { NewMessage } from './types.js';

let client: OpenAI | null = null;

function getClient(): OpenAI | null {
  if (client) return client;
  const env = readEnvFile(['VENICE_API_KEY']);
  const apiKey = env.VENICE_API_KEY || process.env.VENICE_API_KEY;
  if (!apiKey) return null;

  client = new OpenAI({
    apiKey,
    baseURL: 'https://api.venice.ai/api/v1',
  });
  return client;
}

function getGroupSystemPrompt(groupFolder: string): string {
  const claudeMdPath = path.join(resolveGroupFolderPath(groupFolder), 'CLAUDE.md');
  try {
    if (fs.existsSync(claudeMdPath)) {
      return fs.readFileSync(claudeMdPath, 'utf-8');
    }
  } catch { /* use default */ }

  const globalPath = path.join(GROUPS_DIR, 'global', 'CLAUDE.md');
  try {
    if (fs.existsSync(globalPath)) {
      return fs.readFileSync(globalPath, 'utf-8');
    }
  } catch { /* use default */ }

  return 'You are a helpful assistant.';
}

function getModel(groupFolder: string): string {
  const modelFile = path.join(resolveGroupFolderPath(groupFolder), '.venice-model');
  try {
    if (fs.existsSync(modelFile)) {
      const m = fs.readFileSync(modelFile, 'utf-8').trim();
      if (m) return m;
    }
  } catch { /* use default */ }
  return 'claude-sonnet-4-6';
}

function buildConversationContext(
  chatJid: string,
  assistantName: string,
  recentMessages: NewMessage[],
): OpenAI.ChatCompletionMessageParam[] {
  const messages: OpenAI.ChatCompletionMessageParam[] = [];

  for (const msg of recentMessages) {
    if (msg.is_bot_message || msg.sender_name === assistantName) {
      messages.push({ role: 'assistant', content: msg.content });
    } else {
      messages.push({ role: 'user', content: `${msg.sender_name}: ${msg.content}` });
    }
  }

  return messages;
}

/**
 * Determine if a message should use the fast path (direct API call)
 * or the full container path (Claude Agent SDK with tools).
 */
export function shouldUseFastPath(
  messages: NewMessage[],
  isMainGroup: boolean,
): boolean {
  const lastMessage = messages[messages.length - 1];
  if (!lastMessage) return false;

  const content = lastMessage.content.toLowerCase().trim();

  // Main group often needs tools (group management, file access, DB queries)
  // Only fast-path very simple messages in main
  if (isMainGroup) {
    const mainFastPatterns = [
      /^(hi|hello|hey|sup|yo|morning|evening|night|thanks|thank you|ok|okay|cool|nice|great|awesome|lol|haha)\b/,
      /^(how are you|what's up|whats up|how's it going)\b/,
    ];
    return mainFastPatterns.some(p => p.test(content));
  }

  // For non-main groups, fast-path everything UNLESS it looks like it needs tools
  const needsToolsPatterns = [
    /\b(search|browse|fetch|download|look up|google)\b/,
    /\b(create|write|save|edit|read|delete|open)\s+(a\s+)?(file|document|note)/,
    /\b(run|execute|install|build|deploy|compile)\b/,
    /\b(schedule|remind|timer|alarm|every\s+(day|week|hour|morning|monday))\b/,
    /\b(join|register|add)\s+(the\s+)?(group|chat|channel)/,
    /\b(list|show|check)\s+(tasks|groups|scheduled)/,
    /\b(switch|change|use)\s+(model|to\s+(opus|sonnet|glm|gpt))/,
  ];

  if (needsToolsPatterns.some(p => p.test(content))) {
    return false;
  }

  return true;
}

/**
 * Run a fast-path response — direct Venice API call, no container.
 * Returns the response text, or null if the fast path fails (caller should fall back).
 */
export async function runFastPath(
  chatJid: string,
  groupFolder: string,
  assistantName: string,
  recentMessages: NewMessage[],
): Promise<string | null> {
  const api = getClient();
  if (!api) {
    logger.warn('Fast path: no Venice API key available, falling back to container');
    return null;
  }

  const model = getModel(groupFolder);
  const systemPrompt = getGroupSystemPrompt(groupFolder);
  const conversationMessages = buildConversationContext(chatJid, assistantName, recentMessages);

  const startTime = Date.now();

  try {
    const response = await api.chat.completions.create({
      model,
      messages: [
        { role: 'system', content: systemPrompt },
        ...conversationMessages,
      ],
      max_tokens: 2048,
    });

    const elapsed = Date.now() - startTime;
    const text = response.choices[0]?.message?.content || '';
    const usage = response.usage;

    logger.info(
      { model, elapsed, inputTokens: usage?.prompt_tokens, outputTokens: usage?.completion_tokens },
      'Fast path response',
    );

    return text || null;
  } catch (err) {
    const elapsed = Date.now() - startTime;
    logger.error({ err, model, elapsed }, 'Fast path API error, falling back to container');
    return null;
  }
}
