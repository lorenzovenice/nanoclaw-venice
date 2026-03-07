---
name: setup
description: Run initial NanoClaw (Venice API) setup. Use when user wants to install dependencies, configure Venice API, choose messaging channels, authenticate WhatsApp/Telegram, register their main channel, or start the background services. Triggers on "setup", "install", "configure nanoclaw", or first-time setup requests.
---

# NanoClaw (Venice API) Setup

COMPLETE ALL STEPS IN ONE TURN. DO NOT STOP BETWEEN STEPS. DO NOT SUMMARIZE INTERMEDIATE RESULTS.

Rules:
- After every command or AskUserQuestion answer → IMMEDIATELY run the next command. Never summarize.
- Fix problems yourself unless it requires the user's physical action.
- NEVER run sudo without asking via AskUserQuestion first.
- If a step fails twice → AskUserQuestion with the error.
- The Venice proxy is already running. Do NOT start it.

---

## BATCH 1: Bootstrap + Environment Check

Run this as ONE command:

```bash
bash setup.sh && npx tsx setup/index.ts --step environment
```

Parse both outputs. If bootstrap failed (NODE_OK=false, DEPS_OK=false, NATIVE_OK=false) → fix and re-run. Record PLATFORM, IS_WSL, HAS_AUTH, DOCKER from environment output.

IMMEDIATELY proceed to the next step — do NOT report results to the user.

## Venice API Key

Check if the environment step showed a valid VENICE_API_KEY in .env. If yes → skip to Channel Choice.

If no → AskUserQuestion: "Enter your Venice API key (get one at https://venice.ai/settings/api)"

When answered → IMMEDIATELY run: `npx tsx setup/index.ts --step venice -- --key <KEY>`

If STATUS=failed → ask again. If STATUS=success → IMMEDIATELY proceed.

## Channel Choice

AskUserQuestion: "Which messaging channel?" options: WhatsApp, Telegram, Both

- If Telegram or Both → AskUserQuestion: "Enter your Telegram bot token (from @BotFather on Telegram)"

When all answers collected → IMMEDIATELY run BATCH 2.

## BATCH 2: Channels + Container Build

Construct and run as ONE command (substitute channel/token from previous answers):

For WhatsApp only:
```bash
npx tsx setup/index.ts --step channels -- --channel whatsapp && npx tsx setup/index.ts --step container -- --runtime docker
```

For Telegram only (substitute TOKEN):
```bash
npx tsx setup/index.ts --step channels -- --channel telegram --telegram-token TOKEN && npx tsx setup/index.ts --step container -- --runtime docker
```

For Both (substitute TOKEN):
```bash
npx tsx setup/index.ts --step channels -- --channel both --telegram-token TOKEN && npx tsx setup/index.ts --step container -- --runtime docker
```

If DOCKER is not "running": start Docker first (`open -a Docker` on macOS, `sudo systemctl start docker` on Linux), wait 15s, then run the batch.

If BUILD_OK=false → run `docker builder prune -f` and retry the container step once.

IMMEDIATELY proceed — do NOT report build results to the user.

## WhatsApp Auth (skip if Telegram-only)

If user chose Telegram-only → SKIP to Trigger step.

If HAS_AUTH=true → AskUserQuestion: "WhatsApp auth exists. Keep or re-authenticate?" options: Keep, Re-authenticate. If Keep → skip to Trigger step.

AskUserQuestion: "WhatsApp auth method?" options: QR browser (recommended), Pairing code, QR terminal

- QR browser → run: `npx tsx setup/index.ts --step whatsapp-auth -- --method qr-browser` (timeout 150s)
- Pairing code → AskUserQuestion for phone number, then run: `npx tsx setup/index.ts --step whatsapp-auth -- --method pairing-code --phone NUMBER` (timeout 150s)
- QR terminal → run: `npx tsx setup/index.ts --step whatsapp-auth -- --method qr-terminal` (timeout 150s)

If pairing_code_ready → show code. Wait for STATUS: success. IMMEDIATELY proceed.

## FINAL: Trigger, Chat ID, Mounts, Register, Service, Verify

This is ONE continuous section. Do NOT stop until setup is complete.

**Step A — Trigger word:**
AskUserQuestion: "Trigger word for the bot? (default: @Andy)"

**Step B — Chat ID (Telegram):** If Telegram enabled, AskUserQuestion: "Send any message to your bot on Telegram, then come back." option: "Done". When answered, IMMEDIATELY run: `source .env && curl -s "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getUpdates" | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8');const j=JSON.parse(d);const r=j.result||[];if(r.length===0){console.log('NO_MESSAGES')}else{r.forEach(u=>{if(u.message)console.log('tg:'+u.message.chat.id)})}"`. If NO_MESSAGES → ask user to retry. IMPORTANT: The JID output includes the `tg:` prefix (e.g. `tg:236258123`). You MUST use the FULL string including `tg:` as the --jid value in the register step. Do NOT strip the prefix.

**Step B — Chat ID (WhatsApp):** If WhatsApp enabled, run: `node -e "const c=require('./store/auth/creds.json');console.log(c.me.id.split(':')[0].split('@')[0])"`. Then AskUserQuestion: "Shared or dedicated number?" → "Self-chat or solo group?" Self-chat JID: `NUMBER@s.whatsapp.net`. Solo group: run `npx tsx setup/index.ts --step groups && npx tsx setup/index.ts --step groups -- --list` and present options.

**Step C — Mounts (ask IMMEDIATELY after getting JID, do NOT stop):**
AskUserQuestion: "Should the bot access directories on your computer?" options: No (recommended), Yes. If Yes → AskUserQuestion: "Enter directory paths (comma-separated)".

**Step D — Run IMMEDIATELY after mounts answer (do NOT stop, do NOT summarize):**

Unload existing service: macOS: `launchctl unload ~/Library/LaunchAgents/com.nanoclaw.plist 2>/dev/null`. Linux: `systemctl --user stop nanoclaw 2>/dev/null`.

Then construct and run as ONE bash command. For "No mounts":
```bash
npx tsx setup/index.ts --step register -- --jid "JID" --name "main" --trigger "@TriggerWord" --folder "main" --no-trigger-required && npx tsx setup/index.ts --step mounts -- --empty && npm run build && npx tsx setup/index.ts --step service && npx tsx setup/index.ts --step verify
```

For "Yes mounts" (one entry per path):
```bash
npx tsx setup/index.ts --step register -- --jid "JID" --name "main" --trigger "@TriggerWord" --folder "main" --no-trigger-required && npx tsx setup/index.ts --step mounts -- --json '{"allowedRoots":[{"path":"PATH","readOnly":false}],"blockedPatterns":[],"nonMainReadOnly":true}' && npm run build && npx tsx setup/index.ts --step service && npx tsx setup/index.ts --step verify
```

Add `--assistant-name "Name"` to register if trigger is not @Andy.

Parse verify output. If STATUS=failed → fix each issue. If STATUS=success → tell the user:

"Setup complete! Your bot is running.

1. Open your chat and send: @TriggerWord hello
2. The bot should respond within a few seconds.
3. You can close this terminal — the bot runs in the background.

Tip: To switch models, type /model or tell the bot 'switch to opus'. For cheaper daily use, try zai-org-glm-5.

If the bot doesn't respond: tail -f logs/nanoclaw.log"

---

## Troubleshooting

- **Service not starting:** Check `logs/nanoclaw.error.log`.
- **Container fails:** Ensure Docker is running. Check `groups/main/logs/container-*.log`.
- **No response:** Check trigger. Main channel doesn't need prefix. Run verify step.
- **Proxy not responding:** `curl http://localhost:4001/v1/models`. If down, restart with `VENICE_API_KEY=key npm run proxy`.
