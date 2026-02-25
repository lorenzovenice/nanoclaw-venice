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

The proxy can occasionally crash on connection errors. To restart it:

1. Open **Terminal** (or find the Terminal window that was running the proxy — it may show an error)
2. Paste these two commands and press Enter:
   ```bash
   cd nanoclaw-venice
   VENICE_API_KEY=your-key npm run proxy
   ```
   (Replace `your-key` with your actual Venice API key)
3. You should see `Venice API proxy listening on http://localhost:4001` — that means it's working again
4. **Leave this Terminal window open** — the proxy needs to keep running

**Tired of restarting the proxy manually?** You can install pm2, a tool that automatically restarts the proxy if it crashes. Open Terminal and paste:

```bash
npm install -g pm2
```

Then start the proxy through pm2 (replace `your-key` with your Venice API key):

```bash
cd nanoclaw-venice
VENICE_API_KEY=your-key pm2 start "npx tsx proxy/venice-proxy.ts" --name venice-proxy
```

Now you can close the Terminal window — pm2 keeps the proxy running in the background and restarts it automatically if it crashes. Here are some useful pm2 commands you can paste into Terminal anytime:

| What you want to do | Command (paste into Terminal) |
|---------------------|------|
| Check if the proxy is running | `pm2 status` |
| View proxy logs | `pm2 logs venice-proxy` |
| Restart the proxy | `pm2 restart venice-proxy` |
| Stop the proxy | `pm2 stop venice-proxy` |

### Claude Code says "Please run /login" or shows a 403 error

This means Claude Code can't connect to the Venice proxy. Here's how to fix it:

1. **Check the proxy is running.** Look at the Terminal window where you started the proxy (Step 2 of setup). It should still show `Venice API proxy listening on http://localhost:4001`. If the window is closed or shows an error, restart the proxy (see above).

2. **Make sure you're in the right folder.** Open a **new Terminal window** and paste:
   ```bash
   cd nanoclaw-venice
   ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude
   ```
   The `cd nanoclaw-venice` part is critical — Claude Code won't work if you skip it.

3. **Still not working?** Close all Terminal windows and start fresh:
   - Open Terminal, paste `cd nanoclaw-venice && VENICE_API_KEY=your-key npm run proxy` (replace `your-key`)
   - Open a second Terminal window (Cmd + N on macOS), paste `cd nanoclaw-venice && ANTHROPIC_BASE_URL=http://localhost:4001 ANTHROPIC_API_KEY=venice-proxy claude`

### Model errors ("model does not exist")

This means the bot tried to use a model that Venice doesn't have. This shouldn't happen with normal use — the proxy translates model names automatically. To fix it:

1. **Restart the proxy.** Open Terminal and paste:
   ```bash
   cd nanoclaw-venice
   VENICE_API_KEY=your-key npm run proxy
   ```
   (Or if you're using pm2: paste `pm2 restart venice-proxy` into Terminal)

2. **Restart the bot.** Open a new Terminal window and paste:
   - macOS: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw`
   - Linux: `systemctl --user restart nanoclaw`

3. If it keeps happening, note the exact model name from the error message and let us know.

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

### Give the bot access to files on your computer

By default, the bot is completely walled off from your computer — it can only see its own memory and conversation history. This is the safe default.

If you want the bot to be able to read or edit files on your machine (for example, a project folder or documents), you can give it access:

- **During setup:** When the wizard asks about directory access, choose "Yes" and tell it which folders to share
- **After setup:** Open the Claude Code admin tool (see [How It Works](#how-it-works-the-two-layers)) and run `/customize` to change what the bot can access

### Manually starting and stopping the bot

The bot runs as a background service — it starts automatically when your computer boots. If you ever need to manually start, stop, or restart it, open Terminal and paste the command for your system:

**macOS:**
| Action | Command (paste into Terminal) |
|--------|------|
| Start the bot | `launchctl load ~/Library/LaunchAgents/com.nanoclaw.plist` |
| Stop the bot | `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist` |
| Restart the bot | `launchctl kickstart -k gui/$(id -u)/com.nanoclaw` |

**Linux:**
| Action | Command (paste into Terminal) |
|--------|------|
| Start the bot | `systemctl --user start nanoclaw` |
| Stop the bot | `systemctl --user stop nanoclaw` |
| Restart the bot | `systemctl --user restart nanoclaw` |

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
