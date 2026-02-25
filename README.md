# NanoClaw (Venice API)

A personal AI assistant that runs on your phone via WhatsApp and Telegram — powered by [Venice AI](https://venice.ai) for private, uncensored inference. No Anthropic subscription needed.

---

### Why Venice AI?

[Venice](https://venice.ai) is a privacy-first AI platform. They [don't store or log any prompts or responses](https://venice.ai/privacy) on their servers — your conversations exist only on your device. Requests are encrypted end-to-end through their proxy to decentralized GPU providers, with zero data retention. This means your AI assistant conversations stay private, even from Venice themselves.

Venice provides anonymized access to frontier models (Claude Opus, Claude Sonnet) and fully private access to open-source models (GLM, Qwen) through a single API — switch between them anytime.

| | **Venice AI** | **Anthropic (Claude)** | **OpenAI (ChatGPT)** |
|---|---|---|---|
| **Data retention** | None — zero logs | 30 days | 30 days |
| **Prompt privacy** | Encrypted, never stored | Stored for safety | Stored for training (opt-out available) |
| **Open-source models** | Yes (GLM, Qwen, and others) | No | No |
| **Frontier models** | Claude Opus, Sonnet via proxy | Native | GPT-4o, o1 |
| **Pricing** | Pay-per-token, no subscription | $20/mo Pro or API | $20/mo Plus or API |
| **Uncensored inference** | Yes (open-source models) | No | No |

### Why NanoClaw over OpenClaw?

[OpenClaw](https://github.com/nicferrier/openclaw) is the original full-featured platform. [NanoClaw](https://github.com/qwibitai/nanoclaw) is a lightweight alternative built for simplicity and real security. This fork adds Venice AI support so everything runs privately without an Anthropic subscription.

| | **NanoClaw (Venice)** | **OpenClaw** |
|---|---|---|
| **Codebase** | ~2,000 lines, handful of files | ~500,000 lines, 53 config files |
| **Dependencies** | ~15 packages | 70+ packages |
| **Security model** | OS-level Docker container isolation | Application-level allowlists and pairing codes |
| **Per-group isolation** | Each group gets its own container, filesystem, and memory | Shared process, shared memory |
| **Setup** | One wizard (`/setup`), ~10 minutes | Manual multi-step configuration |
| **AI provider** | Venice AI (private, no subscription) | Anthropic (requires API key or subscription) |
| **Customization** | Edit the code directly — it's small enough to read | Config files and plugins |
| **Target user** | One person, one bot | Multi-user platform |

---

## What You Get Out of the Box

- A personal AI assistant on **Telegram** and/or **WhatsApp**
- Powered by **Venice AI** — no Anthropic account needed
- Bot runs in an **isolated Docker container** (sandboxed, can't access your system)
- **Model switching** — tell the bot "switch to zai-org-glm-5" or "use opus" anytime
- **Scheduled tasks** — set reminders, recurring tasks
- **Web search and browsing** built in
- **Markdown formatting** in Telegram messages

---

## Before You Start

You need these four things. If you don't have them, the setup wizard will try to help you install them — but it's easiest if you install them first.

| What | How to get it | How to check you have it |
|------|--------------|--------------------------|
| **Node.js 20+** | [nodejs.org](https://nodejs.org) or `brew install node` (macOS) | Run `node --version` — should show v20 or higher |
| **Docker** | [docker.com/products/docker-desktop](https://docker.com/products/docker-desktop) — install and **open it** | Run `docker info` — should show info, not an error |
| **Claude Code CLI** | [claude.ai/download](https://claude.ai/download) | Run `claude --version` — should show a version number |
| **Venice AI API key** | Go to [venice.ai/settings/api](https://venice.ai/settings/api), create an account, generate a key | Copy it somewhere — you'll paste it during setup |

**For Telegram** (recommended for first-time users):
1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Follow the prompts — pick a name and username for your bot
4. BotFather will give you a **token** (looks like `123456789:ABCdef...`) — save it, you'll need it during setup

---

## Setup (Step by Step)

The whole setup takes about 10 minutes. You'll need **two terminal windows** open side by side.

### Step 1: Clone and install

Open a terminal and run these three commands:

```bash
git clone https://github.com/lorenzovenice/nanoclaw-venice.git
cd nanoclaw-venice
npm install
```

Wait for `npm install` to finish. You should see "added X packages" with no errors.

### Step 2: Start the Venice proxy

The proxy is a small local server that translates between Claude Code and Venice AI. It needs to stay running the whole time.

Replace `your-key` below with your actual Venice API key (the one from [venice.ai/settings/api](https://venice.ai/settings/api)):

```bash
VENICE_API_KEY=your-key npm run proxy
```

You should see:
```
Venice API proxy listening on http://localhost:4001
Forwarding to: https://api.venice.ai/api/v1
```

**Leave this terminal window open.** Don't close it or press anything — the proxy needs to keep running.

> **If the proxy crashes:** It can occasionally crash on connection errors. Just run the same command again. See [Troubleshooting](#troubleshooting) for a more stable option using pm2.

### Step 3: Launch Claude Code (in a new terminal)

Open a **second terminal window**. Don't close the first one — the proxy needs to stay running.

Run this command (make sure you're in the nanoclaw-venice folder):

```bash
cd nanoclaw-venice
ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude
```

Claude Code will start up. It may ask "Do you want to use this API key?" — **select Yes**.

> **Important:** You must be inside the `nanoclaw-venice` folder when you run this. If you're in a different folder, the `/setup` command won't appear.

### Step 4: Run the setup wizard

Inside Claude Code, type:

```
/setup
```

The wizard will walk you through everything automatically:

1. **Bootstrap** — checks your Node.js version and dependencies are working
2. **Venice API key** — validates your key and saves it so you don't need to type it again
3. **Channel choice** — pick WhatsApp, Telegram, or both
4. **Container build** — downloads and builds the Docker container for the agent (this takes a few minutes the first time — that's normal)
5. **WhatsApp auth** — scan a QR code with your phone (skipped if you picked Telegram-only)
6. **Telegram setup** — the wizard will ask you to send a message to your bot so it can detect your chat automatically
7. **Trigger word** — what prefix activates the bot (default: `@Andy`). Your main channel won't need the prefix
8. **Mount directories** — pick "No" for now. You can add external directory access later
9. **Start service** — NanoClaw starts running in the background

> **If the wizard stops between steps:** Type "continue" or "next step" to nudge it forward. This can happen with some models.

### Step 5: Talk to your bot

Once setup is complete, open your chat (Telegram or WhatsApp) and send:

```
@Andy hello, are you there?
```

The bot should respond within a few seconds. If this is your main channel, you can just type normally without the `@Andy` prefix.

**You can now close both terminal windows.** The bot runs as a background service and starts automatically when your computer boots.

---

## How It Works (The Two Layers)

There are two parts to NanoClaw that you interact with:

### 1. Claude Code CLI (the admin tool)

This is what you used during setup. You can open it anytime to manage your bot:

```bash
cd nanoclaw-venice
ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude
```

Use it to run `/setup`, `/debug`, `/customize`, or make changes to the bot's behavior. It has full access to the project files.

### 2. The bot (in your chat)

This is the AI that responds to your messages in Telegram/WhatsApp. It runs inside an **isolated Docker container** — it can only access its own memory files and any directories you explicitly allowed during setup. It cannot access your computer, your files, or the internet (except through built-in web search tools).

---

## Troubleshooting

### The proxy crashed

The proxy can occasionally crash on connection errors. Just restart it:

```bash
cd nanoclaw-venice
VENICE_API_KEY=your-key npm run proxy
```

**For a more stable setup**, install pm2 (a process manager that auto-restarts crashed processes):

```bash
npm install -g pm2
VENICE_API_KEY=your-key pm2 start "npx tsx proxy/venice-proxy.ts" --name venice-proxy
```

Useful pm2 commands:
```bash
pm2 logs venice-proxy     # view proxy logs
pm2 restart venice-proxy  # restart the proxy
pm2 stop venice-proxy     # stop the proxy
pm2 status                # see if it's running
```

### Claude Code says "Please run /login" or shows a 403 error

This means the proxy isn't running or something went wrong with the connection.

1. Check your proxy terminal is still running (Step 2)
2. Make sure you ran the `cd nanoclaw-venice` command before launching Claude Code (Step 3)
3. Try restarting the proxy and Claude Code

### Model errors ("model does not exist")

The proxy automatically maps common model names to Venice equivalents. If you see a model error, it means a model name was used that Venice doesn't have. The proxy already handles the most common ones (Haiku, Sonnet 4.5). If you see a new one, you can add it to the `MODEL_MAP` in `proxy/venice-proxy.ts`.

### The bot doesn't respond to messages

1. Make sure the trigger word matches what you set during setup
2. Check Docker is running: `docker info`
3. Check the logs: `tail -f logs/nanoclaw.log`
4. Check container logs: look in `groups/main/logs/container-*.log`
5. Make sure the Venice proxy is running

### Container build fails

Make sure Docker Desktop is open and running. On macOS, open it from your Applications folder. On Linux, run `sudo systemctl start docker`. Then retry the build.

### WhatsApp disconnected

Run `npm run auth` in the nanoclaw-venice folder, scan the QR code again, then restart:

macOS: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
Linux: `systemctl --user restart nanoclaw`

---

## Models

| Context | Default Model | How to switch |
|---------|--------------|---------------|
| Bot (in chat) | `claude-sonnet-4-6` | Tell the bot: "switch to opus" or "use zai-org-glm-5" |
| Claude Code CLI | `claude-opus-4-6` | Use `/model` in Claude Code or `claude --model <name>` |

Available Venice models include `claude-opus-4-6`, `claude-sonnet-4-6`, `zai-org-glm-5`, and more. See the full list at [docs.venice.ai/models/overview](https://docs.venice.ai/models/overview).

---

## Using Claude Code Through Venice (No Bot)

If you just want to use Claude Code with Venice AI and don't need the WhatsApp/Telegram bot:

**Terminal 1** (leave running):
```bash
cd nanoclaw-venice
VENICE_API_KEY=your-key npm run proxy
```

**Terminal 2:**
```bash
cd nanoclaw-venice
ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude
```

That's it. You now have Claude Code running through Venice.

---

## Advanced

### Give the bot access to project files

By default, the bot runs in a sandboxed container with no access to your machine's files. This is the secure default. If you want the bot to read or edit its own source code (for self-modification or debugging), you can add mount directories:

- During setup: choose "Yes" at the mount directories step and provide the paths
- After setup: re-run the mounts step in Claude Code: `npx tsx setup/index.ts --step mounts`

### Multiple instances on the same machine

If you run multiple NanoClaw instances on the same machine, they share the Docker image name `nanoclaw-agent:latest`. Building the container in one instance replaces the image for all instances. Running containers are not affected, but be aware of this if you maintain multiple bots.

### Service management

macOS:
```bash
launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist      # start
launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist    # stop
launchctl kickstart -k gui/$(id -u)/com.nanoclaw              # restart
```

Linux:
```bash
systemctl --user start nanoclaw    # start
systemctl --user stop nanoclaw     # stop
systemctl --user restart nanoclaw  # restart
```

### Development

```bash
npm run dev          # Start proxy + NanoClaw with hot reload
npm run proxy        # Start just the Venice proxy
npm run build        # Compile TypeScript
npm test             # Run tests
./container/build.sh # Rebuild agent container
```

---

## Architecture

```
You (WhatsApp/Telegram)
        |
        v
   NanoClaw (Node.js process)
        |
        v
   Docker Container (isolated sandbox)
        |
        v
   Venice Proxy (localhost:4001)
        |
        v
   api.venice.ai (private inference)
```

| File | What it does |
|------|-------------|
| `proxy/venice-proxy.ts` | Translates Anthropic format to OpenAI format for Venice |
| `src/index.ts` | Main orchestrator — message loop, agent invocation |
| `src/channels/whatsapp.ts` | WhatsApp connection via baileys |
| `src/channels/telegram.ts` | Telegram bot via grammy |
| `src/container-runner.ts` | Spawns isolated agent containers |

---

## FAQ

**Why do I need a proxy?** The Claude Agent SDK speaks Anthropic's message format. Venice speaks OpenAI's format. The proxy translates between them so everything works without modifying the SDK.

**Can I use open-source models?** Yes. Venice hosts many models. Tell the bot "switch to zai-org-glm-5" or any Venice model ID.

**Is it secure?** Agents run in Docker containers with real OS-level isolation. The Venice API key is passed via stdin, never written to disk inside containers. Each group gets its own isolated environment.

**Do I need an Anthropic subscription?** No. Everything runs through Venice AI. You only need a Venice API key.

**Can I use this on a server?** Yes. It works on any Linux machine with Docker. Use the systemd service for auto-start on boot.

---

Based on [NanoClaw](https://github.com/qwibitai/nanoclaw). MIT License.
