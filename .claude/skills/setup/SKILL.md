---
name: setup
description: Run initial NanoClaw (Venice API) setup. Use when user wants to install dependencies, configure Venice API, choose messaging channels, authenticate WhatsApp/Telegram, register their main channel, or start the background services. Triggers on "setup", "install", "configure nanoclaw", or first-time setup requests.
---

# NanoClaw (Venice API) Setup

Run setup steps automatically. Only pause when user action is required (API keys, QR codes, configuration choices). Setup uses `bash setup.sh` for bootstrap, then `npx tsx setup/index.ts --step <name>` for all other steps. Steps emit structured status blocks to stdout. Verbose logs go to `logs/setup.log`.

**Principle:** When something is broken or missing, fix it. Don't tell the user to go fix it themselves unless it genuinely requires their manual action (e.g. scanning a QR code, pasting a secret token). If a dependency is missing, install it. If a service won't start, diagnose and repair. Ask the user for permission when needed, then do the work.

**UX Note:** Use `AskUserQuestion` for all user-facing questions.

## 1. Bootstrap (Node.js + Dependencies)

Run `bash setup.sh` and parse the status block.

- If NODE_OK=false → Node.js is missing or too old. Use `AskUserQuestion: Would you like me to install Node.js 22?` If confirmed:
  - macOS: `brew install node@22` (if brew available) or install nvm then `nvm install 22`
  - Linux: `curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt-get install -y nodejs`, or nvm
  - After installing Node, re-run `bash setup.sh`
- If DEPS_OK=false → Read `logs/setup.log`. Try: delete `node_modules` and `package-lock.json`, re-run `bash setup.sh`. If native module build fails, install build tools (`xcode-select --install` on macOS, `build-essential` on Linux), then retry.
- If NATIVE_OK=false → better-sqlite3 failed to load. Install build tools and re-run.
- Record PLATFORM and IS_WSL for later steps.

## 2. Venice API Key

This fork uses Venice AI for all inference. The user needs a Venice API key.

AskUserQuestion: "Enter your Venice API key (get one at https://venice.ai/settings/api)"

Run `npx tsx setup/index.ts --step venice -- --key <KEY>` and parse the status block.

- If STATUS=success → Venice API configured. The step writes `VENICE_API_KEY`, `ANTHROPIC_BASE_URL=http://localhost:4001`, and `ANTHROPIC_API_KEY=venice-proxy` to `.env`.
- If STATUS=failed → API key is invalid. Tell user to check their key at https://venice.ai/settings/api and try again.
- If STATUS=needs_input → No key provided. Ask the user for their key.

## 3. Choose Messaging Channel

AskUserQuestion: "Which messaging channel do you want to use?" with options: WhatsApp, Telegram, Both

If user picks Telegram or Both:
  AskUserQuestion: "Enter your Telegram bot token (create one with @BotFather on Telegram: https://t.me/BotFather)"

Run `npx tsx setup/index.ts --step channels -- --channel <whatsapp|telegram|both> [--telegram-token TOKEN]` and parse the status block.

- If STATUS=success → Channels configured.
- If STATUS=needs_input → Missing required info. Ask the user.

## 4. Check Environment

Run `npx tsx setup/index.ts --step environment` and parse the status block.

- If HAS_AUTH=true → note that WhatsApp auth exists, offer to skip step 6
- If HAS_REGISTERED_GROUPS=true → note existing config, offer to skip or reconfigure
- Record APPLE_CONTAINER and DOCKER values for step 5

## 5. Container Runtime

### 5a. Choose runtime

Check the preflight results for `APPLE_CONTAINER` and `DOCKER`, and the PLATFORM from step 1.

- PLATFORM=linux → Docker (only option)
- PLATFORM=macos + APPLE_CONTAINER=installed → Use `AskUserQuestion: Docker (default, cross-platform) or Apple Container (native macOS)?` If Apple Container, run `/convert-to-apple-container` now, then skip to 5c.
- PLATFORM=macos + APPLE_CONTAINER=not_found → Docker (default)

### 5a-docker. Install Docker

- DOCKER=running → continue to 5b
- DOCKER=installed_not_running → start Docker: `open -a Docker` (macOS) or `sudo systemctl start docker` (Linux). Wait 15s, re-check with `docker info`.
- DOCKER=not_found → Use `AskUserQuestion: Docker is required for running agents. Would you like me to install it?` If confirmed:
  - macOS: install via `brew install --cask docker`, then `open -a Docker` and wait for it to start. If brew not available, direct to Docker Desktop download at https://docker.com/products/docker-desktop
  - Linux: install with `curl -fsSL https://get.docker.com | sh && sudo usermod -aG docker $USER`. Note: user may need to log out/in for group membership.

### 5b. Apple Container conversion gate (if needed)

**If the chosen runtime is Apple Container**, you MUST check whether the source code has already been converted from Docker to Apple Container. Do NOT skip this step. Run:

```bash
grep -q "CONTAINER_RUNTIME_BIN = 'container'" src/container-runtime.ts && echo "ALREADY_CONVERTED" || echo "NEEDS_CONVERSION"
```

**If NEEDS_CONVERSION**, the source code still uses Docker as the runtime. You MUST run the `/convert-to-apple-container` skill NOW, before proceeding to the build step.

**If ALREADY_CONVERTED**, the code already uses Apple Container. Continue to 5c.

**If the chosen runtime is Docker**, no conversion is needed — Docker is the default. Continue to 5c.

### 5c. Build and test

Run `npx tsx setup/index.ts --step container -- --runtime <chosen>` and parse the status block.

**If BUILD_OK=false:** Read `logs/setup.log` tail for the build error.
- Cache issue (stale layers): `docker builder prune -f` (Docker) or `container builder stop && container builder rm && container builder start` (Apple Container). Retry.
- Dockerfile syntax or missing files: diagnose from the log and fix, then retry.

**If TEST_OK=false but BUILD_OK=true:** The image built but won't run. Check logs — common cause is runtime not fully started. Wait a moment and retry the test.

## 6. WhatsApp Authentication (Skip if Telegram-only)

If user chose Telegram-only in step 3, skip this entire step.

If HAS_AUTH=true, confirm: keep or re-authenticate?

**Choose auth method based on environment (from step 4):**

If IS_HEADLESS=true AND IS_WSL=false → AskUserQuestion: Pairing code (recommended) vs QR code in terminal?
Otherwise (macOS, desktop Linux, or WSL) → AskUserQuestion: QR code in browser (recommended) vs pairing code vs QR code in terminal?

- **QR browser:** `npx tsx setup/index.ts --step whatsapp-auth -- --method qr-browser` (Bash timeout: 150000ms)
- **Pairing code:** Ask for phone number first. `npx tsx setup/index.ts --step whatsapp-auth -- --method pairing-code --phone NUMBER` (Bash timeout: 150000ms). Display PAIRING_CODE.
- **QR terminal:** `npx tsx setup/index.ts --step whatsapp-auth -- --method qr-terminal`. Tell user to run `npm run auth` in another terminal.

**If failed:** qr_timeout → re-run. logged_out → delete `store/auth/` and re-run. 515 → re-run. timeout → ask user, offer retry.

## 7. Configure Trigger and Channel Type

AskUserQuestion: Trigger word? (default: @Andy)

If WhatsApp is enabled:
  Get bot's WhatsApp number: `node -e "const c=require('./store/auth/creds.json');console.log(c.me.id.split(':')[0].split('@')[0])"`
  AskUserQuestion: Shared number or dedicated? → AskUserQuestion: Main channel type?
  **Shared number:** Self-chat (recommended) or Solo group
  **Dedicated number:** DM with bot (recommended) or Solo group with bot

If Telegram-only:
  AskUserQuestion: Which Telegram chat should be the main channel? Tell user to send `/chatid` to the bot in the desired chat, then provide the `tg:CHATID` value.

## 8. Sync and Select Group (If Group Channel)

**Personal chat:** JID = `NUMBER@s.whatsapp.net`
**DM with bot:** Ask for bot's number, JID = `NUMBER@s.whatsapp.net`
**Telegram chat:** JID = `tg:CHATID`

**WhatsApp Group:**
1. `npx tsx setup/index.ts --step groups` (Bash timeout: 60000ms)
2. BUILD=failed → fix TypeScript, re-run. GROUPS_IN_DB=0 → check logs.
3. `npx tsx setup/index.ts --step groups -- --list` for pipe-separated JID|name lines.
4. Present candidates as AskUserQuestion (names only, not JIDs).

## 9. Register Channel

Run `npx tsx setup/index.ts --step register -- --jid "JID" --name "main" --trigger "@TriggerWord" --folder "main"` plus `--no-trigger-required` if personal/DM/solo, `--assistant-name "Name"` if not Andy.

## 10. Mount Allowlist

AskUserQuestion: Agent access to external directories?

**No:** `npx tsx setup/index.ts --step mounts -- --empty`
**Yes:** Collect paths/permissions. `npx tsx setup/index.ts --step mounts -- --json '{"allowedRoots":[...],"blockedPatterns":[],"nonMainReadOnly":true}'`

## 11. Start Service

If service already running: unload first.
- macOS: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist`
- Linux: `systemctl --user stop nanoclaw` (or `systemctl stop nanoclaw` if root)

Run `npx tsx setup/index.ts --step service` and parse the status block.

**If FALLBACK=wsl_no_systemd:** WSL without systemd detected. Tell user they can either enable systemd in WSL (`echo -e "[boot]\nsystemd=true" | sudo tee /etc/wsl.conf` then restart WSL) or use the generated `start-nanoclaw.sh` wrapper.

**If DOCKER_GROUP_STALE=true:** The user was added to the docker group after their session started — the systemd service can't reach the Docker socket. Ask user to run these two commands:

1. Immediate fix: `sudo setfacl -m u:$(whoami):rw /var/run/docker.sock`
2. Persistent fix (re-applies after every Docker restart):
```bash
sudo mkdir -p /etc/systemd/system/docker.service.d
sudo tee /etc/systemd/system/docker.service.d/socket-acl.conf << 'EOF'
[Service]
ExecStartPost=/usr/bin/setfacl -m u:USERNAME:rw /var/run/docker.sock
EOF
sudo systemctl daemon-reload
```
Replace `USERNAME` with the actual username (from `whoami`). Run the two `sudo` commands separately — the `tee` heredoc first, then `daemon-reload`. After user confirms setfacl ran, re-run the service step.

**If SERVICE_LOADED=false:**
- Read `logs/setup.log` for the error.
- macOS: check `launchctl list | grep nanoclaw`. If PID=`-` and status non-zero, read `logs/nanoclaw.error.log`.
- Linux: check `systemctl --user status nanoclaw`.
- Re-run the service step after fixing.

## 12. Verify

Run `npx tsx setup/index.ts --step verify` and parse the status block.

**If STATUS=failed, fix each:**
- SERVICE=stopped → `npm run build`, then restart: `launchctl kickstart -k gui/$(id -u)/com.nanoclaw` (macOS) or `systemctl --user restart nanoclaw` (Linux) or `bash start-nanoclaw.sh` (WSL nohup)
- SERVICE=not_found → re-run step 11
- CREDENTIALS=missing → re-run step 2 (Venice API key)
- WHATSAPP_AUTH=not_found → re-run step 6
- REGISTERED_GROUPS=0 → re-run steps 8-9
- MOUNT_ALLOWLIST=missing → `npx tsx setup/index.ts --step mounts -- --empty`

Tell user to test: send a message in their registered chat. Show: `tail -f logs/nanoclaw.log`

## Troubleshooting

**Service not starting:** Check `logs/nanoclaw.error.log`. Common: wrong Node path (re-run step 11), missing `.env` (step 2), missing auth (step 6).

**Container agent fails ("Claude Code process exited with code 1"):** Ensure the container runtime is running — `open -a Docker` (macOS Docker), `container system start` (Apple Container), or `sudo systemctl start docker` (Linux). Check container logs in `groups/main/logs/container-*.log`.

**No response to messages:** Check trigger pattern. Main channel doesn't need prefix. Check DB: `npx tsx setup/index.ts --step verify`. Check `logs/nanoclaw.log`.

**WhatsApp disconnected:** `npm run auth` then rebuild and restart: `npm run build && launchctl kickstart -k gui/$(id -u)/com.nanoclaw` (macOS) or `systemctl --user restart nanoclaw` (Linux).

**Venice proxy not responding:** Check if proxy is running: `curl http://localhost:4001/v1/models`. If not, check `.env` for `VENICE_API_KEY`. Start manually with `npm run proxy`.

**Unload service:** macOS: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist` | Linux: `systemctl --user stop nanoclaw`
