/**
 * Step: venice — Validate Venice API key and configure proxy settings.
 *
 * Accepts args:
 *   --key <VENICE_API_KEY>   Venice API key to validate and store
 */
import fs from 'fs';
import https from 'https';
import path from 'path';

import { logger } from '../src/logger.js';
import { emitStatus } from './status.js';

function validateKeyWithVenice(apiKey: string): Promise<boolean> {
  return new Promise((resolve) => {
    const req = https.request(
      {
        hostname: 'api.venice.ai',
        path: '/api/v1/models?type=text',
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => {
          resolve(res.statusCode === 200);
        });
      },
    );
    req.on('error', () => resolve(false));
    req.end();
  });
}

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

  logger.info('Starting Venice API configuration');

  // Get API key from args or existing .env
  let apiKey = '';
  const keyIdx = args.indexOf('--key');
  if (keyIdx !== -1 && args[keyIdx + 1]) {
    apiKey = args[keyIdx + 1];
  } else {
    const existing = readEnvFileRaw(envPath);
    apiKey = existing.VENICE_API_KEY || '';
  }

  if (!apiKey) {
    emitStatus('VENICE', {
      STATUS: 'needs_input',
      MESSAGE: 'Venice API key required. Get one at https://venice.ai/settings/api',
    });
    return;
  }

  // Validate the key
  logger.info('Validating Venice API key...');
  const valid = await validateKeyWithVenice(apiKey);

  if (!valid) {
    emitStatus('VENICE', {
      STATUS: 'failed',
      ERROR: 'Venice API key validation failed. Check your key at https://venice.ai/settings/api',
    });
    return;
  }

  // Write config to .env
  writeEnvVars(envPath, {
    VENICE_API_KEY: apiKey,
    ANTHROPIC_BASE_URL: 'http://localhost:4001',
    ANTHROPIC_API_KEY: 'venice-proxy',
  });

  logger.info('Venice API configured successfully');

  emitStatus('VENICE', {
    STATUS: 'success',
    API_KEY_VALID: true,
    PROXY_URL: 'http://localhost:4001',
  });
}
