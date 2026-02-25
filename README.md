# NanoClaw (Venice API)

A personal AI assistant that runs on your phone via WhatsApp and Telegram — powered by [Venice AI](https://venice.ai) for private, uncensored inference. No Anthropic subscription needed.

---

### Why Venice AI?

[Venice](https://venice.ai) is a privacy-first AI platform. They [don't store or log any prompts or responses](https://venice.ai/privacy) on their servers — your conversations exist only on your device. Requests are encrypted end-to-end through their proxy to decentralized GPU providers, with zero data retention. This means your AI assistant conversations stay private, even from Venice themselves.

Venice provides anonymized access to frontier models (Claude Opus, Claude Sonnet) and fully private access to open-source models (GLM, Qwen) through a single API — switch between them anytime.

| | **Venice AI** | **Traditional AI providers** |
|---|---|---|
| **Data retention** | None — zero logs | Typically 30 days |
| **Prompt privacy** | Encrypted, never stored | Stored on provider servers |
| **Open-source models** | Yes (GLM, Qwen, and others) | No |
| **Frontier models** | Claude, GPT, and others — anonymously | Only through direct subscriptions |
| **Pricing** | Pay-per-token, no subscription | ~$20/mo subscription or pay-per-token API |
| **Uncensored inference** | Yes (open-source models) | No |

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

> **What's "Terminal"?** Every command in this guide runs in your computer's built-in command line app. On **macOS**, open **Terminal** (search for "Terminal" in Spotlight, or find it in Applications → Utilities). On **Linux**, open your terminal emulator. On **Windows**, use **PowerShell** or **WSL**. You'll type or paste commands there and press Enter to run them.

| What | How to get it | How to check you have it |
|------|--------------|--------------------------|
| **Node.js 20+** | [nodejs.org](https://nodejs.org) or `brew install node` (macOS) | Open Terminal, type `node --version` and press Enter — should show v20 or higher |
| **Docker** | [docker.com/products/docker-desktop](https://docker.com/products/docker-desktop) — install and **open it once** so it's running | Open Terminal, type `docker info` and press Enter — should show info, not an error |
| **Claude Code CLI** | [claude.ai/download](https://claude.ai/download) — follow the install instructions for your OS | Open Terminal, type `claude --version` and press Enter — should show a version number |
| **Venice AI API key** | Go to [venice.ai/settings/api](https://venice.ai/settings/api), create an account, generate a key | Copy it somewhere safe — you'll paste it during setup |

**For Telegram** (recommended for first-time users):
1. Open Telegram and search for **@BotFather**
2. Send `/newbot`
3. Follow the prompts — pick a name and username for your bot
4. BotFather will give you a **token** (looks like `123456789:ABCdef...`) — save it, you'll need it during setup

---

## Setup (Step by Step)

The whole setup takes about 10 minutes. You'll need **two Terminal windows** open side by side.

> **Tip:** On macOS you can open a second Terminal window with **Cmd + N**. On Linux, use **Ctrl + Shift + N** or open a new tab.

### Step 1: Clone and install

Open **Terminal** and paste these three commands one at a time (press Enter after each one):

```bash
git clone https://github.com/lorenzovenice/nanoclaw-venice.git
cd nanoclaw-venice
npm install
```

Wait for `npm install` to finish. You should see "added X packages" with no errors.

### Step 2: Start the Venice proxy

Still in the **same Terminal window** from Step 1 (you should still be inside the `nanoclaw-venice` folder).

The proxy is a small local server that translates between Claude Code and Venice AI. It needs to stay running the whole time.

Replace `your-key` below with your actual Venice API key (the one from [venice.ai/settings/api](https://venice.ai/settings/api)), then paste it into Terminal and press Enter:

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

### Step 3: Launch Claude Code (in a new Terminal window)

Open a **second Terminal window** (Cmd + N on macOS, Ctrl + Shift + N on Linux). **Don't close the first one** — the proxy needs to keep running in it.

Paste these two commands into the **new** Terminal window and press Enter:

```bash
cd nanoclaw-venice
ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude
```

Claude Code will start up. It may ask "Do you want to use this API key?" — **select Yes**.

> **Important:** The `cd nanoclaw-venice` command tells Terminal to go into the project folder. You must run this first, otherwise the `/setup` command in the next step won't appear.

### Step 4: Run the setup wizard

In your **second Terminal window** (the one running Claude Code), type this and press Enter:

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

This is what you used during setup. You can open it anytime to manage your bot — just open Terminal and paste:

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

The proxy can occasionally crash on connection errors. Open Terminal and restart it:

```bash
cd nanoclaw-venice
VENICE_API_KEY=your-key npm run proxy
```

**For a more stable setup**, install pm2 (a process manager that auto-restarts crashed processes). Run these in Terminal:

```bash
npm install -g pm2
VENICE_API_KEY=your-key pm2 start "npx tsx proxy/venice-proxy.ts" --name venice-proxy
```

Useful pm2 commands (run these in Terminal anytime):
```bash
pm2 logs venice-proxy     # view proxy logs
pm2 restart venice-proxy  # restart the proxy
pm2 stop venice-proxy     # stop the proxy
pm2 status                # see if it's running
```

### Claude Code says "Please run /login" or shows a 403 error

This means the proxy isn't running or something went wrong with the connection.

1. Check the Terminal window running the proxy is still open and showing output (Step 2)
2. Make sure you ran `cd nanoclaw-venice` in your second Terminal window before launching Claude Code (Step 3)
3. Try closing both Terminal windows, then start fresh from Step 2

### Model errors ("model does not exist")

This usually means the bot tried to use a model that isn't available on Venice. This shouldn't happen with normal use — the proxy handles model translation automatically. If you see this error, try restarting the proxy and the bot. If it keeps happening, let us know which model name appeared in the error.

### The bot doesn't respond to messages

1. Make sure the trigger word matches what you set during setup
2. Open Terminal and run `docker info` — if you see an error, open Docker Desktop first
3. Open Terminal and run `cd nanoclaw-venice && tail -f logs/nanoclaw.log` to see live logs
4. Check container logs: open the files in `groups/main/logs/` (look for the most recent `container-*.log` file)
5. Make sure the Venice proxy is running (check the Terminal window from Step 2)

### Container build fails

Make sure Docker Desktop is open and running. On macOS, open it from your Applications folder. On Linux, run `sudo systemctl start docker`. Then retry the build.

### WhatsApp disconnected

Open Terminal and run these commands to re-authenticate:

```bash
cd nanoclaw-venice
npm run auth
```

Scan the QR code with your phone, then restart the bot:

macOS (paste into Terminal): `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
Linux (paste into Terminal): `systemctl --user restart nanoclaw`

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

Open **Terminal** and paste (replace `your-key` with your Venice API key):
```bash
cd nanoclaw-venice
VENICE_API_KEY=your-key npm run proxy
```

Leave that running. Open a **second Terminal window** (Cmd + N on macOS) and paste:
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
