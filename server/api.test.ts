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
const PLAYER = 'otjes-password-456';
const OTHER = 'other-password-789';
const SECRET = 'session-secret-0123456789';

interface Harness {
  base: string;
  close: () => Promise<void>;
}

async function start(overrides: Partial<AppConfig> = {}): Promise<Harness> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ligretto-test-'));
  const db = openDatabase(path.join(dir, 'test.db'), ['otjes', 'other']);
  const config: AppConfig = {
    authPassword: ADMIN,
    groups: [{ name: 'otjes', password: PLAYER }, { name: 'other', password: OTHER }],
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

async function groupId(base: string, admin: string, name: string): Promise<number> {
  const r = await call(base, 'GET', '/groups', undefined, admin);
  return r.body.find((g: any) => g.name === name).id;
}

async function seedPlayers(base: string, admin: string, names: string[], group = 'otjes') {
  const gid = await groupId(base, admin, group);
  const ids: Record<string, number> = {};
  for (const name of names) {
    const r = await call(base, 'POST', '/players', { name, group_id: gid }, admin);
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
      ['PATCH', `/games/${gameId}/trash`, undefined],
      ['DELETE', `/games/${gameId}`, undefined],
      ['POST', '/games/import', { player_names: ['a', 'b'], rounds: [], group_id: 1 }],
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
    const gid = await groupId(h.base, admin, 'otjes');
    const long = await call(h.base, 'POST', '/players', { name: 'x'.repeat(41), group_id: gid }, admin);
    assert.equal(long.status, 400);
    assert.match(long.body.error, /40 characters/);
    const ctrl = await call(h.base, 'POST', '/players', { name: 'bad\u0007name', group_id: gid }, admin);
    assert.equal(ctrl.status, 400);
  });

  it('accepts a 40-character name', async () => {
    const gid = await groupId(h.base, admin, 'otjes');
    const r = await call(h.base, 'POST', '/players', { name: 'y'.repeat(40), group_id: gid }, admin);
    assert.equal(r.status, 201);
  });

  it('rejects renames that collide case-insensitively', async () => {
    const r = await call(h.base, 'PATCH', `/players/${ids.Cy}`, { name: 'ANN' }, admin);
    assert.equal(r.status, 409);
  });

  it('rejects imports over the player and round limits', async () => {
    const gid = await groupId(h.base, admin, 'otjes');
    const names = Array.from({ length: 21 }, (_, i) => `P${i}`);
    const tooMany = await call(h.base, 'POST', '/games/import', { player_names: names, rounds: [], group_id: gid }, admin);
    assert.equal(tooMany.status, 400);
    const rounds = Array.from({ length: 201 }, () => ({ scores: [{ player_name: 'A', score: 0 }, { player_name: 'B', score: 0 }] }));
    const tooLong = await call(h.base, 'POST', '/games/import', { player_names: ['A', 'B'], rounds, group_id: gid }, admin);
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
    const gid = await groupId(h.base, admin, 'otjes');
    const imported = await call(h.base, 'POST', '/games/import', {
      group_id: gid,
      player_names: ['Ann', 'Ben'],
      rounds: [
        { scores: [{ player_name: 'Ann', score: 10 }, { player_name: 'Ben', score: 4 }] },
        { scores: [{ player_name: 'Ann', score: 0 }, { player_name: 'Ben', score: 6 }] },
      ],
    }, admin);
    assert.equal(imported.status, 201);

    const games = await call(h.base, 'GET', '/games', undefined, admin);
    const game = games.body.find((g: any) => g.id === imported.body.id);
    assert.deepEqual(game.winners, ['Ann', 'Ben']);

    const stats = await call(h.base, 'GET', '/stats', undefined, admin);
    const ann = stats.body.find((s: any) => s.name === 'Ann');
    assert.equal(ann.ties, 1);
    assert.equal(ann.wins, 0);
  });

  it('excludes trashed games from stats and winners', async () => {
    const gid = await groupId(h.base, admin, 'otjes');
    const before = await call(h.base, 'GET', '/stats', undefined, admin);
    const trashed = await call(h.base, 'POST', '/games/import', {
      group_id: gid,
      player_names: ['Cy', 'Ben'],
      rounds: [{ scores: [{ player_name: 'Cy', score: 99 }, { player_name: 'Ben', score: 0 }] }],
    }, admin);
    assert.equal((await call(h.base, 'PATCH', `/games/${trashed.body.id}/trash`, undefined, admin)).status, 200);
    const after = await call(h.base, 'GET', '/stats', undefined, admin);
    const cyBefore = before.body.find((s: any) => s.name === 'Cy');
    const cyAfter = after.body.find((s: any) => s.name === 'Cy');
    assert.equal(cyAfter.total_score, cyBefore?.total_score ?? 0);
  });

  it('keeps round numbers unique after a deletion', async () => {
    const g = await call(h.base, 'POST', '/games', { player_ids: [ids.Ann, ids.Ben] }, admin);
    const rounds = `/games/${g.body.id}/rounds`;
    const scores = { scores: [{ player_id: ids.Ann, score: 1 }, { player_id: ids.Ben, score: 1 }] };
    for (let i = 0; i < 3; i++) await call(h.base, 'POST', rounds, scores, admin);
    const detail = await call(h.base, 'GET', `/games/${g.body.id}`, undefined, admin);
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

  it('only admins can sign in when no groups are configured', async () => {
    const h = await start({ groups: [] });
    assert.equal(await login(h.base, ''), null);
    assert.equal((await call(h.base, 'POST', '/auth/login', { password: PLAYER })).status, 401);
    assert.ok(await login(h.base, ADMIN));
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
    GROUP_OTJES_PASSWORD: 'otjes-real-pass',
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

  it('requires group passwords to differ from the admin password and each other', () => {
    assert.equal(loadSettings({ ...good, GROUP_OTJES_PASSWORD: good.AUTH_PASSWORD }, dir).ok, false);
    assert.equal(loadSettings({ ...good, GROUP_FRIENDS_PASSWORD: good.GROUP_OTJES_PASSWORD }, dir).ok, false);
  });

  it('reads group names from GROUP_<NAME>_PASSWORD, lowercased', () => {
    const r = loadSettings({ ...good, GROUP_Friends_PASSWORD: 'friends-pass' }, dir);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual([...r.settings.groupNames].sort(), ['friends', 'otjes']);
  });

  it('warns about the retired PLAYER_PASSWORD instead of failing', () => {
    const r = loadSettings({ ...good, PLAYER_PASSWORD: 'old-value' }, dir);
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.ok(r.settings.warnings.some(w => /PLAYER_PASSWORD is no longer used/.test(w)));
  });

  it('rejects unknown boolean values', () => {
    const r = loadSettings({ ...good, COOKIE_SECURE: 'yes' }, dir);
    assert.equal(r.ok, false);
  });
});

describe('group isolation', () => {
  let h: Harness;
  let admin: string;
  let otjes: string;
  let other: string;
  let otjesIds: Record<string, number>;
  let otherIds: Record<string, number>;
  let otjesGame: number;

  before(async () => {
    h = await start();
    admin = (await login(h.base, ADMIN))!;
    otjes = (await login(h.base, PLAYER))!;
    other = (await login(h.base, OTHER))!;
    // Sam and Amber come from the one-time otjes seed, so look them up instead of creating them.
    const roster = (await call(h.base, 'GET', '/players', undefined, admin)).body as { id: number; name: string }[];
    otjesIds = Object.fromEntries(roster.filter(p => ['Sam', 'Amber'].includes(p.name)).map(p => [p.name, p.id]));
    assert.equal(Object.keys(otjesIds).length, 2, 'seeded Sam and Amber should exist');
    otherIds = await seedPlayers(h.base, admin, ['Zoe', 'Yan'], 'other');
    const g = await call(h.base, 'POST', '/games', { player_ids: [otjesIds.Sam, otjesIds.Amber] }, otjes);
    assert.equal(g.status, 201);
    otjesGame = g.body.id;
  });
  after(async () => { await h.close(); });

  it('reports the group on the session', async () => {
    const s = await call(h.base, 'GET', '/auth/session', undefined, otjes);
    assert.equal(s.body.role, 'player');
    assert.equal(s.body.group.name, 'otjes');
  });

  it('refuses anonymous reads', async () => {
    for (const url of ['/players', '/games', '/stats', `/games/${otjesGame}`]) {
      assert.equal((await call(h.base, 'GET', url)).status, 401, url);
    }
  });

  it('shows each group only its own players', async () => {
    // otjes sees its full seeded roster (17 names) and nothing from "other".
    const seen = (await call(h.base, 'GET', '/players', undefined, otjes)).body.map((p: any) => p.name);
    assert.equal(seen.length, 17);
    assert.ok(seen.includes('Sam') && seen.includes('Amber'));
    assert.ok(!seen.includes('Zoe') && !seen.includes('Yan'), 'otjes must not see other group');
    const seenOther = (await call(h.base, 'GET', '/players', undefined, other)).body.map((p: any) => p.name).sort();
    assert.deepEqual(seenOther, ['Yan', 'Zoe']);
  });

  it('hides other groups\' games, including by id', async () => {
    const list = await call(h.base, 'GET', '/games', undefined, other);
    assert.equal(list.body.length, 0);
    assert.equal((await call(h.base, 'GET', `/games/${otjesGame}`, undefined, other)).status, 404);
    assert.equal((await call(h.base, 'POST', `/games/${otjesGame}/rounds`, {
      scores: [{ player_id: otjesIds.Sam, score: 1 }, { player_id: otjesIds.Amber, score: 1 }],
    }, other)).status, 404);
  });

  it('blocks starting a game with players from another group', async () => {
    const r = await call(h.base, 'POST', '/games', { player_ids: [otjesIds.Sam, otherIds.Zoe] }, otjes);
    assert.equal(r.status, 400);
    const mixedAsAdmin = await call(h.base, 'POST', '/games', { player_ids: [otjesIds.Sam, otherIds.Zoe] }, admin);
    assert.equal(mixedAsAdmin.status, 400);
  });

  it('keeps stats within the group', async () => {
    await call(h.base, 'POST', `/games/${otjesGame}/rounds`, {
      scores: [{ player_id: otjesIds.Sam, score: 9 }, { player_id: otjesIds.Amber, score: 2 }],
    }, otjes);
    const names = (await call(h.base, 'GET', '/stats', undefined, other)).body.map((s: any) => s.name).sort();
    assert.deepEqual(names, ['Yan', 'Zoe']);
  });

  it('lets the admin see every group', async () => {
    // 17 seeded otjes players + the 2 created in "other".
    const players = (await call(h.base, 'GET', '/players', undefined, admin)).body;
    assert.equal(players.length, 19);
    const groups = (await call(h.base, 'GET', '/groups', undefined, admin)).body.map((g: any) => g.name).sort();
    assert.deepEqual(groups, ['other', 'otjes']);
    const own = (await call(h.base, 'GET', '/groups', undefined, otjes)).body.map((g: any) => g.name);
    assert.deepEqual(own, ['otjes']);
  });

  it('seeds the otjes roster exactly once', async () => {
    const fresh = await start();
    const a = (await login(fresh.base, ADMIN))!;
    const names = (await call(fresh.base, 'GET', '/players', undefined, a)).body.map((p: any) => p.name);
    for (const expected of ['Sam', 'Amber', 'Colin', 'Syla', 'Els', 'Jodi', 'Julia', 'Leon', 'Maaike', 'Mick', 'Maarten', 'Matthys', 'Nick', 'Sofie', 'Sterre', 'Steve', 'Ties']) {
      assert.ok(names.includes(expected), `missing ${expected}`);
    }
    assert.equal(names.length, 17);
    await fresh.close();
  });

  it('refuses to import a player who belongs to another group', async () => {
    const gid = await groupId(h.base, admin, 'other');
    const r = await call(h.base, 'POST', '/games/import', {
      group_id: gid,
      player_names: ['Sam', 'Zoe'],
      rounds: [{ scores: [{ player_name: 'Sam', score: 1 }, { player_name: 'Zoe', score: 1 }] }],
    }, admin);
    assert.equal(r.status, 409);
  });
});

describe('upgrading a database from before groups', () => {
  it('moves a pre-group game into otjes only when everyone in it is an otjes player', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ligretto-legacy-'));
    const file = path.join(dir, 'legacy.db');
    let db = openDatabase(file, ['otjes']);
    const otjes = db.prepare("SELECT id FROM groups WHERE name = 'otjes'").get() as any;
    const sam = db.prepare("SELECT id FROM players WHERE name = 'Sam'").get() as any;
    const amber = db.prepare("SELECT id FROM players WHERE name = 'Amber'").get() as any;
    // Simulate pre-group data: an outsider, one all-otjes game and one mixed game, with no group set.
    const oldie = db.prepare("INSERT INTO players (name, group_id) VALUES ('Oldie', NULL)").run();
    const allOtjes = db.prepare('INSERT INTO games (group_id) VALUES (NULL)').run();
    const mixed = db.prepare('INSERT INTO games (group_id) VALUES (NULL)').run();
    const seat = db.prepare('INSERT INTO game_players (game_id, player_id) VALUES (?, ?)');
    seat.run(allOtjes.lastInsertRowid, sam.id);
    seat.run(allOtjes.lastInsertRowid, amber.id);
    seat.run(mixed.lastInsertRowid, sam.id);
    seat.run(mixed.lastInsertRowid, oldie.lastInsertRowid);
    db.prepare("DELETE FROM schema_migrations WHERE name = 'assign-legacy-data-to-otjes'").run();
    db.close();

    db = openDatabase(file, ['otjes']);
    const groupOf = (id: number | bigint) => (db.prepare('SELECT group_id FROM games WHERE id = ?').get(id) as any).group_id;
    assert.equal(groupOf(allOtjes.lastInsertRowid), otjes.id, 'all-otjes game joins otjes');
    assert.equal(groupOf(mixed.lastInsertRowid), null, 'game with an outsider stays ungrouped');
    const oldieRow = db.prepare("SELECT group_id FROM players WHERE name = 'Oldie'").get() as any;
    assert.equal(oldieRow.group_id, null, 'outsider is not regrouped');
    db.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});

describe('finishing games as a member', () => {
  it('lets a member finish their own group\'s game but not another group\'s', async () => {
    const h = await start();
    const admin = (await login(h.base, ADMIN))!;
    const otjes = (await login(h.base, PLAYER))!;
    const other = (await login(h.base, OTHER))!;
    const roster = (await call(h.base, 'GET', '/players', undefined, admin)).body as { id: number; name: string }[];
    const ids = roster.filter(p => ['Sam', 'Amber'].includes(p.name)).map(p => p.id);
    const game = await call(h.base, 'POST', '/games', { player_ids: ids }, otjes);
    assert.equal(game.status, 201);

    assert.equal((await call(h.base, 'PATCH', `/games/${game.body.id}/finish`, undefined, other)).status, 404);
    assert.equal((await call(h.base, 'PATCH', `/games/${game.body.id}/finish`, undefined)).status, 401);
    const done = await call(h.base, 'PATCH', `/games/${game.body.id}/finish`, undefined, otjes);
    assert.equal(done.status, 200);
    assert.ok(done.body.finished_at);
    // Locked afterwards, even for the member who finished it.
    assert.equal((await call(h.base, 'POST', `/games/${game.body.id}/rounds`, {
      scores: ids.map(id => ({ player_id: id, score: 0 })),
    }, otjes)).status, 409);
    await h.close();
  });
});
