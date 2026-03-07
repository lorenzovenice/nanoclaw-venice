/**
 * Venice API Translation Proxy
 *
 * Sits between the Anthropic Claude SDK and Venice AI's OpenAI-compatible API.
 * Accepts Anthropic Messages API requests, translates them to OpenAI Chat
 * Completions format, forwards to Venice, and translates the response back.
 *
 * Features:
 * - HTTPS connection pooling (keep-alive) for reduced latency
 * - Multi-model routing via pluggable model-router
 * - Per-request diagnostic logging (latency, tokens, model)
 * - Robust streaming SSE translation with proper chunk reassembly
 *
 * Usage:
 *   VENICE_API_KEY=your-key tsx proxy/venice-proxy.ts
 *
 * The Claude SDK connects here via ANTHROPIC_BASE_URL=http://localhost:4001
 */
import http from 'http';
import https from 'https';
import { routeModel, notifyRequestComplete, setRoutingConfig, type AnthropicRequest } from './model-router.js';

const VENICE_BASE_URL = process.env.VENICE_BASE_URL || 'https://api.venice.ai/api/v1';
const VENICE_API_KEY = process.env.VENICE_API_KEY || '';
const PORT = parseInt(process.env.VENICE_PROXY_PORT || '4001', 10);

if (!VENICE_API_KEY) {
  console.error('Error: VENICE_API_KEY environment variable is required');
  process.exit(1);
}

const httpsAgent = new https.Agent({
  keepAlive: true,
  maxSockets: 10,
  maxFreeSockets: 5,
  timeout: 60_000,
});

// Map Anthropic model IDs that Venice doesn't have to Venice equivalents
const MODEL_MAP: Record<string, string> = {
  'claude-haiku-4-5-20251001': 'claude-sonnet-4-6',
  'claude-3-5-haiku-20241022': 'claude-sonnet-4-6',
  'claude-3-haiku-20240307': 'claude-sonnet-4-6',
  'claude-sonnet-4-5-20250929': 'claude-sonnet-4-6',
  'claude-4-5-sonnet-20250929': 'claude-sonnet-4-6',
};

function mapModel(model: string): string {
  if (MODEL_MAP[model]) {
    log(`model remap: ${model} → ${MODEL_MAP[model]}`);
    return MODEL_MAP[model];
  }
  return model;
}

function log(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.log(`[proxy ${ts}] ${msg}`);
}

function logError(msg: string): void {
  const ts = new Date().toISOString().slice(11, 23);
  console.error(`[proxy ${ts}] ${msg}`);
}

// --- Request Translation (Anthropic → OpenAI) ---

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

type OpenAIContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };


interface OpenAIMessage {
  role: string;
  content?: string | OpenAIContentPart[] | null;
  tool_calls?: OpenAIToolCall[];
  tool_call_id?: string;
  name?: string;
}

interface OpenAIToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

function translateMessages(anthropicMessages: AnthropicMessage[]): OpenAIMessage[] {
  const openaiMessages: OpenAIMessage[] = [];

  for (const msg of anthropicMessages) {
    if (msg.role === 'user') {
      if (typeof msg.content === 'string') {
        openaiMessages.push({ role: 'user', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const toolResults = msg.content.filter((b) => b.type === 'tool_result');
        const textBlocks = msg.content.filter((b) => b.type === 'text');
        const imageBlocks = msg.content.filter((b) => b.type === 'image');

        for (const tr of toolResults) {
          let content = '';
          if (typeof tr.content === 'string') {
            content = tr.content;
          } else if (Array.isArray(tr.content)) {
            content = tr.content
              .filter((b) => b.type === 'text')
              .map((b) => b.text || '')
              .join('\n');
          }
          openaiMessages.push({
            role: 'tool',
            tool_call_id: tr.tool_use_id || '',
            content,
          });
        }

        // If there are image blocks, build multimodal content parts
        if (imageBlocks.length > 0) {
          const parts: OpenAIContentPart[] = [];
          for (const b of textBlocks) {
            if (b.text) parts.push({ type: 'text', text: b.text });
          }
          for (const b of imageBlocks) {
            const src = b.source as { type?: string; media_type?: string; data?: string } | undefined;
            if (src?.type === 'base64' && src.data) {
              const mediaType = src.media_type || 'image/jpeg';
              parts.push({
                type: 'image_url',
                image_url: { url: `data:${mediaType};base64,${src.data}` },
              });
            }
          }
          if (parts.length > 0) {
            openaiMessages.push({ role: 'user', content: parts });
          }
        } else if (textBlocks.length > 0) {
          const text = textBlocks.map((b) => b.text || '').join('\n');
          if (text) {
            openaiMessages.push({ role: 'user', content: text });
          }
        }

        // If no text blocks, no image blocks, and no tool results, concatenate all content
        if (toolResults.length === 0 && textBlocks.length === 0 && imageBlocks.length === 0) {
          const text = msg.content.map((b) => b.text || JSON.stringify(b)).join('\n');
          openaiMessages.push({ role: 'user', content: text });
        }
      }
    } else if (msg.role === 'assistant') {
      if (typeof msg.content === 'string') {
        openaiMessages.push({ role: 'assistant', content: msg.content });
      } else if (Array.isArray(msg.content)) {
        const textParts: string[] = [];
        const toolCalls: OpenAIToolCall[] = [];

        for (const block of msg.content) {
          if (block.type === 'text') {
            textParts.push(block.text || '');
          } else if (block.type === 'tool_use') {
            toolCalls.push({
              id: block.id || `call_${Math.random().toString(36).slice(2)}`,
              type: 'function',
              function: {
                name: block.name || '',
                arguments: typeof block.input === 'string'
                  ? block.input
                  : JSON.stringify(block.input || {}),
              },
            });
          }
        }

        const assistantMsg: OpenAIMessage = {
          role: 'assistant',
          content: textParts.join('\n') || null,
        };
        if (toolCalls.length > 0) {
          assistantMsg.tool_calls = toolCalls;
        }
        openaiMessages.push(assistantMsg);
      }
    }
  }

  return openaiMessages;
}

function translateTools(anthropicTools: AnthropicTool[]): Array<{
  type: 'function';
  function: { name: string; description?: string; parameters: Record<string, unknown> };
}> {
  return anthropicTools.map((tool) => ({
    type: 'function' as const,
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.input_schema,
    },
  }));
}

function translateRequest(body: AnthropicRequest, routedModel: string): Record<string, unknown> {
  const openaiMessages: OpenAIMessage[] = [];

  if (body.system) {
    if (typeof body.system === 'string') {
      openaiMessages.push({ role: 'system', content: body.system });
    } else if (Array.isArray(body.system)) {
      const text = body.system.map((s) => s.text).join('\n');
      openaiMessages.push({ role: 'system', content: text });
    }
  }

  openaiMessages.push(...translateMessages(body.messages));

  const finalModel = mapModel(routedModel);
  const isClaudeModel = finalModel.startsWith('claude');
  const maxTokens = isClaudeModel ? Math.max(body.max_tokens, 4096) : body.max_tokens;

  const veniceParams: Record<string, unknown> = {
    include_venice_system_prompt: false,
  };

  // Only inject thinking budget when the incoming request explicitly requested it,
  // rather than forcing it on every call (which adds latency to simple tool-result acks)
  if (body.thinking && isClaudeModel) {
    const thinkingConfig = body.thinking as Record<string, unknown>;
    const budget = typeof thinkingConfig.budget_tokens === 'number'
      ? Math.max(thinkingConfig.budget_tokens, 1024)
      : 1024;
    veniceParams.thinking = { budget_tokens: budget };
  }

  const openaiReq: Record<string, unknown> = {
    model: finalModel,
    messages: openaiMessages,
    max_tokens: maxTokens,
    stream: body.stream || false,
    venice_parameters: veniceParams,
  };

  if (body.temperature != null) openaiReq.temperature = body.temperature;
  if (body.top_p != null) openaiReq.top_p = body.top_p;
  if (body.stop_sequences) openaiReq.stop = body.stop_sequences;

  if (body.tools && body.tools.length > 0) {
    openaiReq.tools = translateTools(body.tools);
    if (body.tool_choice) {
      if (typeof body.tool_choice === 'object' && body.tool_choice !== null) {
        const tc = body.tool_choice as Record<string, unknown>;
        if (tc.type === 'auto') openaiReq.tool_choice = 'auto';
        else if (tc.type === 'any') openaiReq.tool_choice = 'required';
        else if (tc.type === 'tool' && tc.name) {
          openaiReq.tool_choice = { type: 'function', function: { name: tc.name } };
        }
      }
    } else {
      openaiReq.tool_choice = 'auto';
    }
  }

  return openaiReq;
}

// --- Response Translation (OpenAI → Anthropic) ---

interface OpenAIResponse {
  id: string;
  choices: Array<{
    message: {
      role: string;
      content?: string | null;
      tool_calls?: OpenAIToolCall[];
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
  model?: string;
}

function mapFinishReason(reason: string): string {
  switch (reason) {
    case 'stop': return 'end_turn';
    case 'length': return 'max_tokens';
    case 'tool_calls': return 'tool_use';
    case 'content_filter': return 'end_turn';
    default: return 'end_turn';
  }
}

function translateResponse(openaiResp: OpenAIResponse, model: string): Record<string, unknown> {
  const choice = openaiResp.choices[0];
  if (!choice) {
    return {
      id: openaiResp.id || `msg_${Date.now()}`,
      type: 'message',
      role: 'assistant',
      model,
      content: [],
      stop_reason: 'end_turn',
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }

  const content: Array<Record<string, unknown>> = [];

  if (choice.message.content) {
    content.push({ type: 'text', text: choice.message.content });
  }

  if (choice.message.tool_calls) {
    for (const tc of choice.message.tool_calls) {
      let input: unknown;
      try {
        input = JSON.parse(tc.function.arguments);
      } catch {
        input = {};
      }
      content.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }

  if (content.length === 0) {
    content.push({ type: 'text', text: '' });
  }

  return {
    id: openaiResp.id || `msg_${Date.now()}`,
    type: 'message',
    role: 'assistant',
    model,
    content,
    stop_reason: mapFinishReason(choice.finish_reason),
    usage: {
      input_tokens: openaiResp.usage?.prompt_tokens || 0,
      output_tokens: openaiResp.usage?.completion_tokens || 0,
    },
  };
}

// --- Streaming Translation (OpenAI SSE → Anthropic SSE) ---

function createStreamingTranslator(
  res: http.ServerResponse,
  model: string,
  requestId: string,
): (chunk: string) => void {
  let sentMessageStart = false;
  let contentBlockIndex = 0;
  let currentBlockOpen = false;
  let currentBlockType: 'text' | 'tool_use' = 'text';
  let inputJsonBuffer = '';
  let currentToolCallId = '';
  let currentToolName = '';
  let lineBuffer = '';
  let ended = false;

  const send = (event: string, data: unknown) => {
    if (ended) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const closeCurrentBlock = () => {
    if (!currentBlockOpen) return;
    if (currentBlockType === 'tool_use' && inputJsonBuffer) {
      send('content_block_delta', {
        type: 'content_block_delta',
        index: contentBlockIndex,
        delta: { type: 'input_json_delta', partial_json: inputJsonBuffer },
      });
      inputJsonBuffer = '';
    }
    send('content_block_stop', { type: 'content_block_stop', index: contentBlockIndex });
    currentBlockOpen = false;
  };

  const finish = (stopReason: string) => {
    if (ended) return;
    ended = true;
    closeCurrentBlock();
    send('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: stopReason },
      usage: { output_tokens: 0 },
    });
    send('message_stop', { type: 'message_stop' });
    res.end();
  };

  return (chunk: string) => {
    if (ended) return;

    lineBuffer += chunk;
    const lines = lineBuffer.split('\n');
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith('data: ')) continue;
      const data = trimmed.slice(6);
      if (data === '[DONE]') {
        finish('end_turn');
        return;
      }

      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(data);
      } catch {
        continue;
      }

      if (!sentMessageStart) {
        send('message_start', {
          type: 'message_start',
          message: {
            id: requestId,
            type: 'message',
            role: 'assistant',
            model,
            content: [],
            stop_reason: null,
            usage: { input_tokens: 0, output_tokens: 0 },
          },
        });
        sentMessageStart = true;
      }

      const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
      if (!choices || choices.length === 0) continue;

      const delta = choices[0].delta as Record<string, unknown> | undefined;
      const finishReason = choices[0].finish_reason as string | null;

      if (delta) {
        if (delta.content != null) {
          const text = delta.content as string;
          if (!currentBlockOpen || currentBlockType !== 'text') {
            closeCurrentBlock();
            if (currentBlockOpen) contentBlockIndex++;
            send('content_block_start', {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: { type: 'text', text: '' },
            });
            currentBlockOpen = true;
            currentBlockType = 'text';
          }
          send('content_block_delta', {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: { type: 'text_delta', text },
          });
        }

        const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        if (toolCalls) {
          for (const tc of toolCalls) {
            const fn = tc.function as Record<string, unknown> | undefined;
            if (fn?.name) {
              closeCurrentBlock();
              if (currentBlockOpen) contentBlockIndex++;
              currentToolCallId = (tc.id as string) || `toolu_${Date.now()}`;
              currentToolName = fn.name as string;
              send('content_block_start', {
                type: 'content_block_start',
                index: contentBlockIndex,
                content_block: {
                  type: 'tool_use',
                  id: currentToolCallId,
                  name: currentToolName,
                  input: {},
                },
              });
              currentBlockOpen = true;
              currentBlockType = 'tool_use';
              inputJsonBuffer = '';
            }
            if (fn?.arguments) {
              const args = fn.arguments as string;
              inputJsonBuffer += args;
              send('content_block_delta', {
                type: 'content_block_delta',
                index: contentBlockIndex,
                delta: { type: 'input_json_delta', partial_json: args },
              });
            }
          }
        }
      }

      if (finishReason) {
        finish(mapFinishReason(finishReason));
        return;
      }
    }
  };
}

// --- HTTP Proxy Server ---

function forwardToVenice(
  method: string,
  urlPath: string,
  body: Buffer | null,
  headers: Record<string, string>,
  onData?: (chunk: string) => void,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const url = new URL(VENICE_BASE_URL + urlPath);

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      agent: httpsAgent,
      headers: {
        ...headers,
        'Authorization': `Bearer ${VENICE_API_KEY}`,
        'Host': url.hostname,
        'User-Agent': 'NanoClaw/1.2.0',
        'Accept': 'application/json',
        'Accept-Encoding': 'identity',
        ...(body ? { 'Content-Length': String(body.length) } : {}),
      },
    };

    const req = https.request(options, (res) => {
      if (onData) {
        res.setEncoding('utf-8');
        const chunks: string[] = [];
        res.on('data', (chunk: string) => {
          chunks.push(chunk);
          onData(chunk);
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 500,
            headers: res.headers,
            body: Buffer.from(chunks.join('')),
          });
        });
      } else {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 500,
            headers: res.headers,
            body: Buffer.concat(chunks),
          });
        });
      }
    });

    req.on('error', reject);
    req.setTimeout(120_000, () => {
      req.destroy(new Error('Venice request timeout (120s)'));
    });
    if (body) req.write(body);
    req.end();
  });
}

let requestCounter = 0;

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';
  const reqId = ++requestCounter;
  const reqStart = Date.now();

  // Collect request body
  const bodyChunks: Buffer[] = [];
  for await (const chunk of req) {
    bodyChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const rawBody = Buffer.concat(bodyChunks);

  const urlPath = url.split('?')[0];
  if (urlPath === '/v1/messages' && req.method === 'POST') {
    try {
      const anthropicReq: AnthropicRequest = JSON.parse(rawBody.toString());
      const isStreaming = anthropicReq.stream === true;

      // Per-group routing overrides via X-Venice-Routing header (JSON)
      const routingHeader = req.headers['x-venice-routing'] as string | undefined;
      if (routingHeader) {
        try {
          const overrides = JSON.parse(routingHeader);
          setRoutingConfig(overrides);
        } catch { /* ignore malformed header */ }
      }

      const routedModel = routeModel(anthropicReq);
      const openaiReq = translateRequest(anthropicReq, routedModel);
      const openaiBody = Buffer.from(JSON.stringify(openaiReq));

      const requestId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const hasTools = !!(anthropicReq.tools && anthropicReq.tools.length > 0);
      const msgCount = anthropicReq.messages.length;

      log(`#${reqId} ${anthropicReq.model}→${openaiReq.model} stream=${isStreaming} tools=${hasTools} msgs=${msgCount} body=${openaiBody.length}b`);

      if (isStreaming) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const translator = createStreamingTranslator(res, anthropicReq.model, requestId);

        try {
          const streamResp = await forwardToVenice(
            'POST',
            '/chat/completions',
            openaiBody,
            { 'Content-Type': 'application/json' },
            translator,
          );

          const elapsed = Date.now() - reqStart;
          notifyRequestComplete(anthropicReq, routedModel, elapsed, streamResp.statusCode === 200);
          log(`#${reqId} completed ${elapsed}ms status=${streamResp.statusCode}`);

          if (streamResp.statusCode !== 200 && !res.writableEnded) {
            logError(`#${reqId} Venice streaming HTTP ${streamResp.statusCode}: ${streamResp.body.toString().slice(0, 300)}`);
            const errorEvent = {
              type: 'error',
              error: { type: 'api_error', message: `Venice API returned HTTP ${streamResp.statusCode}` },
            };
            res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
            res.end();
          }
        } catch (err) {
          const elapsed = Date.now() - reqStart;
          notifyRequestComplete(anthropicReq, routedModel, elapsed, false);
          logError(`#${reqId} streaming error (${elapsed}ms): ${err}`);
          if (!res.writableEnded) {
            const errorEvent = {
              type: 'error',
              error: { type: 'api_error', message: `Proxy streaming error: ${err}` },
            };
            res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
            res.end();
          }
        }
      } else {
        const veniceResp = await forwardToVenice(
          'POST',
          '/chat/completions',
          openaiBody,
          { 'Content-Type': 'application/json' },
        );

        const elapsed = Date.now() - reqStart;
        notifyRequestComplete(anthropicReq, routedModel, elapsed, veniceResp.statusCode === 200);

        if (veniceResp.statusCode !== 200) {
          logError(`#${reqId} Venice HTTP ${veniceResp.statusCode} (${elapsed}ms): ${veniceResp.body.toString().slice(0, 300)}`);
          let errorMessage = `Venice API error (HTTP ${veniceResp.statusCode})`;
          let errorType = 'api_error';
          try {
            const veniceError = JSON.parse(veniceResp.body.toString());
            if (veniceError.error?.message) errorMessage = veniceError.error.message;
            if (veniceResp.statusCode === 401) errorType = 'authentication_error';
            else if (veniceResp.statusCode === 429) errorType = 'rate_limit_error';
            else if (veniceResp.statusCode === 400) errorType = 'invalid_request_error';
            else if (veniceResp.statusCode === 404) errorType = 'not_found_error';
            else if (veniceResp.statusCode >= 500) errorType = 'api_error';
          } catch { /* use defaults */ }

          const anthropicStatus = veniceResp.statusCode === 401 ? 401
            : veniceResp.statusCode === 429 ? 429
            : veniceResp.statusCode === 400 ? 400
            : veniceResp.statusCode >= 500 ? 500
            : veniceResp.statusCode;
          res.writeHead(anthropicStatus, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            type: 'error',
            error: { type: errorType, message: errorMessage },
          }));
          return;
        }

        const openaiResp: OpenAIResponse = JSON.parse(veniceResp.body.toString());
        const anthropicResp = translateResponse(openaiResp, anthropicReq.model);
        anthropicResp.id = requestId;

        const usage = openaiResp.usage;
        log(`#${reqId} completed ${elapsed}ms in=${usage?.prompt_tokens || '?'} out=${usage?.completion_tokens || '?'}`);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(anthropicResp));
      }
    } catch (err) {
      const elapsed = Date.now() - reqStart;
      logError(`#${reqId} translation error (${elapsed}ms): ${err}`);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message: `Proxy translation error: ${err}` },
      }));
    }
    return;
  }

  // Pass through other endpoints
  try {
    let venicePath = url;
    if (url === '/v1/models') venicePath = '/models';

    const veniceResp = await forwardToVenice(
      req.method || 'GET',
      venicePath,
      rawBody.length > 0 ? rawBody : null,
      { 'Content-Type': req.headers['content-type'] || 'application/json' },
    );

    res.writeHead(veniceResp.statusCode, { 'Content-Type': 'application/json' });
    res.end(veniceResp.body);
  } catch (err) {
    logError(`#${reqId} passthrough error: ${err}`);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Proxy error: ${err}` }));
  }
});

process.on('uncaughtException', (err) => {
  logError(`Uncaught exception (kept running): ${err.message}`);
});
process.on('unhandledRejection', (err) => {
  logError(`Unhandled rejection (kept running): ${err}`);
});

server.listen(PORT, () => {
  log(`Venice proxy listening on localhost:${PORT}`);
  log(`Forwarding to: ${VENICE_BASE_URL}`);
  log(`Connection pooling: keepAlive=true maxSockets=10`);
});
