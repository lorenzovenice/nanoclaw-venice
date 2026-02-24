# NanoClaw (Venice API)

A fork of [NanoClaw](https://github.com/qwibitai/nanoclaw) that routes all inference through [Venice AI](https://venice.ai). Same architecture, same Claude Agent SDK, same container isolation — just powered by Venice.

Supports WhatsApp and Telegram out of the box.

```
Claude Agent SDK ──► Venice Proxy (localhost:4001) ──► api.venice.ai
                     (auto-started, transparent)       (Claude, Llama, Qwen, etc.)
```

---

## Before You Start

You need these installed on your machine:

1. **Node.js 20+** — check with `node -v`. Install from [nodejs.org](https://nodejs.org) or `brew install node`
2. **Docker** — check with `docker -v`. Install from [docker.com](https://docker.com/products/docker-desktop) (make sure it's running)
3. **Claude Code CLI** — install from [claude.ai/download](https://claude.ai/download)
4. **Venice AI API key** — sign up and get one at [venice.ai/settings/api](https://venice.ai/settings/api)
5. **(Optional) Telegram bot token** — create a bot via [@BotFather](https://t.me/BotFather) on Telegram if you want Telegram support

---

## Setup (5 minutes)

### Step 1: Clone and install

```bash
git clone https://github.com/lorenzovenice/nanoclaw-venice.git
cd nanoclaw-venice
npm install
```

### Step 2: Run the setup wizard

```bash
claude
```

This opens Claude Code in your terminal. Then type:

```
/setup
```

Claude Code will walk you through everything interactively:

1. **Venice API key** — paste your key from [venice.ai/settings/api](https://venice.ai/settings/api)
2. **Choose channel** — WhatsApp, Telegram, or both
3. **Container setup** — builds the agent container (Docker must be running)
4. **WhatsApp auth** — scan a QR code (skipped if you chose Telegram-only)
5. **Register main channel** — pick your trigger word and main chat
6. **Start service** — NanoClaw runs in the background automatically

That's it. Send a message to your bot and it will respond.

---

## Manual Setup (Without Claude Code)

If you don't want to use the `/setup` wizard:

```bash
git clone https://github.com/lorenzovenice/nanoclaw-venice.git
cd nanoclaw-venice
npm install
```

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` and add your Venice API key:

```
VENICE_API_KEY=your-key-from-venice-ai
```

For Telegram, also add:

```
TELEGRAM_BOT_TOKEN=your-bot-token-from-botfather
TELEGRAM_ONLY=false
```

Set `TELEGRAM_ONLY=true` if you don't want WhatsApp at all.

Start it:

```bash
npm run dev
```

This launches both the Venice proxy and NanoClaw together.

---

## Using Claude Code Through Venice (Terminal Only)

If you just want to use the Claude Code CLI through Venice (without the WhatsApp/Telegram bot):

```bash
# Terminal 1: start the proxy
cd nanoclaw-venice
npm run proxy

# Terminal 2: use Claude Code
export ANTHROPIC_BASE_URL=http://localhost:4001
export ANTHROPIC_API_KEY=venice-proxy
export VENICE_API_KEY=your-key-here
claude
```

Now every Claude Code interaction goes through Venice AI.

---

## Models

Defaults:
- **CLI:** `claude-opus-4-6`
- **Bot agent:** `claude-sonnet-4-6`

Venice hosts these models directly. Switch anytime:

- **In terminal:** `claude --model llama-3.3-70b`
- **In chat:** "switch to opus" or "use llama-3.3-70b"

Any Venice model ID works — `claude-opus-4-6`, `claude-sonnet-4-6`, `llama-3.3-70b`, `qwen3-4b`, etc.

---

## Talking to Your Bot

Use the trigger word (default `@Andy`) in your registered chat:

```
@Andy what's the weather like today?
@Andy send me an overview of my tasks every weekday morning at 9am
@Andy review the git history for the past week each Friday
```

From the main channel, manage groups and tasks:

```
@Andy list all scheduled tasks
@Andy join the Family Chat group
@Andy pause the Monday briefing
```

---

## Development

```bash
npm run dev          # Start proxy + NanoClaw (hot reload)
npm run proxy        # Start just the Venice proxy
npm run build        # Compile TypeScript
npm test             # Run tests (428 tests)
./container/build.sh # Rebuild agent container
```

Debug the proxy:

```bash
VENICE_PROXY_DEBUG=1 npm run dev
```

---

## Architecture

```
WhatsApp (baileys) ──┐
                     ├──► SQLite ──► Polling loop ──► Container (Claude Agent SDK)
Telegram (grammy) ───┘                                       │
                                                             ▼
                                                  Venice Proxy (localhost:4001)
                                                             │
                                                             ▼
                                                      api.venice.ai
```

Key files:

| File | What it does |
|------|-------------|
| `proxy/venice-proxy.ts` | Translates Anthropic format to OpenAI format for Venice |
| `src/index.ts` | Main orchestrator — message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection via baileys |
| `src/channels/telegram.ts` | Telegram bot via grammy |
| `src/container-runner.ts` | Spawns isolated agent containers |
| `setup/venice.ts` | Venice API key validation setup step |
| `setup/channels.ts` | Channel choice setup step |

---

## FAQ

**Why a proxy?** The Claude Agent SDK speaks Anthropic's API format. Venice speaks OpenAI's format. The proxy translates between them so all SDK features (tool use, streaming, agent swarms) work unchanged.

**Can I use open-source models?** Yes. Tell the bot "switch to llama-3.3-70b" or any Venice model ID.

**Is it secure?** Agents run in Docker containers with filesystem isolation. Your Venice API key is passed via stdin, never written to disk inside containers.

**Something broke?** Run `/debug` in Claude Code, or ask Claude: "Why isn't the bot responding?"

---

Based on [NanoClaw](https://github.com/qwibitai/nanoclaw) by [qwibitai](https://github.com/qwibitai). MIT License.
