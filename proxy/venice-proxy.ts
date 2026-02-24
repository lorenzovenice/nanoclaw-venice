/**
 * Venice API Translation Proxy
 *
 * Sits between the Anthropic Claude SDK and Venice AI's OpenAI-compatible API.
 * Accepts Anthropic Messages API requests, translates them to OpenAI Chat
 * Completions format, forwards to Venice, and translates the response back.
 *
 * Usage:
 *   VENICE_API_KEY=your-key tsx proxy/venice-proxy.ts
 *
 * The Claude SDK connects here via ANTHROPIC_BASE_URL=http://localhost:4001
 */
import http from 'http';
import https from 'https';

const VENICE_BASE_URL = process.env.VENICE_BASE_URL || 'https://api.venice.ai/api/v1';
const VENICE_API_KEY = process.env.VENICE_API_KEY || '';
const PORT = parseInt(process.env.VENICE_PROXY_PORT || '4001', 10);

if (!VENICE_API_KEY) {
  console.error('Error: VENICE_API_KEY environment variable is required');
  process.exit(1);
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

interface AnthropicRequest {
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

interface OpenAIMessage {
  role: string;
  content?: string | null;
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
        // Check for tool_result blocks
        const toolResults = msg.content.filter((b) => b.type === 'tool_result');
        const textBlocks = msg.content.filter((b) => b.type === 'text');

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

        if (textBlocks.length > 0) {
          const text = textBlocks.map((b) => b.text || '').join('\n');
          if (text) {
            openaiMessages.push({ role: 'user', content: text });
          }
        }

        // If no text blocks and no tool results, concatenate all content
        if (toolResults.length === 0 && textBlocks.length === 0) {
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

function translateRequest(body: AnthropicRequest): Record<string, unknown> {
  const openaiMessages: OpenAIMessage[] = [];

  // System message
  if (body.system) {
    if (typeof body.system === 'string') {
      openaiMessages.push({ role: 'system', content: body.system });
    } else if (Array.isArray(body.system)) {
      const text = body.system.map((s) => s.text).join('\n');
      openaiMessages.push({ role: 'system', content: text });
    }
  }

  // User/assistant messages
  openaiMessages.push(...translateMessages(body.messages));

  const openaiReq: Record<string, unknown> = {
    model: body.model,
    messages: openaiMessages,
    max_tokens: body.max_tokens,
    stream: body.stream || false,
    venice_parameters: { include_venice_system_prompt: false },
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

  // Anthropic API requires at least one content block
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
  let inputJsonBuffer = '';
  let currentToolCallId = '';
  let currentToolName = '';
  let lineBuffer = ''; // Buffer for incomplete SSE lines split across TCP chunks
  let ended = false; // Guard against double res.end()

  const send = (event: string, data: unknown) => {
    if (ended) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const finish = (stopReason: string) => {
    if (ended) return;
    ended = true;
    // Close any open content block
    if (currentBlockOpen) {
      send('content_block_stop', { type: 'content_block_stop', index: contentBlockIndex });
      currentBlockOpen = false;
    }
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

    // Accumulate partial lines from TCP chunk boundaries
    lineBuffer += chunk;
    const lines = lineBuffer.split('\n');
    // Keep the last (potentially incomplete) line in the buffer
    lineBuffer = lines.pop() || '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
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

      // Send message_start on first chunk
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
        // Text content
        if (delta.content != null) {
          const text = delta.content as string;
          if (!currentBlockOpen || inputJsonBuffer) {
            // New text block
            if (currentBlockOpen) {
              send('content_block_stop', { type: 'content_block_stop', index: contentBlockIndex });
              contentBlockIndex++;
            }
            send('content_block_start', {
              type: 'content_block_start',
              index: contentBlockIndex,
              content_block: { type: 'text', text: '' },
            });
            currentBlockOpen = true;
            inputJsonBuffer = '';
          }
          send('content_block_delta', {
            type: 'content_block_delta',
            index: contentBlockIndex,
            delta: { type: 'text_delta', text },
          });
        }

        // Tool calls
        const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
        if (toolCalls) {
          for (const tc of toolCalls) {
            const fn = tc.function as Record<string, unknown> | undefined;
            if (fn?.name) {
              // New tool call — close previous block if open
              if (currentBlockOpen) {
                // If we had a tool_use block open, flush the input JSON
                if (inputJsonBuffer) {
                  send('content_block_delta', {
                    type: 'content_block_delta',
                    index: contentBlockIndex,
                    delta: { type: 'input_json_delta', partial_json: inputJsonBuffer },
                  });
                  inputJsonBuffer = '';
                }
                send('content_block_stop', { type: 'content_block_stop', index: contentBlockIndex });
                contentBlockIndex++;
              }
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

      // Handle finish reason
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
  path: string,
  body: Buffer | null,
  headers: Record<string, string>,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }>;
function forwardToVenice(
  method: string,
  path: string,
  body: Buffer | null,
  headers: Record<string, string>,
  onData?: (chunk: string) => void,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }>;
function forwardToVenice(
  method: string,
  urlPath: string,
  body: Buffer | null,
  headers: Record<string, string>,
  onData?: (chunk: string) => void,
): Promise<{ statusCode: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlPath, VENICE_BASE_URL);

    const options: https.RequestOptions = {
      hostname: url.hostname,
      port: url.port || 443,
      path: url.pathname + url.search,
      method,
      headers: {
        ...headers,
        'Authorization': `Bearer ${VENICE_API_KEY}`,
        'Host': url.hostname,
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
    if (body) req.write(body);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // Collect request body
  const bodyChunks: Buffer[] = [];
  for await (const chunk of req) {
    bodyChunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  const rawBody = Buffer.concat(bodyChunks);

  // Handle Anthropic Messages API
  if (url === '/v1/messages' && req.method === 'POST') {
    try {
      const anthropicReq: AnthropicRequest = JSON.parse(rawBody.toString());
      const requestModel = anthropicReq.model;
      const isStreaming = anthropicReq.stream === true;
      const openaiReq = translateRequest(anthropicReq);
      const openaiBody = Buffer.from(JSON.stringify(openaiReq));

      const requestId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      if (process.env.VENICE_PROXY_DEBUG) {
        console.log(`[proxy] ${requestModel} → ${openaiReq.model} (stream=${isStreaming})`);
      }

      if (isStreaming) {
        // Streaming: pipe SSE chunks through translator
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const translator = createStreamingTranslator(res, requestModel, requestId);

        try {
          const streamResp = await forwardToVenice(
            'POST',
            '/chat/completions',
            openaiBody,
            { 'Content-Type': 'application/json' },
            translator,
          );
          // If Venice returned a non-200, the translator may not have sent
          // a proper message_stop. Ensure the stream is properly terminated.
          if (streamResp.statusCode !== 200 && !res.writableEnded) {
            const errorEvent = {
              type: 'error',
              error: { type: 'api_error', message: `Venice API returned HTTP ${streamResp.statusCode}` },
            };
            res.write(`event: error\ndata: ${JSON.stringify(errorEvent)}\n\n`);
            res.end();
          }
        } catch (err) {
          console.error('[proxy] Venice streaming error:', err);
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
        // Non-streaming: translate full response
        const veniceResp = await forwardToVenice(
          'POST',
          '/chat/completions',
          openaiBody,
          { 'Content-Type': 'application/json' },
        );

        if (veniceResp.statusCode !== 200) {
          // Translate Venice/OpenAI error format to Anthropic error format
          let errorMessage = `Venice API error (HTTP ${veniceResp.statusCode})`;
          let errorType = 'api_error';
          try {
            const veniceError = JSON.parse(veniceResp.body.toString());
            if (veniceError.error?.message) errorMessage = veniceError.error.message;
            // Map OpenAI error types to Anthropic types
            if (veniceResp.statusCode === 401) errorType = 'authentication_error';
            else if (veniceResp.statusCode === 429) errorType = 'rate_limit_error';
            else if (veniceResp.statusCode === 400) errorType = 'invalid_request_error';
            else if (veniceResp.statusCode === 404) errorType = 'not_found_error';
            else if (veniceResp.statusCode >= 500) errorType = 'api_error';
          } catch {
            // Body wasn't JSON, use default message
          }
          // Map Venice status codes to Anthropic-expected codes
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
        const anthropicResp = translateResponse(openaiResp, requestModel);
        anthropicResp.id = requestId;

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(anthropicResp));
      }
    } catch (err) {
      console.error('[proxy] Translation error:', err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        type: 'error',
        error: { type: 'api_error', message: `Proxy translation error: ${err}` },
      }));
    }
    return;
  }

  // Pass through other endpoints (e.g., /v1/models) directly to Venice
  try {
    // Map Anthropic-style paths to Venice OpenAI paths
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
    console.error('[proxy] Passthrough error:', err);
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: `Proxy error: ${err}` }));
  }
});

server.listen(PORT, () => {
  console.log(`Venice API proxy listening on http://localhost:${PORT}`);
  console.log(`Forwarding to: ${VENICE_BASE_URL}`);
  if (process.env.VENICE_PROXY_DEBUG) {
    console.log('Debug logging enabled (VENICE_PROXY_DEBUG=1)');
  }
});
