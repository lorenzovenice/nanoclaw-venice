# NanoClaw (Venice API)

A fork of [NanoClaw](https://github.com/qwibitai/nanoclaw) that routes all inference through [Venice AI](https://venice.ai). Same architecture, same Claude Agent SDK, same container isolation — just powered by Venice.

Supports WhatsApp and Telegram out of the box.

## What This Is

NanoClaw is a personal AI assistant that runs Claude agents in isolated containers. It connects to WhatsApp and/or Telegram so you can message your assistant from your phone. Agents are sandboxed in Linux containers with filesystem isolation.

This fork adds a lightweight translation proxy that sits between the Anthropic Claude SDK and Venice AI's API. The proxy translates Anthropic message format to OpenAI format and back, so the entire Anthropic Agent SDK works unchanged through Venice.

```
Claude Agent SDK ──► Venice Proxy (localhost:4001) ──► api.venice.ai
                     (auto-started, transparent)       (Claude, Llama, Qwen, etc.)
```

## Prerequisites

- macOS or Linux
- Node.js 20+
- [Claude Code](https://claude.ai/download) (CLI)
- [Docker](https://docker.com/products/docker-desktop) or [Apple Container](https://github.com/apple/container) (macOS)
- A [Venice AI API key](https://venice.ai/settings/api)
- (Optional) A Telegram bot token from [@BotFather](https://t.me/BotFather)

## Quick Start

```bash
git clone <your-fork-url>
cd nanoclaw
npm install
claude
```

Then inside Claude Code, run:

```
/setup
```

Claude Code handles everything: Venice API configuration, dependencies, WhatsApp/Telegram authentication, container setup, and service configuration.

## Setup Walkthrough

The `/setup` command walks you through each step interactively. Here's what happens:

### 1. Venice API Key

You'll be asked for your Venice API key. Get one at [venice.ai/settings/api](https://venice.ai/settings/api).

The setup validates your key against Venice's API, then writes these to `.env`:

```bash
VENICE_API_KEY=your-key
ANTHROPIC_BASE_URL=http://localhost:4001
ANTHROPIC_API_KEY=venice-proxy
```

### 2. Choose Messaging Channel

Pick one:
- **WhatsApp** — scan a QR code to link your WhatsApp account
- **Telegram** — provide a bot token from [@BotFather](https://t.me/BotFather)
- **Both** — run WhatsApp and Telegram simultaneously

### 3. Container Runtime

Docker (default) or Apple Container (macOS). The setup detects what's available and builds the agent container image.

### 4. WhatsApp Authentication (if selected)

Scan a QR code or use a pairing code to link your WhatsApp account.

### 5. Register Main Channel

Choose your trigger word (default: `@Andy`) and main channel (self-chat, DM, or group).

### 6. Start Service

The setup installs a system service (launchd on macOS, systemd on Linux) so NanoClaw runs in the background.

## Manual Setup (Without /setup)

If you prefer to configure manually:

1. Copy the example env file:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` with your Venice API key:
   ```bash
   VENICE_API_KEY=your-actual-key
   ```

3. (Optional) Add Telegram:
   ```bash
   TELEGRAM_BOT_TOKEN=your-bot-token
   TELEGRAM_ONLY=false   # set to true to skip WhatsApp
   ```

4. Start in development mode:
   ```bash
   npm run dev
   ```

This starts both the Venice proxy and NanoClaw together.

## Using Claude Code Through Venice

You can also use the Venice proxy for Claude Code in your terminal (outside of NanoClaw):

```bash
# Start the proxy
npm run proxy &

# Set environment variables
export ANTHROPIC_BASE_URL=http://localhost:4001
export ANTHROPIC_API_KEY=venice-proxy

# Now Claude Code routes through Venice
claude
```

## Models

Default models:
- **CLI (Claude Code):** `claude-opus-4-6`
- **WhatsApp/Telegram agent:** `claude-sonnet-4-6`

Venice hosts these models directly — no mapping or substitution. You can switch to any model Venice supports:

- **In terminal:** `claude --model llama-3.3-70b`
- **In chat:** Tell the bot "switch to opus" or "use llama-3.3-70b"

Any Venice model ID works: `claude-opus-4-6`, `claude-sonnet-4-6`, `llama-3.3-70b`, `qwen3-4b`, etc.

## Usage

Talk to your assistant with the trigger word (default: `@Andy`):

```
@Andy send an overview of the sales pipeline every weekday morning at 9am
@Andy review the git history for the past week each Friday
@Andy every Monday at 8am, compile AI news from Hacker News and message me a briefing
```

From the main channel (your self-chat), manage groups and tasks:
```
@Andy list all scheduled tasks across groups
@Andy pause the Monday briefing task
@Andy join the Family Chat group
```

## Development

```bash
npm run dev          # Start proxy + NanoClaw with hot reload
npm run proxy        # Start just the Venice proxy
npm run build        # Compile TypeScript
npm test             # Run tests
./container/build.sh # Rebuild agent container
```

Enable debug logging for the proxy:
```bash
VENICE_PROXY_DEBUG=1 npm run dev
```

## Architecture

```
WhatsApp (baileys) ──┐
                     ├──► SQLite ──► Polling loop ──► Container (Claude Agent SDK) ──► Response
Telegram (grammy) ───┘                                       │
                                                             ▼
                                                  Venice Proxy (localhost:4001)
                                                             │
                                                             ▼
                                                      api.venice.ai
```

Single Node.js process. Agents execute in isolated Linux containers. Only mounted directories are accessible. Per-group message queue with concurrency control. IPC via filesystem.

Key files:

| File | Purpose |
|------|---------|
| `proxy/venice-proxy.ts` | Anthropic-to-OpenAI translation proxy for Venice |
| `src/index.ts` | Orchestrator: state, message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection, auth, send/receive |
| `src/channels/telegram.ts` | Telegram bot connection, send/receive |
| `src/container-runner.ts` | Spawns agent containers with mounts |
| `src/config.ts` | Trigger pattern, paths, intervals |
| `src/db.ts` | SQLite operations |
| `groups/*/CLAUDE.md` | Per-group memory (isolated) |

## Customizing

NanoClaw is designed to be customized by modifying the code. The codebase is small enough that Claude can safely make changes:

- "Change the trigger word to @Bob"
- "Make responses shorter and more direct"
- "Add a custom greeting when I say good morning"

Or run `/customize` for guided changes.

## FAQ

**Why a proxy instead of calling Venice directly?**

The Claude Agent SDK uses Anthropic's message format. Venice uses OpenAI's format. Rather than rewriting the SDK integration, the proxy translates between the two formats transparently. This means all SDK features (tool use, streaming, agent swarms) work unchanged.

**Can I use open-source models?**

Yes. Venice hosts many models. Tell the bot "switch to llama-3.3-70b" or use any Venice model ID.

**Is this secure?**

Agents run in containers, not behind application-level permission checks. They can only access explicitly mounted directories. Your Venice API key is passed to containers via stdin, never written to disk.

**How do I debug issues?**

Ask Claude Code: "Why isn't the scheduler running?", "What's in the recent logs?", "Why did this message not get a response?" Or run `/debug`.

## Based On

[NanoClaw](https://github.com/qwibitai/nanoclaw) by [qwibitai](https://github.com/qwibitai). See the original repo for the full philosophy and contributing guidelines.

## License

MIT
