/**
 * Step: channels — Configure messaging channels (WhatsApp, Telegram, or both).
 *
 * Accepts args:
 *   --channel <whatsapp|telegram|both>   Channel choice
 *   --telegram-token <TOKEN>             Telegram bot token (from BotFather)
 */
import fs from 'fs';
import path from 'path';

import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

function readEnvFileRaw(envPath: string): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, 'utf-8');
  const env: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    env[key] = value;
  }
  return env;
}

function writeEnvVars(envPath: string, vars: Record<string, string>): void {
  const existing = readEnvFileRaw(envPath);
  const merged = { ...existing, ...vars };

  const lines: string[] = [];
  for (const [key, value] of Object.entries(merged)) {
    lines.push(`${key}=${value}`);
  }
  fs.writeFileSync(envPath, lines.join('\n') + '\n');
}

export async function run(args: string[]): Promise<void> {
  const projectRoot = process.cwd();
  const envPath = path.join(projectRoot, '.env');

  logger.info('Starting channel configuration');

  // Parse channel choice
  const channelIdx = args.indexOf('--channel');
  const channel = channelIdx !== -1 && args[channelIdx + 1]
    ? args[channelIdx + 1]
    : '';

  // Parse Telegram token
  const tokenIdx = args.indexOf('--telegram-token');
  const telegramToken = tokenIdx !== -1 && args[tokenIdx + 1]
    ? args[tokenIdx + 1]
    : '';

  if (!channel) {
    emitStatus('CHANNELS', {
      STATUS: 'needs_input',
      MESSAGE: 'Choose a channel: whatsapp, telegram, or both',
      OPTIONS: 'whatsapp,telegram,both',
    });
    return;
  }

  const vars: Record<string, string> = {};

  if (channel === 'telegram' || channel === 'both') {
    if (!telegramToken) {
      emitStatus('CHANNELS', {
        STATUS: 'needs_input',
        MESSAGE: 'Telegram bot token required. Create one with @BotFather on Telegram.',
      });
      return;
    }
    vars.TELEGRAM_BOT_TOKEN = telegramToken;
  }

  if (channel === 'telegram') {
    vars.TELEGRAM_ONLY = 'true';
  } else {
    vars.TELEGRAM_ONLY = 'false';
  }

  writeEnvVars(envPath, vars);

  const channelNames = channel === 'both'
    ? 'WhatsApp + Telegram'
    : channel === 'telegram'
      ? 'Telegram only'
      : 'WhatsApp only';

  logger.info({ channel: channelNames }, 'Channels configured');

  emitStatus('CHANNELS', {
    STATUS: 'success',
    CHANNEL: channelNames,
    TELEGRAM_CONFIGURED: channel === 'telegram' || channel === 'both',
    WHATSAPP_CONFIGURED: channel === 'whatsapp' || channel === 'both',
  });
}
