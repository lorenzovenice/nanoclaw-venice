---
name: setup
description: Run initial NanoClaw (Venice API) setup. Use when user wants to install dependencies, configure Venice API, choose messaging channels, authenticate WhatsApp/Telegram, register their main channel, or start the background services. Triggers on "setup", "install", "configure nanoclaw", or first-time setup requests.
---

# NanoClaw (Venice API) Setup

## CRITICAL RULES — Read Before Anything

1. **NEVER stop between steps.** After each successful step, IMMEDIATELY run the next step's command. Do NOT summarize, do NOT ask "should I continue?", do NOT wait for input unless a step explicitly requires it (marked with AskUserQuestion below).
2. **After every AskUserQuestion answer, IMMEDIATELY run the next command.** When you receive an answer from the user, execute the corresponding command on the very next action. Never summarize the answer, never confirm, never pause.
3. **Fix problems yourself.** If something is broken or missing, fix it. Don't tell the user to go fix it themselves unless it genuinely requires their physical action (scanning a QR code, pasting a secret they have). If a dependency is missing, install it. If a service won't start, diagnose and repair.
4. **NEVER run sudo commands without asking first.** Always use AskUserQuestion to get explicit permission before running any command that requires root/sudo access.
5. **If a step fails twice, STOP and ask the user.** Do not retry the same command more than twice. If it fails twice, use AskUserQuestion to present the error and ask how to proceed. Do NOT enter retry loops.
6. **Use AskUserQuestion for ALL user questions.** Never use a bare text prompt — always use the AskUserQuestion tool so the user gets clickable options.
7. **The proxy is already running.** The user started the Venice proxy before launching Claude Code. You do NOT need to start it. If you need to test connectivity, use `curl http://localhost:4001/v1/models`.

Setup uses `bash setup.sh` for bootstrap, then `npx tsx setup/index.ts --step <name>` for all other steps. Steps emit structured status blocks to stdout. Verbose logs go to `logs/setup.log`.

---

## 1. Bootstrap (Node.js + Dependencies)

Run `bash setup.sh` and parse the status block.

- If NODE_OK=false → Node.js is missing or too old. AskUserQuestion: "Would you like me to install Node.js 22?" If confirmed:
  - macOS: `brew install node@22` (if brew available) or install nvm then `nvm install 22`
  - Linux: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`
  - After installing Node, re-run `bash setup.sh`
- If DEPS_OK=false → Read `logs/setup.log`. Delete `node_modules` and `package-lock.json`, re-run `bash setup.sh`.
- If NATIVE_OK=false → better-sqlite3 failed. Install build tools (`xcode-select --install` macOS, `build-essential` Linux) and re-run.
- Record PLATFORM and IS_WSL for later steps.

**On success → immediately run step 2.**

## 2. Venice API Key

AskUserQuestion: "Enter your Venice API key (get one at https://venice.ai/settings/api)"

Run `npx tsx setup/index.ts --step venice -- --key <KEY>` and parse the status block.

- STATUS=success → Venice API configured.
- STATUS=failed → API key is invalid. Tell user to check at https://venice.ai/settings/api and ask again.

**On success → immediately run step 3.**

## 3. Choose Messaging Channel

AskUserQuestion: "Which messaging channel do you want to use?" with options: WhatsApp, Telegram, Both

When the user answers:
- If **WhatsApp** → IMMEDIATELY run: `npx tsx setup/index.ts --step channels -- --channel whatsapp`
- If **Telegram** → AskUserQuestion: "Enter your Telegram bot token (create one with @BotFather on Telegram: https://t.me/BotFather)". When the user provides the token, IMMEDIATELY run: `npx tsx setup/index.ts --step channels -- --channel telegram --telegram-token TOKEN`
- If **Both** → AskUserQuestion: "Enter your Telegram bot token (create one with @BotFather on Telegram: https://t.me/BotFather)". When the user provides the token, IMMEDIATELY run: `npx tsx setup/index.ts --step channels -- --channel both --telegram-token TOKEN`

**On success → immediately run step 4.**

## 4. Check Environment

Run `npx tsx setup/index.ts --step environment` and parse the status block.

- Record HAS_AUTH, HAS_REGISTERED_GROUPS, APPLE_CONTAINER, DOCKER values.
- Do NOT ask the user about these results. Just record them and move on.

**On success → immediately run step 5.**

## 5. Container Runtime

### 5a. Choose runtime

- PLATFORM=linux → Docker (only option). IMMEDIATELY proceed to step 5b.
- PLATFORM=macos + APPLE_CONTAINER=installed → AskUserQuestion: "Docker (default) or Apple Container (native macOS)?" When the user answers: if Apple Container → run `/convert-to-apple-container` first, then proceed to step 5c. If Docker → IMMEDIATELY proceed to step 5b.
- Otherwise → Docker (default). IMMEDIATELY proceed to step 5b.

### 5b. Install Docker if needed

- DOCKER=running → continue
- DOCKER=installed_not_running → start it: `open -a Docker` (macOS) or `sudo systemctl start docker` (Linux). Wait 15s, re-check.
- DOCKER=not_found → AskUserQuestion: "Docker is required. Would you like me to install it?"
  - macOS: `brew install --cask docker` then `open -a Docker`
  - Linux: `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER`

### 5c. Build and test

Run `npx tsx setup/index.ts --step container -- --runtime <chosen>`

**If BUILD_OK=false:** Read `logs/setup.log` tail. Try `docker builder prune -f` then retry.
**If TEST_OK=false but BUILD_OK=true:** Wait a moment, retry.

**On success → immediately run step 6.**

## 6. WhatsApp Authentication

**If user chose Telegram-only in step 3 → skip entirely to step 7.**

If HAS_AUTH=true from step 4 → AskUserQuestion: "WhatsApp auth already exists. Keep it or re-authenticate?"

Choose auth method:
- Headless (not WSL) → AskUserQuestion: Pairing code (recommended) vs QR terminal
- Desktop (macOS, Linux, WSL) → AskUserQuestion: QR browser (recommended) vs pairing code vs QR terminal

When the user answers, IMMEDIATELY run the corresponding command (all with Bash timeout: 150000ms):
- **QR browser** → IMMEDIATELY run: `npx tsx setup/index.ts --step whatsapp-auth -- --method qr-browser`
- **Pairing code** → AskUserQuestion: "Enter your phone number (with country code, e.g. +1234567890)". When the user provides the number, IMMEDIATELY run: `npx tsx setup/index.ts --step whatsapp-auth -- --method pairing-code --phone NUMBER`
- **QR terminal** → IMMEDIATELY run: `npx tsx setup/index.ts --step whatsapp-auth -- --method qr-terminal`

If the output contains `AUTH_STATUS: pairing_code_ready` or `STATUS: waiting`: display the pairing code to the user and tell them to enter it in WhatsApp. The process will emit `STATUS: success` when authenticated.

**On success → immediately run step 7.**

## 7. Configure Trigger and Get Chat ID

AskUserQuestion: "What trigger word should activate the bot? (default: @Andy)"

### If Telegram is enabled:

**IMPORTANT: The bot is NOT running yet, so `/chatid` will not work.** Instead, get the chat ID using the Telegram Bot API directly:

1. AskUserQuestion: "Send any message (like 'hello') to your bot on Telegram, then come back here." with option: "Done, I sent it"
2. When the user confirms, IMMEDIATELY fetch the chat ID using the bot token from `.env`:
   ```bash
   source .env && curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);const r=j.result||[];if(r.length===0){console.log('NO_MESSAGES')}else{r.forEach(u=>{if(u.message)console.log('tg:'+u.message.chat.id)})}"
   ```
4. If NO_MESSAGES → ask user to send another message and retry.
5. Use the `tg:CHATID` value for registration.

### If WhatsApp is enabled:

Get bot's number: `node -e "const c=require('./store/auth/creds.json');console.log(c.me.id.split(':')[0].split('@')[0])"`

AskUserQuestion: "Is this a shared number (your personal WhatsApp) or a dedicated number for the bot?"
- **Shared:** AskUserQuestion: Self-chat (recommended) or Solo group?
  - Self-chat JID: `NUMBER@s.whatsapp.net`
- **Dedicated:** AskUserQuestion: DM with bot (recommended) or Solo group?
  - DM JID: `BOTNUMBER@s.whatsapp.net`

**For WhatsApp groups:**
1. Run `npx tsx setup/index.ts --step groups` (timeout: 60000ms)
2. Run `npx tsx setup/index.ts --step groups -- --list` for JID|name lines
3. Present as AskUserQuestion (names only)

**On success → immediately run step 8.**

## 8. Register Channel

Run `npx tsx setup/index.ts --step register -- --jid "JID" --name "main" --trigger "@TriggerWord" --folder "main"` plus:
- `--no-trigger-required` if personal/DM/solo chat
- `--assistant-name "Name"` if trigger word is not @Andy (extract name from trigger)

**On success → immediately run step 9.**

## 9. Mount Allowlist

AskUserQuestion: "Should the bot have access to any directories on your computer?" with options:
- **No, keep it sandboxed (recommended)** — the bot only accesses its own memory. You can add directories later.
- **Yes, I want to give it access to specific directories**

When the user answers:
- **No** → IMMEDIATELY run: `npx tsx setup/index.ts --step mounts -- --empty`
- **Yes** → AskUserQuestion: "Enter the directory paths to share (comma-separated, e.g. /Users/me/projects, /Users/me/documents)". When the user provides paths, IMMEDIATELY run: `npx tsx setup/index.ts --step mounts -- --json '{"allowedRoots":[{"path":"PATH","readOnly":false}],"blockedPatterns":[],"nonMainReadOnly":true}'` (create one entry per path provided)

**On success → immediately run step 10.**

## 10. Start Service

If service already running: unload first.
- macOS: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist`
- Linux: `systemctl --user stop nanoclaw`

Run `npx tsx setup/index.ts --step service` and parse the status block.

**Handle failures:**
- FALLBACK=wsl_no_systemd → tell user to enable systemd or use `start-nanoclaw.sh`
- DOCKER_GROUP_STALE=true → run `sudo setfacl -m u:$(whoami):rw /var/run/docker.sock`, then re-run service step
- SERVICE_LOADED=false → read `logs/setup.log`, diagnose and fix

**On success → immediately run step 11.**

## 11. Verify

Run `npx tsx setup/index.ts --step verify` and parse the status block.

**If STATUS=failed, fix each issue:**
- SERVICE=stopped → `npm run build`, then restart service
- CREDENTIALS=missing → re-run step 2
- WHATSAPP_AUTH=not_found → re-run step 6
- REGISTERED_GROUPS=0 → re-run steps 7-8
- MOUNT_ALLOWLIST=missing → `npx tsx setup/index.ts --step mounts -- --empty`

**If STATUS=success:**

Tell the user setup is complete. Give them these instructions:

"Setup is complete! Your bot is running. Here's what to do next:

1. Open your chat (Telegram/WhatsApp) and send: @TriggerWord hello
2. The bot should respond within a few seconds.
3. You can close both terminal windows — the bot runs in the background automatically.

**About your model:** Setup ran on GLM 5 (`zai-org-glm-5`) to keep costs low. For best performance going forward, switch to a frontier model by typing `/model` and selecting `claude-sonnet-4-6` or `claude-opus-4-6`. You can switch back anytime.

If the bot doesn't respond, check the logs: tail -f logs/nanoclaw.log"

---

## Troubleshooting

**Service not starting:** Check `logs/nanoclaw.error.log`. Common: wrong Node path (re-run step 10), missing `.env` (step 2), missing auth (step 6).

**Container agent fails ("Claude Code process exited with code 1"):** Ensure the container runtime is running — `open -a Docker` (macOS Docker), `container system start` (Apple Container), or `sudo systemctl start docker` (Linux). Check container logs in `groups/main/logs/container-*.log`.

**No response to messages:** Check trigger pattern. Main channel doesn't need prefix. Run `npx tsx setup/index.ts --step verify`. Check `logs/nanoclaw.log`.

**Venice proxy not responding:** Check if proxy is running: `curl http://localhost:4001/v1/models`. If not, the user needs to restart it in their other terminal with `VENICE_API_KEY=their-key npm run proxy`.

**Model errors:** The proxy automatically maps Anthropic model IDs to Venice equivalents. If a model error appears, check `proxy/venice-proxy.ts` MODEL_MAP and add the missing mapping.
