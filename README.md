# NanoClaw (Venice API)

A personal AI assistant that runs on your phone via WhatsApp and Telegram — powered by [Venice AI](https://venice.ai) for private, uncensored inference. No Anthropic subscription needed.

### Why Venice AI?

[Venice](https://venice.ai) is a privacy-first AI platform. They [don't store or log any prompts or responses](https://venice.ai/privacy) on their servers — your conversations exist only on your device. Requests are encrypted end-to-end through their proxy to decentralized GPU providers, with zero data retention. This means your AI assistant conversations stay private, even from Venice themselves.

Venice also hosts both frontier models (Claude Opus, Claude Sonnet) and open-source models (Llama, Qwen) through a single API — switch between them anytime.

### Why NanoClaw over OpenClaw?

[OpenClaw](https://github.com/nicferrier/openclaw) has nearly half a million lines of code, 53 config files, and 70+ dependencies. Its security is at the application level — allowlists and pairing codes. Everything runs in one process with shared memory.

[NanoClaw](https://github.com/qwibitai/nanoclaw) is the same core functionality in a codebase small enough to actually understand: one process and a handful of files. Agents run in isolated Linux containers with real OS-level sandboxing — not just permission checks. Each group gets its own filesystem, memory, and container. The codebase is small enough that you can read it, audit it, and have Claude modify it for your needs.

This fork adds a lightweight translation proxy so everything runs through Venice AI instead of Anthropic directly.

---

## Prerequisites

| What | How to get it |
|------|--------------|
| **Node.js 20+** | [nodejs.org](https://nodejs.org) or `brew install node` |
| **Docker** | [docker.com/products/docker-desktop](https://docker.com/products/docker-desktop) — make sure it's running |
| **Claude Code CLI** | [claude.ai/download](https://claude.ai/download) |
| **Venice AI API key** | [venice.ai/settings/api](https://venice.ai/settings/api) |
| **Telegram bot token** (optional) | Message [@BotFather](https://t.me/BotFather) on Telegram → `/newbot` → copy the token |

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/lorenzovenice/nanoclaw-venice.git
cd nanoclaw-venice
npm install
```

### 2. Start the Venice proxy

Replace `your-venice-api-key` with your actual key from [venice.ai/settings/api](https://venice.ai/settings/api):

```bash
VENICE_API_KEY=your-venice-api-key npm run proxy
```

You should see:
```
Venice API proxy listening on http://localhost:4001
```

Leave this terminal running.

### 3. Open a new terminal and launch Claude Code through Venice

```bash
cd nanoclaw-venice
ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude
```

This starts Claude Code powered by your Venice API key. You'll see the Claude Code prompt.

### 4. Run the setup wizard

Inside Claude Code, type:

```
/setup
```

The wizard walks you through:

1. **Venice API key** — saves it to `.env` so you won't need to pass it manually again
2. **Channel choice** — WhatsApp, Telegram, or both
3. **Container build** — builds the agent Docker container
4. **WhatsApp auth** — scan a QR code (skipped if Telegram-only)
5. **Register main channel** — pick your trigger word (default: `@Andy`)
6. **Start service** — NanoClaw runs in the background

After setup completes, you can stop the proxy from step 2 — the background service starts its own.

### 5. Talk to your bot

Send a message in your registered chat:

```
@Andy hello, are you there?
```

---

## Manual Setup (No Setup Wizard)

If you prefer to skip the wizard and configure everything by hand:

```bash
git clone https://github.com/lorenzovenice/nanoclaw-venice.git
cd nanoclaw-venice
npm install
cp .env.example .env
```

Edit `.env`:

```bash
# Required
VENICE_API_KEY=your-key-from-venice-ai

# Already set — don't change these
ANTHROPIC_BASE_URL=http://localhost:4001
ANTHROPIC_API_KEY=venice-proxy

# For Telegram (optional)
TELEGRAM_BOT_TOKEN=your-token-from-botfather
TELEGRAM_ONLY=false    # set to true to skip WhatsApp entirely
```

Build the container and start:

```bash
./container/build.sh
npm run dev
```

If WhatsApp is enabled, a QR code appears in the terminal — scan it with your phone.

---

## Models

| Context | Default |
|---------|---------|
| Claude Code CLI | `claude-opus-4-6` |
| WhatsApp/Telegram bot | `claude-sonnet-4-6` |

Venice hosts these Claude models directly. Switch to any Venice model:

- **In terminal:** `claude --model llama-3.3-70b`
- **In chat:** "switch to llama-3.3-70b" or "use opus"

Works with `claude-opus-4-6`, `claude-sonnet-4-6`, `llama-3.3-70b`, `qwen3-4b`, and anything else on [Venice](https://docs.venice.ai/models/overview).

---

## Using Claude Code Through Venice (Terminal Only)

Don't need the WhatsApp/Telegram bot? Just use Claude Code with Venice:

**Terminal 1:**
```bash
cd nanoclaw-venice
VENICE_API_KEY=your-key npm run proxy
```

**Terminal 2:**
```bash
ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude
```

---

## Development

```bash
npm run dev          # Start proxy + NanoClaw with hot reload
npm run proxy        # Start just the Venice proxy
npm run build        # Compile TypeScript
npm test             # Run tests
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

| File | What it does |
|------|-------------|
| `proxy/venice-proxy.ts` | Translates Anthropic format ↔ OpenAI format for Venice |
| `src/index.ts` | Main orchestrator — message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection via baileys |
| `src/channels/telegram.ts` | Telegram bot via grammy |
| `src/container-runner.ts` | Spawns isolated agent containers |

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| Proxy won't start | Check your `VENICE_API_KEY` is valid at [venice.ai/settings/api](https://venice.ai/settings/api) |
| `claude` command not found | Install Claude Code CLI from [claude.ai/download](https://claude.ai/download) |
| Container build fails | Make sure Docker is running: `docker info` |
| Bot not responding | Check trigger word matches. Check `logs/nanoclaw.log` |
| Venice API errors | Test proxy: `curl http://localhost:4001/v1/models` |

Or run `/debug` inside Claude Code.

---

## FAQ

**Why a proxy?** The Claude Agent SDK uses Anthropic's message format. Venice uses OpenAI's. The proxy translates between them so all SDK features work unchanged.

**Can I use open-source models?** Yes. Venice hosts many models — tell the bot "switch to llama-3.3-70b".

**Is it secure?** Agents run in Docker containers with filesystem isolation. Venice API key is passed via stdin, never written to disk inside containers.

---

Based on [NanoClaw](https://github.com/qwibitai/nanoclaw). MIT License.
