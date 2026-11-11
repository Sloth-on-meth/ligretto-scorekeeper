import path from 'path';
import type { AppConfig } from './app.js';

export const MIN_PASSWORD_LENGTH = 8;
export const MIN_SECRET_LENGTH = 16;
export const MIN_GROUP_PASSWORD_LENGTH = 6;

export interface Settings {
  port: number;
  dbPath: string;
  distDir: string;
  /** Group names from GROUP_<NAME>_PASSWORD, lowercase. */
  groupNames: string[];
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

  if (env.PLAYER_PASSWORD !== undefined && env.PLAYER_PASSWORD !== '') {
    warnings.push('PLAYER_PASSWORD is no longer used. Replace it with GROUP_<NAME>_PASSWORD (e.g. GROUP_OTJES_PASSWORD).');
  }

  // Each GROUP_<NAME>_PASSWORD creates a group whose members can sign in with that password.
  const groups: { name: string; password: string }[] = [];
  for (const [key, value] of Object.entries(env)) {
    const match = /^GROUP_([A-Za-z0-9]+)_PASSWORD$/.exec(key);
    if (!match) continue;
    const name = match[1].toLowerCase();
    const password = value ?? '';
    if (!password) continue;
    if (PLACEHOLDER.test(password)) {
      errors.push(`${key} still has the example value; choose a real password`);
    } else if (password.length < MIN_GROUP_PASSWORD_LENGTH) {
      errors.push(`${key} must be at least ${MIN_GROUP_PASSWORD_LENGTH} characters`);
    }
    groups.push({ name, password });
  }
  if (groups.length === 0) {
    warnings.push('No group passwords are set (GROUP_<NAME>_PASSWORD), so only the admin can sign in.');
  }
  const seenNames = new Set<string>();
  const seenPasswords = new Set<string>([authPassword]);
  for (const group of groups) {
    if (seenNames.has(group.name)) errors.push(`Group "${group.name}" is defined more than once`);
    seenNames.add(group.name);
    if (seenPasswords.has(group.password)) {
      errors.push(`The password for group "${group.name}" must differ from every other password`);
    }
    seenPasswords.add(group.password);
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
      groupNames: groups.map(g => g.name),
      app: {
        authPassword,
        groups,
        sessionSecret,
        cookieSecure,
        trustProxy,
      },
    },
  };
}
