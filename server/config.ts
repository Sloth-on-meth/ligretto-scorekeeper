import path from 'path';
import type { AppConfig } from './app.js';

export const MIN_PASSWORD_LENGTH = 8;
export const MIN_SECRET_LENGTH = 16;

export interface Settings {
  port: number;
  dbPath: string;
  distDir: string;
  app: AppConfig;
  /** Non-fatal notices worth showing at startup. */
  warnings: string[];
}

type Result = { ok: true; settings: Settings } | { ok: false; errors: string[] };

const PLACEHOLDER = /^change-me/i;

function parseBool(value: string | undefined, name: string, errors: string[]): boolean {
  if (value === undefined || value === '') return false;
  if (value === 'true') return true;
  if (value === 'false') return false;
  errors.push(`${name} must be "true" or "false" (got "${value}")`);
  return false;
}

/**
 * Validates environment settings. Collects every problem so the operator can fix them in one pass.
 * `baseDir` is the server's directory; the default database lives in ../data.
 */
export function loadSettings(env: NodeJS.ProcessEnv, baseDir: string): Result {
  const errors: string[] = [];
  const warnings: string[] = [];

  const authPassword = env.AUTH_PASSWORD ?? '';
  const playerPassword = env.PLAYER_PASSWORD ?? '';
  const sessionSecret = env.SESSION_SECRET ?? '';

  if (!authPassword) {
    errors.push('AUTH_PASSWORD is required (set it in .env)');
  } else if (PLACEHOLDER.test(authPassword)) {
    errors.push('AUTH_PASSWORD still has the example value from .env.example; choose a real password');
  } else if (authPassword.length < MIN_PASSWORD_LENGTH) {
    errors.push(`AUTH_PASSWORD must be at least ${MIN_PASSWORD_LENGTH} characters`);
  }

  if (!sessionSecret) {
    errors.push('SESSION_SECRET is required (set it in .env, e.g. `openssl rand -hex 32`)');
  } else if (PLACEHOLDER.test(sessionSecret)) {
    errors.push('SESSION_SECRET still has the example value from .env.example; generate a random one');
  } else if (sessionSecret.length < MIN_SECRET_LENGTH) {
    errors.push(`SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters`);
  }

  if (playerPassword && PLACEHOLDER.test(playerPassword)) {
    errors.push('PLAYER_PASSWORD still has the example value from .env.example; choose a real one or leave it empty');
  }
  if (playerPassword && playerPassword === authPassword) {
    errors.push('PLAYER_PASSWORD must differ from AUTH_PASSWORD');
  }
  if (!playerPassword) {
    warnings.push('PLAYER_PASSWORD is not set, so player sign-in is disabled.');
  }

  const rawPort = env.PORT ?? '3001';
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be a whole number from 1 to 65535 (got "${rawPort}")`);
  }

  const cookieSecure = parseBool(env.COOKIE_SECURE, 'COOKIE_SECURE', errors);
  const trustProxy = parseBool(env.TRUST_PROXY, 'TRUST_PROXY', errors);

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    settings: {
      port,
      dbPath: env.DB_PATH || path.join(baseDir, '..', 'data', 'ligretto.db'),
      distDir: path.join(baseDir, '..', 'dist'),
      warnings,
      app: {
        authPassword,
        playerPassword,
        sessionSecret,
        cookieSecure,
        trustProxy,
      },
    },
  };
}
