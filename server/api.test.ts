/* eslint-disable @typescript-eslint/no-explicit-any -- response bodies are loosely typed JSON in these fixtures */
import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { openDatabase } from './db.js';
import { createApp, type AppConfig } from './app.js';
import { loadSettings } from './config.js';

const ADMIN = 'admin-password-123';
const PLAYER = 'player-password-456';
const SECRET = 'session-secret-0123456789';

interface Harness {
  base: string;
  close: () => Promise<void>;
}

async function start(overrides: Partial<AppConfig> = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ligretto-test-'));
  const db = openDatabase(path.join(dir, 'test.db'));
  const config: AppConfig = {
    authPassword: ADMIN,
    playerPassword: PLAYER,
    sessionSecret: SECRET,
    cookieSecure: false,
    trustProxy: false,
    ...overrides,
  };
  const app = createApp(db, config);
  const server: Server = await new Promise(resolve => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address() as AddressInfo;
  return {
    base: `http://127.0.0.1:${port}/api`,
    close: () => new Promise<void>(resolve => {
      server.close(() => {
        db.close();
        fs.rmSync(dir, { recursive: true, force: true });
        resolve();
      });
    }),
  };
}

const JSON_HEADERS = { 'Content-Type': 'application/json' };

async function call(base: string, method: string, url: string, body?: unknown, cookie?: string) {
  const res = await fetch(base + url, {
    method,
    headers: { ...JSON_HEADERS, ...(cookie ? { Cookie: cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: any = undefined;
  try { json = text ? JSON.parse(text) : undefined; } catch { json = text; }
  return { status: res.status, body: json };
}

async function login(base: string, password: string): Promise<string | null> {
  const res = await fetch(base + '/auth/login', {
    method: 'POST',
    headers: JSON_HEADERS,
    body: JSON.stringify({ password }),
  });
  if (!res.ok) return null;
  const setCookie = res.headers.get('set-cookie') ?? '';
  return setCookie.split(';')[0];
}

async function seedPlayers(base: string, admin: string, names: string[]) {
  const ids: Record<string, number> = {};
  for (const name of names) {
    const r = await call(base, 'POST', '/players', { name }, admin);
    assert.equal(r.status, 201, `seed ${name}: ${JSON.stringify(r.body)}`);
    ids[name] = r.body.id;
  }
  return ids;
}

describe('health and unknown routes', () => {
  let h: Harness;
  before(async () => { h = await start(); });
  after(async () => { await h.close(); });

  it('reports healthy without auth', async () => {
    const r = await call(h.base, 'GET', '/health');
    assert.equal(r.status, 200);
    assert.deepEqual(r.body, { status: 'ok' });
  });

  it('returns JSON 404 for unknown API paths', async () => {
    const r = await call(h.base, 'GET', '/nope');
    assert.equal(r.status, 404);
    assert.equal(r.body.error, 'Not found');
  });
});

describe('roles and permissions', () => {
  let h: Harness;
  let admin: string;
  let player: string;
  let ids: Record<string, number>;
  let gameId: number;
  let roundId: number;

  before(async () => {
    h = await start();
    admin = (await login(h.base, ADMIN))!;
    player = (await login(h.base, PLAYER))!;
    ids = await seedPlayers(h.base, admin, ['Ann', 'Ben']);
    const g = await call(h.base, 'POST', '/games', { player_ids: [ids.Ann, ids.Ben] }, player);
    assert.equal(g.status, 201);
    gameId = g.body.id;
    const r = await call(h.base, 'POST', `/games/${gameId}/rounds`, {
      scores: [{ player_id: ids.Ann, score: 5 }, { player_id: ids.Ben, score: -1 }],
    }, player);
    assert.equal(r.status, 201);
    roundId = r.body[0].id;
  });
  after(async () => { await h.close(); });

  it('rejects wrong passwords and empty ones', async () => {
    assert.equal((await call(h.base, 'POST', '/auth/login', { password: 'nope' })).status, 401);
    assert.equal((await call(h.base, 'POST', '/auth/login', {})).status, 400);
  });

  it('gives admin and player different roles', async () => {
    const a = await call(h.base, 'GET', '/auth/session', undefined, admin);
    const p = await call(h.base, 'GET', '/auth/session', undefined, player);
    assert.equal(a.body.role, 'admin');
    assert.equal(p.body.role, 'player');
  });

  it('lets players start games and add rounds', async () => {
    assert.equal((await call(h.base, 'POST', '/games', { player_ids: [ids.Ann, ids.Ben] }, player)).status, 201);
    assert.equal((await call(h.base, 'POST', `/games/${gameId}/rounds`, {
      scores: [{ player_id: ids.Ann, score: 0 }, { player_id: ids.Ben, score: 0 }],
    }, player)).status, 201);
  });

  it('keeps admin-only actions away from players', async () => {
    const checks: [string, string, unknown][] = [
      ['POST', '/players', { name: 'Zed' }],
      ['PATCH', `/players/${ids.Ann}`, { name: 'X' }],
      ['DELETE', `/players/${ids.Ann}`, undefined],
      ['PUT', `/games/${gameId}/rounds/${roundId}`, { scores: [{ player_id: ids.Ann, score: 1 }, { player_id: ids.Ben, score: 1 }] }],
      ['DELETE', `/games/${gameId}/rounds/${roundId}`, undefined],
      ['PATCH', `/games/${gameId}/finish`, undefined],
      ['PATCH', `/games/${gameId}/trash`, undefined],
      ['DELETE', `/games/${gameId}`, undefined],
      ['POST', '/games/import', { player_names: ['a', 'b'], rounds: [] }],
    ];
    for (const [method, url, body] of checks) {
      const r = await call(h.base, method, url, body, player);
      assert.equal(r.status, 403, `${method} ${url} should be 403, got ${r.status}`);
    }
  });

  it('rejects anonymous writes with 401', async () => {
    assert.equal((await call(h.base, 'POST', '/games', { player_ids: [ids.Ann, ids.Ben] })).status, 401);
    assert.equal((await call(h.base, 'POST', `/games/${gameId}/rounds`, { scores: [] })).status, 401);
  });

  it('lets admins edit and finish, then locks the game', async () => {
    const edit = await call(h.base, 'PUT', `/games/${gameId}/rounds/${roundId}`, {
      scores: [{ player_id: ids.Ann, score: 1 }, { player_id: ids.Ben, score: 1 }],
    }, admin);
    assert.equal(edit.status, 200);
    assert.equal((await call(h.base, 'PATCH', `/games/${gameId}/finish`, undefined, admin)).status, 200);
    assert.equal((await call(h.base, 'POST', `/games/${gameId}/rounds`, {
      scores: [{ player_id: ids.Ann, score: 0 }, { player_id: ids.Ben, score: 0 }],
    }, player)).status, 409);
  });

  it('logs out by clearing the cookie', async () => {
    const r = await fetch(h.base + '/auth/logout', { method: 'POST' });
    assert.match(r.headers.get('set-cookie') ?? '', /Max-Age=0/);
  });
});

describe('input validation', () => {
  let h: Harness;
  let admin: string;
  let ids: Record<string, number>;

  before(async () => {
    h = await start();
    admin = (await login(h.base, ADMIN))!;
    ids = await seedPlayers(h.base, admin, ['Ann', 'Ben', 'Cy']);
  });
  after(async () => { await h.close(); });

  it('rejects names that are too long or contain control characters', async () => {
    const long = await call(h.base, 'POST', '/players', { name: 'x'.repeat(41) }, admin);
    assert.equal(long.status, 400);
    assert.match(long.body.error, /40 characters/);
    const ctrl = await call(h.base, 'POST', '/players', { name: 'bad\u0007name' }, admin);
    assert.equal(ctrl.status, 400);
  });

  it('accepts a 40-character name', async () => {
    const r = await call(h.base, 'POST', '/players', { name: 'y'.repeat(40) }, admin);
    assert.equal(r.status, 201);
  });

  it('rejects renames that collide case-insensitively', async () => {
    const r = await call(h.base, 'PATCH', `/players/${ids.Cy}`, { name: 'ANN' }, admin);
    assert.equal(r.status, 409);
  });

  it('rejects imports over the player and round limits', async () => {
    const names = Array.from({ length: 21 }, (_, i) => `P${i}`);
    const tooMany = await call(h.base, 'POST', '/games/import', { player_names: names, rounds: [] }, admin);
    assert.equal(tooMany.status, 400);
    const rounds = Array.from({ length: 201 }, () => ({ scores: [{ player_name: 'A', score: 0 }, { player_name: 'B', score: 0 }] }));
    const tooLong = await call(h.base, 'POST', '/games/import', { player_names: ['A', 'B'], rounds }, admin);
    assert.equal(tooLong.status, 400);
  });

  it('rejects round scores for players not in the game, and bad numbers', async () => {
    const g = await call(h.base, 'POST', '/games', { player_ids: [ids.Ann, ids.Ben] }, admin);
    const base = `/games/${g.body.id}/rounds`;
    assert.equal((await call(h.base, 'POST', base, { scores: [{ player_id: ids.Ann, score: 1 }, { player_id: ids.Cy, score: 1 }] }, admin)).status, 400);
    assert.equal((await call(h.base, 'POST', base, { scores: [{ player_id: ids.Ann, score: 1.5 }, { player_id: ids.Ben, score: 1 }] }, admin)).status, 400);
    assert.equal((await call(h.base, 'POST', base, { scores: [{ player_id: ids.Ann, score: 5000 }, { player_id: ids.Ben, score: 1 }] }, admin)).status, 400);
  });

  it('rejects malformed JSON with a JSON error', async () => {
    const res = await fetch(h.base + '/players', {
      method: 'POST',
      headers: { ...JSON_HEADERS, Cookie: admin },
      body: '{not json',
    });
    assert.equal(res.status, 400);
    assert.equal((await res.json()).error, 'Invalid JSON body');
  });
});

describe('scores, winners and stats', () => {
  let h: Harness;
  let admin: string;
  let ids: Record<string, number>;

  before(async () => {
    h = await start();
    admin = (await login(h.base, ADMIN))!;
    ids = await seedPlayers(h.base, admin, ['Ann', 'Ben', 'Cy']);
  });
  after(async () => { await h.close(); });

  it('shares the win on a tie and counts it in stats', async () => {
    const imported = await call(h.base, 'POST', '/games/import', {
      player_names: ['Ann', 'Ben'],
      rounds: [
        { scores: [{ player_name: 'Ann', score: 10 }, { player_name: 'Ben', score: 4 }] },
        { scores: [{ player_name: 'Ann', score: 0 }, { player_name: 'Ben', score: 6 }] },
      ],
    }, admin);
    assert.equal(imported.status, 201);

    const games = await call(h.base, 'GET', '/games');
    const game = games.body.find((g: any) => g.id === imported.body.id);
    assert.deepEqual(game.winners, ['Ann', 'Ben']);

    const stats = await call(h.base, 'GET', '/stats');
    const ann = stats.body.find((s: any) => s.name === 'Ann');
    assert.equal(ann.ties, 1);
    assert.equal(ann.wins, 0);
  });

  it('excludes trashed games from stats and winners', async () => {
    const before = await call(h.base, 'GET', '/stats');
    const trashed = await call(h.base, 'POST', '/games/import', {
      player_names: ['Cy', 'Ben'],
      rounds: [{ scores: [{ player_name: 'Cy', score: 99 }, { player_name: 'Ben', score: 0 }] }],
    }, admin);
    assert.equal((await call(h.base, 'PATCH', `/games/${trashed.body.id}/trash`, undefined, admin)).status, 200);
    const after = await call(h.base, 'GET', '/stats');
    const cyBefore = before.body.find((s: any) => s.name === 'Cy');
    const cyAfter = after.body.find((s: any) => s.name === 'Cy');
    assert.equal(cyAfter.total_score, cyBefore?.total_score ?? 0);
  });

  it('keeps round numbers unique after a deletion', async () => {
    const g = await call(h.base, 'POST', '/games', { player_ids: [ids.Ann, ids.Ben] }, admin);
    const rounds = `/games/${g.body.id}/rounds`;
    const scores = { scores: [{ player_id: ids.Ann, score: 1 }, { player_id: ids.Ben, score: 1 }] };
    for (let i = 0; i < 3; i++) await call(h.base, 'POST', rounds, scores, admin);
    const detail = await call(h.base, 'GET', `/games/${g.body.id}`);
    const middle = detail.body.rounds.find((r: any) => r.round_number === 2);
    assert.equal((await call(h.base, 'DELETE', `${rounds}/${middle.id}`, undefined, admin)).status, 204);
    // Highest remaining is 3, so the next round is 4 and nothing collides.
    const next = await call(h.base, 'POST', rounds, scores, admin);
    assert.equal(next.body[0].round_number, 4);
  });
});

describe('sessions', () => {
  it('rejects a cookie signed with a different secret', async () => {
    const first = await start();
    const cookie = (await login(first.base, ADMIN))!;
    await first.close();

    const second = await start({ sessionSecret: 'a-completely-different-secret' });
    const r = await call(second.base, 'GET', '/auth/session', undefined, cookie);
    assert.equal(r.body.role, null);
    assert.equal((await call(second.base, 'POST', '/players', { name: 'Zed' }, cookie)).status, 401);
    await second.close();
  });

  it('disables player sign-in when no player password is configured', async () => {
    const h = await start({ playerPassword: '' });
    assert.equal(await login(h.base, ''), null);
    assert.equal((await call(h.base, 'POST', '/auth/login', { password: 'player-password-456' })).status, 401);
    await h.close();
  });

  it('limits sign-in attempts per client', async () => {
    const h = await start();
    let last = 0;
    for (let i = 0; i < 11; i++) {
      last = (await call(h.base, 'POST', '/auth/login', { password: 'wrong' })).status;
    }
    assert.equal(last, 429);
    await h.close();
  });
});

describe('configuration', () => {
  const dir = os.tmpdir();
  const good = {
    AUTH_PASSWORD: 'a-real-admin-pass',
    PLAYER_PASSWORD: 'a-real-player-pass',
    SESSION_SECRET: 'a-long-random-session-secret',
  };

  it('accepts a complete configuration', () => {
    const r = loadSettings(good, dir);
    assert.equal(r.ok, true);
  });

  it('reports every problem at once', () => {
    const r = loadSettings({ AUTH_PASSWORD: 'change-me-admin', SESSION_SECRET: 'short', PORT: '99999' }, dir);
    assert.equal(r.ok, false);
    if (r.ok) return;
    assert.ok(r.errors.some(e => /AUTH_PASSWORD still has the example value/.test(e)));
    assert.ok(r.errors.some(e => /SESSION_SECRET still has the example value/.test(e) || /SESSION_SECRET must be at least/.test(e)));
    assert.ok(r.errors.some(e => /PORT must be/.test(e)));
  });

  it('requires the player password to differ from the admin password', () => {
    const r = loadSettings({ ...good, PLAYER_PASSWORD: good.AUTH_PASSWORD }, dir);
    assert.equal(r.ok, false);
  });

  it('rejects unknown boolean values', () => {
    const r = loadSettings({ ...good, COOKIE_SECURE: 'yes' }, dir);
    assert.equal(r.ok, false);
  });
});
