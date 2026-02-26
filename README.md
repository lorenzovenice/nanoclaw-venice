# NanoClaw (Venice API)

A personal AI assistant that runs on your phone via WhatsApp and Telegram — powered by [Venice AI](https://venice.ai) for private, uncensored inference. No Anthropic subscription needed.

---

### Why Venice AI?

[Venice](https://venice.ai) is a privacy-first AI platform. They [don't store or log any prompts or responses](https://venice.ai/privacy) on their servers — your conversations exist only on your device. Requests are encrypted end-to-end through their proxy to decentralized GPU providers, with zero data retention. This means your AI assistant conversations stay private, even from Venice themselves.

Venice provides anonymized access to frontier models (Claude Opus, Claude Sonnet) and fully private access to open-source models (GLM, Qwen) through a single API — switch between them anytime.

| | **Venice AI** | **Traditional AI providers** |
|---|---|---|
| **Data retention** | None — zero logs | Yes |
| **Prompt privacy** | Encrypted, never stored | Stored on provider servers |
| **Open-source models** | Yes (GLM, Qwen, and others) | No |
| **Frontier models** | Claude, GPT, and others — anonymously | Only through direct subscriptions |
| **Pricing** | Pay-per-token, no subscription. Or stake [DIEM](https://venice.ai/lp/diem) for daily refreshing credits | $20–200/mo subscriptions or pay-per-token API |
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

The whole setup takes about 10 minutes. You only need **one Terminal window**.

### Step 1: Clone and install

Open **Terminal** and paste these three commands one at a time (press Enter after each one):

```bash
git clone https://github.com/lorenzovenice/nanoclaw-venice.git
cd nanoclaw-venice
npm install
```

Wait for `npm install` to finish. You should see "added X packages" with no errors.

### Step 2: Launch Claude Code with Venice

Still in the **same Terminal window**, paste this and press Enter:

```bash
ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude
```

Claude Code will start up. It may ask "Do you want to use this API key?" — **select Yes**.

> **Important:** You must be inside the `nanoclaw-venice` folder for the `/setup` command to appear in the next step.

### Step 3: Run the setup wizard

In your Terminal window (the one running Claude Code), type this and press Enter:

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
9. **Start services** — NanoClaw and the Venice proxy both start as background services

The setup wizard installs two background services:
- **NanoClaw** — the bot itself
- **Venice proxy** — a small local server (localhost:4001) that translates between Claude Code and Venice AI

Both start automatically on boot and restart themselves if they crash. No terminal window needed.

> **If the wizard stops between steps:** Type "continue" or "next step" to nudge it forward. This can happen with some models.

### Step 4: Talk to your bot

Once setup is complete, open your chat (Telegram or WhatsApp) and send:

```
@Andy hello, are you there?
```

The bot should respond within a few seconds. If this is your main channel, you can just type normally without the `@Andy` prefix.

**You can now close the terminal window.** Everything runs as background services and starts automatically when your computer boots.

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

### The proxy isn't running

The Venice proxy runs as a background service and restarts itself automatically. If it's not working:

**macOS:**
```bash
# Check if it's running
launchctl list | grep venice-proxy

# Restart it
launchctl kickstart -k gui/$(id -u)/com.nanoclaw.venice-proxy

# Check logs
tail -f ~/nanoclaw-venice/logs/venice-proxy.log
```

**Linux:**
```bash
# Check if it's running
systemctl --user status nanoclaw-venice-proxy

# Restart it
systemctl --user restart nanoclaw-venice-proxy

# Check logs
tail -f ~/nanoclaw-venice/logs/venice-proxy.log
```

### Claude Code says "Please run /login" or shows a 403 error

This means Claude Code can't connect to the Venice proxy. Check that the proxy service is running (see above), then try:

1. **Make sure you're in the right folder.** Open Terminal and paste:
   ```bash
   cd nanoclaw-venice
   ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude
   ```

2. **Still not working?** Restart the proxy service (see above) and try again.

### Model errors ("model does not exist")

This means the bot tried to use a model that Venice doesn't have. The proxy translates model names automatically, so this shouldn't happen with normal use. To fix it:

1. **Restart the proxy:**
   - macOS: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw.venice-proxy`
   - Linux: `systemctl --user restart nanoclaw-venice-proxy`

2. **Restart the bot:**
   - macOS: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
   - Linux: `systemctl --user restart nanoclaw`

3. If it keeps happening, check which models are available on Venice at [docs.venice.ai/models/overview](https://docs.venice.ai/models/overview) and tell the bot to switch to one of those (e.g., "switch to claude-sonnet-4-6").

### The bot doesn't respond to messages

Work through these steps in order until it starts working:

1. **Check your trigger word.** Make sure you're using the right prefix (e.g., `@Andy hello`). In your main channel, you might not need the prefix at all — just type normally.

2. **Check Docker is running.** Open **Terminal** and paste:
   ```bash
   docker info
   ```
   If you see an error like "Cannot connect to the Docker daemon", open **Docker Desktop** from your Applications folder (macOS) or run `sudo systemctl start docker` (Linux), wait 10 seconds, then try `docker info` again.

3. **Check the Venice proxy is running.** Look at the Terminal window where you started the proxy. It should show `Venice API proxy listening on http://localhost:4001`. If it crashed, restart it (see "The proxy crashed" above).

4. **Check the bot logs.** Open Terminal and paste:
   ```bash
   cd nanoclaw-venice
   tail -f logs/nanoclaw.log
   ```
   This shows live logs — send a message to your bot and watch for errors here. Press **Ctrl + C** to stop watching logs.

5. **Check container logs.** Open the `nanoclaw-venice/groups/main/logs/` folder in Finder (macOS) or your file manager (Linux). Open the most recent file that starts with `container-` — it contains the bot's detailed output.

6. **Restart everything.** If nothing above works, restart both the proxy and the bot:
   - Restart the proxy: see "The proxy crashed" above
   - Restart the bot — open Terminal and paste:
     - macOS: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
     - Linux: `systemctl --user restart nanoclaw`

### Container build fails during setup

This means Docker couldn't build the bot's container. To fix it:

1. **Make sure Docker Desktop is open and running.** On macOS, find it in your Applications folder and open it. On Linux, open Terminal and paste `sudo systemctl start docker`.
2. Wait about 10 seconds for Docker to fully start.
3. Go back to the Claude Code setup wizard and type `continue` to retry the build.

### WhatsApp disconnected

Your WhatsApp session can expire if you haven't used the bot in a while. To reconnect:

1. Open **Terminal** and paste:
   ```bash
   cd nanoclaw-venice
   npm run auth
   ```
2. A QR code will appear in Terminal. Open **WhatsApp** on your phone, go to **Settings → Linked Devices → Link a Device**, and scan the QR code.
3. Once connected, restart the bot. Open a new Terminal window and paste:
   - macOS: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
   - Linux: `systemctl --user restart nanoclaw`

---

## Models

| Context | Default Model | How to switch |
|---------|--------------|---------------|
| Bot (in chat) | `claude-sonnet-4-6` | Tell the bot: "switch to opus" or "use zai-org-glm-5" |
| Claude Code CLI | `claude-opus-4-6` | Use `/model` in Claude Code or `claude --model <name>` |

Available Venice models include `claude-opus-4-6`, `claude-sonnet-4-6`, `zai-org-glm-5`, and more. See the full list at [docs.venice.ai/models/overview](https://docs.venice.ai/models/overview).

---

## Using Claude Code Through Venice (No Bot)

If you just want to use Claude Code with Venice AI and don't need the WhatsApp/Telegram bot, the proxy service needs to be running. If you've already run `/setup`, it's already running as a background service.

To start a Claude Code session through Venice, open **Terminal** and paste:
```bash
cd nanoclaw-venice
ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude
```

That's it. The proxy is already running in the background.

**Tip:** Add this to your `~/.zshrc` (or `~/.bashrc`) so you can quickly switch any terminal to Venice:
```bash
alias venice='export ANTHROPIC_BASE_URL=http://localhost:4001 && export ANTHROPIC_API_KEY=venice-proxy && echo "Using Venice API"'
alias anthropic='unset ANTHROPIC_BASE_URL && unset ANTHROPIC_API_KEY && echo "Using Anthropic API"'
```

Then just type `venice` in any terminal before running `claude` to use Venice, or `anthropic` to switch back to your Anthropic subscription.

---

## Advanced

### Give the bot access to files on your computer

By default, the bot is completely walled off from your computer — it can only see its own memory and conversation history. This is the safe default.

If you want the bot to be able to read or edit files on your machine (for example, a project folder or documents), you can give it access:

- **During setup:** When the wizard asks about directory access, choose "Yes" and tell it which folders to share
- **After setup:** Open the Claude Code admin tool (see [How It Works](#how-it-works-the-two-layers)) and run `/customize` to change what the bot can access

### Manually starting and stopping services

NanoClaw runs two background services that start automatically on boot. If you ever need to manually manage them:

**macOS:**
| Action | Command (paste into Terminal) |
|--------|------|
| Start the bot | `launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist` |
| Stop the bot | `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist` |
| Restart the bot | `launchctl kickstart -k gui/$(id -u)/com.nanoclaw` |
| Start the proxy | `launchctl load ~/Library/LaunchAgents/com.nanoclaw.venice-proxy.plist` |
| Stop the proxy | `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.venice-proxy.plist` |
| Restart the proxy | `launchctl kickstart -k gui/$(id -u)/com.nanoclaw.venice-proxy` |

**Linux:**
| Action | Command (paste into Terminal) |
|--------|------|
| Start the bot | `systemctl --user start nanoclaw` |
| Stop the bot | `systemctl --user stop nanoclaw` |
| Restart the bot | `systemctl --user restart nanoclaw` |
| Start the proxy | `systemctl --user start nanoclaw-venice-proxy` |
| Stop the proxy | `systemctl --user stop nanoclaw-venice-proxy` |
| Restart the proxy | `systemctl --user restart nanoclaw-venice-proxy` |

### Running multiple bots on the same computer

You can run multiple NanoClaw bots on the same machine (e.g., one for personal use and one for a team). Just clone the repo into a different folder and run setup again. Note: they share the same Docker image, so rebuilding one affects all of them.

### For developers

These commands are for people who want to modify NanoClaw's code. Open Terminal, `cd` into the `nanoclaw-venice` folder, and run:

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
