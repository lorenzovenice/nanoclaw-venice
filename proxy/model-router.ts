/**
 * Multi-Model Router for Venice Proxy
 *
 * Classifies incoming Anthropic API requests and routes them to the optimal
 * Venice model based on task dimensions: complexity, context size, tool usage,
 * and per-group overrides.
 *
 * Session-sticky routing ensures a model doesn't change mid-tool-use-loop.
 */
import fs from 'fs';
import path from 'path';

export interface AnthropicRequest {
  model: string;
  max_tokens: number;
  messages: AnthropicMessage[];
  system?: string | Array<{ type: string; text: string }>;
  tools?: AnthropicTool[];
  tool_choice?: unknown;
  stream?: boolean;
  temperature?: number;
  top_p?: number;
  stop_sequences?: string[];
  metadata?: unknown;
  thinking?: unknown;
}

interface AnthropicMessage {
  role: string;
  content: string | AnthropicContentBlock[];
}

interface AnthropicContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: string | AnthropicContentBlock[];
  source?: unknown;
}

interface AnthropicTool {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
}

// --- Routing Configuration ---

export interface RoutingConfig {
  defaultModel: string;
  fastModel: string;
  powerModel: string;
  rules: RoutingRule[];
}

interface RoutingRule {
  name: string;
  condition: (req: AnthropicRequest, ctx: RequestContext) => boolean;
  model: string;
  priority: number;
}

interface RequestContext {
  estimatedTokens: number;
  messageCount: number;
  hasTools: boolean;
  hasToolResults: boolean;
  isToolResultOnly: boolean;
  hasThinking: boolean;
  lastUserMessageLength: number;
  systemPromptLength: number;
}

const DEFAULT_CONFIG: RoutingConfig = {
  defaultModel: 'claude-sonnet-4-6',
  fastModel: 'claude-sonnet-4-6',
  powerModel: 'claude-opus-4-6',
  rules: [],
};

let activeConfig: RoutingConfig = { ...DEFAULT_CONFIG, rules: buildDefaultRules(DEFAULT_CONFIG) };

function buildDefaultRules(config: RoutingConfig): RoutingRule[] {
  return [
    {
      name: 'tool-result-ack',
      condition: (_req, ctx) => ctx.isToolResultOnly && ctx.estimatedTokens < 4000,
      model: config.fastModel,
      priority: 100,
    },
    {
      name: 'short-conversation',
      condition: (_req, ctx) => ctx.messageCount <= 4 && ctx.estimatedTokens < 2000 && !ctx.hasTools,
      model: config.fastModel,
      priority: 80,
    },
    {
      name: 'complex-reasoning',
      condition: (_req, ctx) => ctx.hasThinking || ctx.estimatedTokens > 16000,
      model: config.powerModel,
      priority: 60,
    },
    {
      name: 'heavy-tool-use',
      condition: (_req, ctx) => ctx.hasTools && ctx.messageCount > 10,
      model: config.defaultModel,
      priority: 50,
    },
    {
      name: 'default',
      condition: () => true,
      model: config.defaultModel,
      priority: 0,
    },
  ];
}

// --- Session Sticky Routing ---

interface SessionState {
  model: string;
  lastSeen: number;
  requestCount: number;
}

const sessionMap = new Map<string, SessionState>();
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getSessionKey(req: AnthropicRequest): string | null {
  if (!req.messages || req.messages.length === 0) return null;
  const systemText = getSystemText(req);
  if (!systemText) return null;
  const hash = simpleHash(systemText.slice(0, 500));
  return `session_${hash}`;
}

function simpleHash(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
}

function cleanSessions(): void {
  const now = Date.now();
  for (const [key, state] of sessionMap) {
    if (now - state.lastSeen > SESSION_TTL_MS) {
      sessionMap.delete(key);
    }
  }
}

setInterval(cleanSessions, 60_000);

// --- Request Analysis ---

function getSystemText(req: AnthropicRequest): string {
  if (!req.system) return '';
  if (typeof req.system === 'string') return req.system;
  if (Array.isArray(req.system)) return req.system.map(s => s.text).join('\n');
  return '';
}

function estimateTokens(req: AnthropicRequest): number {
  let chars = 0;
  chars += getSystemText(req).length;
  for (const msg of req.messages) {
    if (typeof msg.content === 'string') {
      chars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.text) chars += block.text.length;
        if (block.input) chars += JSON.stringify(block.input).length;
        if (typeof block.content === 'string') chars += block.content.length;
      }
    }
  }
  return Math.ceil(chars / 4);
}

function getLastUserMessage(req: AnthropicRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    if (req.messages[i].role === 'user') {
      const content = req.messages[i].content;
      if (typeof content === 'string') return content;
      if (Array.isArray(content)) {
        return content
          .filter(b => b.type === 'text')
          .map(b => b.text || '')
          .join('\n');
      }
    }
  }
  return '';
}

function isToolResultOnly(req: AnthropicRequest): boolean {
  if (req.messages.length === 0) return false;
  const lastMsg = req.messages[req.messages.length - 1];
  if (lastMsg.role !== 'user') return false;
  if (typeof lastMsg.content === 'string') return false;
  if (!Array.isArray(lastMsg.content)) return false;
  return lastMsg.content.every(b => b.type === 'tool_result');
}

function hasToolResults(req: AnthropicRequest): boolean {
  for (const msg of req.messages) {
    if (Array.isArray(msg.content)) {
      if (msg.content.some(b => b.type === 'tool_result')) return true;
    }
  }
  return false;
}

function analyzeRequest(req: AnthropicRequest): RequestContext {
  const lastUserMsg = getLastUserMessage(req);
  return {
    estimatedTokens: estimateTokens(req),
    messageCount: req.messages.length,
    hasTools: !!(req.tools && req.tools.length > 0),
    hasToolResults: hasToolResults(req),
    isToolResultOnly: isToolResultOnly(req),
    hasThinking: !!req.thinking,
    lastUserMessageLength: lastUserMsg.length,
    systemPromptLength: getSystemText(req).length,
  };
}

// --- Public API ---

/**
 * Route an incoming request to the best Venice model.
 * Uses session-sticky routing to maintain model consistency within a conversation turn.
 */
export function routeModel(req: AnthropicRequest): string {
  const sessionKey = getSessionKey(req);

  // Mid-tool-loop: stick with the same model
  if (sessionKey) {
    const session = sessionMap.get(sessionKey);
    if (session) {
      session.lastSeen = Date.now();
      session.requestCount++;
      return session.model;
    }
  }

  const ctx = analyzeRequest(req);

  // Evaluate rules by priority (highest first)
  const sortedRules = [...activeConfig.rules].sort((a, b) => b.priority - a.priority);
  let selectedModel = activeConfig.defaultModel;
  let matchedRule = 'none';

  for (const rule of sortedRules) {
    try {
      if (rule.condition(req, ctx)) {
        selectedModel = rule.model;
        matchedRule = rule.name;
        break;
      }
    } catch {
      continue;
    }
  }

  // Start a new session
  if (sessionKey) {
    sessionMap.set(sessionKey, {
      model: selectedModel,
      lastSeen: Date.now(),
      requestCount: 1,
    });
  }

  const ts = new Date().toISOString().slice(11, 23);
  console.log(
    `[router ${ts}] rule=${matchedRule} model=${selectedModel} tokens~${ctx.estimatedTokens} msgs=${ctx.messageCount} tools=${ctx.hasTools} toolResult=${ctx.isToolResultOnly}`,
  );

  return selectedModel;
}

/**
 * Notify the router that a request completed (for adaptive routing metrics).
 */
export function notifyRequestComplete(
  req: AnthropicRequest,
  model: string,
  elapsedMs: number,
  success: boolean,
): void {
  const sessionKey = getSessionKey(req);
  if (sessionKey && !success) {
    // On failure, clear the session so next request can try a different model
    sessionMap.delete(sessionKey);
  }
}

/**
 * Load routing config from a JSON file (typically per-group .venice-routing.json).
 * Falls back to defaults if the file doesn't exist or is invalid.
 */
export function loadRoutingConfig(configPath: string): void {
  try {
    if (!fs.existsSync(configPath)) return;
    const raw = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    const config: RoutingConfig = {
      defaultModel: raw.defaultModel || DEFAULT_CONFIG.defaultModel,
      fastModel: raw.fastModel || DEFAULT_CONFIG.fastModel,
      powerModel: raw.powerModel || DEFAULT_CONFIG.powerModel,
      rules: [],
    };
    config.rules = buildDefaultRules(config);
    activeConfig = config;
    console.log(`[router] Loaded config from ${configPath}: default=${config.defaultModel} fast=${config.fastModel} power=${config.powerModel}`);
  } catch (err) {
    console.error(`[router] Failed to load config from ${configPath}: ${err}`);
  }
}

/**
 * Update the routing config programmatically.
 */
export function setRoutingConfig(config: Partial<RoutingConfig>): void {
  const merged: RoutingConfig = {
    defaultModel: config.defaultModel || activeConfig.defaultModel,
    fastModel: config.fastModel || activeConfig.fastModel,
    powerModel: config.powerModel || activeConfig.powerModel,
    rules: [],
  };
  merged.rules = buildDefaultRules(merged);
  activeConfig = merged;
}

/**
 * Get current routing stats for diagnostics.
 */
export function getRoutingStats(): {
  activeSessions: number;
  config: { defaultModel: string; fastModel: string; powerModel: string };
} {
  return {
    activeSessions: sessionMap.size,
    config: {
      defaultModel: activeConfig.defaultModel,
      fastModel: activeConfig.fastModel,
      powerModel: activeConfig.powerModel,
    },
  };
}

// Load config from env-specified path on startup
const configPath = process.env.VENICE_ROUTING_CONFIG;
if (configPath) {
  loadRoutingConfig(configPath);
}
