import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import type Database from 'better-sqlite3';
import {
  MAX_ABS_SCORE,
  MAX_IMPORT_PLAYERS,
  MAX_IMPORT_ROUNDS,
  createRateLimiter,
  findWinners,
  normalizePlayerIds,
  normalizePlayerName,
  parseRoundScores,
  validatePlayerName,
} from './logic.js';

export interface GroupCredential {
  name: string;
  password: string;
}

export interface AppConfig {
  /** Admin password: sees and changes everything. */
  authPassword: string;
  /** Each group's password lets its members see and play only their own group. */
  groups: GroupCredential[];
  sessionSecret: string;
  cookieSecure: boolean;
  /** Set when running behind a reverse proxy, so client IPs come from X-Forwarded-For. */
  trustProxy: boolean;
  /** Built frontend to serve. Omit to run API-only (e.g. in tests). */
  distDir?: string;
}

type Role = 'admin' | 'player';

interface SessionPayload {
  role: Role;
  /** Group the session is limited to. Null for admins, who see every group. */
  groupId: number | null;
  exp: number;
}

interface GameRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  deleted_at: string | null;
  group_id: number | null;
}

const SESSION_COOKIE = 'ligretto_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

export function createApp(db: Database.Database, config: AppConfig) {
  const AUTH_PASSWORD = config.authPassword;
  const SESSION_SECRET = config.sessionSecret;
  const COOKIE_SECURE = config.cookieSecure;

  const app = express();
  if (config.trustProxy) app.set('trust proxy', 1);
  app.use(cors());
  app.use(express.json({ limit: '100kb' }));

  const loginLimiter = createRateLimiter(LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);

  // --- helpers ---

  function getRouteParam(value: string | string[]) {
    return Array.isArray(value) ? value[0] : value;
  }

  function base64UrlEncode(value: string) {
    return Buffer.from(value, 'utf8').toString('base64url');
  }

  function base64UrlDecode(value: string) {
    return Buffer.from(value, 'base64url').toString('utf8');
  }

  function signSession(data: string) {
    return crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('base64url');
  }

  function encodeSession(payload: SessionPayload) {
    const data = base64UrlEncode(JSON.stringify(payload));
    return `${data}.${signSession(data)}`;
  }

  function parseCookies(header?: string) {
    if (!header) return {};

    return header.split(';').reduce<Record<string, string>>((cookies, part) => {
      const [rawName, ...rawValue] = part.trim().split('=');
      if (!rawName) return cookies;
      try {
        cookies[rawName] = decodeURIComponent(rawValue.join('='));
      } catch {
        // Ignore malformed cookie encodings rather than failing the request.
      }
      return cookies;
    }, {});
  }

  function decodeSession(token?: string): SessionPayload | null {
    if (!token) return null;

    const [data, signature] = token.split('.');
    if (!data || !signature) return null;

    const expected = Buffer.from(signSession(data), 'utf8');
    const provided = Buffer.from(signature, 'utf8');
    if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
      return null;
    }

    try {
      const payload = JSON.parse(base64UrlDecode(data)) as SessionPayload;
      if (typeof payload.exp !== 'number' || payload.exp <= Date.now()) return null;
      if (payload.role === 'admin') return { ...payload, groupId: null };
      if (payload.role === 'player' && Number.isInteger(payload.groupId)) return payload;
      return null;
    } catch {
      return null;
    }
  }

  function getSession(req: express.Request): SessionPayload | null {
    return decodeSession(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  }

  function cookieAttributes(maxAgeSeconds: number) {
    return [
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${maxAgeSeconds}`,
      ...(COOKIE_SECURE ? ['Secure'] : []),
    ].join('; ');
  }

  function setSessionCookie(res: express.Response, payload: SessionPayload) {
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=${encodeURIComponent(encodeSession(payload))}; ${cookieAttributes(Math.floor(SESSION_TTL_MS / 1000))}`,
    );
  }

  function clearSessionCookie(res: express.Response) {
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttributes(0)}`);
  }

  /** The group a session may see, or null for admins (all groups). */
  function scopeOf(session: SessionPayload): number | null {
    return session.role === 'admin' ? null : session.groupId;
  }

  function sessionFor(res: express.Response): SessionPayload {
    return res.locals.session as SessionPayload;
  }

  // Requires any signed-in user. Each route then applies its group scope.
  function requireMember(req: express.Request, res: express.Response, next: express.NextFunction) {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Sign in required' });
    res.locals.session = session;
    next();
  }

  function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
    const session = getSession(req);
    if (!session) return res.status(401).json({ error: 'Sign in required' });
    if (session.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    res.locals.session = session;
    next();
  }

  function passwordsMatch(input: string, expected: string) {
    // Hash both sides so the comparison is constant-time regardless of length.
    const inputDigest = crypto.createHash('sha256').update(input, 'utf8').digest();
    const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
    return crypto.timingSafeEqual(inputDigest, expectedDigest);
  }

  function groupById(id: number) {
    return db.prepare('SELECT id, name FROM groups WHERE id = ?').get(id) as { id: number; name: string } | undefined;
  }

  function groupIdByName(name: string) {
    const row = db.prepare('SELECT id FROM groups WHERE name = ?').get(name) as { id: number } | undefined;
    return row?.id ?? null;
  }

  /** Loads a game only if the session may see it. Returns null for games outside the scope. */
  function gameInScope(gameId: string | number, session: SessionPayload): GameRow | null {
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as GameRow | undefined;
    if (!game) return null;
    const scope = scopeOf(session);
    if (scope !== null && game.group_id !== scope) return null;
    return game;
  }

  function getWinnersByGame(includeTrashed: boolean, scope: number | null): Map<number, string[]> {
    const rows = db.prepare(`
      SELECT gp.game_id AS game_id, p.name AS name, COALESCE(SUM(rs.score), 0) AS total
      FROM game_players gp
      JOIN games g ON g.id = gp.game_id AND g.finished_at IS NOT NULL
        ${includeTrashed ? '' : 'AND g.deleted_at IS NULL'}
        AND (@scope IS NULL OR g.group_id = @scope)
      JOIN players p ON p.id = gp.player_id
      JOIN rounds r ON r.game_id = gp.game_id
      LEFT JOIN round_scores rs ON rs.round_id = r.id AND rs.player_id = gp.player_id
      GROUP BY gp.game_id, gp.player_id
    `).all({ scope }) as { game_id: number; name: string; total: number }[];

    const byGame = new Map<number, { name: string; total: number }[]>();
    for (const row of rows) {
      const list = byGame.get(row.game_id) ?? [];
      list.push({ name: row.name, total: row.total });
      byGame.set(row.game_id, list);
    }

    const winners = new Map<number, string[]>();
    for (const [gameId, totals] of byGame) {
      winners.set(gameId, findWinners(totals));
    }
    return winners;
  }

  function getGames(includeDeleted: boolean, scope: number | null) {
    const games = db.prepare(`
      SELECT g.*,
        grp.name AS group_name,
        (SELECT COUNT(*) FROM rounds WHERE game_id = g.id) AS round_count,
        (SELECT GROUP_CONCAT(p.name, ', ')
         FROM game_players gp JOIN players p ON p.id = gp.player_id
         WHERE gp.game_id = g.id) AS player_names
      FROM games g
      LEFT JOIN groups grp ON grp.id = g.group_id
      WHERE g.deleted_at IS ${includeDeleted ? 'NOT' : ''} NULL
        AND (@scope IS NULL OR g.group_id = @scope)
      ORDER BY COALESCE(g.deleted_at, g.started_at) DESC, g.id DESC
    `).all({ scope }) as (GameRow & { round_count: number; player_names: string | null; group_name: string | null })[];

    const winners = getWinnersByGame(includeDeleted, scope);
    return games.map(game => ({ ...game, winners: winners.get(game.id) ?? [] }));
  }

  function getRoundRows(roundId: number | bigint | string) {
    return db.prepare(`
      SELECT r.*, rs.player_id, rs.cards_played, rs.cards_in_hand, rs.score
      FROM rounds r
      JOIN round_scores rs ON rs.round_id = r.id
      WHERE r.id = ?
      ORDER BY rs.player_id
    `).all(roundId);
  }

  /** Checks a game exists, is in scope, and isn't trashed. Sends the error response itself. */
  function findEditableRound(gameId: string, roundId: string, res: express.Response, session: SessionPayload) {
    const game = gameInScope(gameId, session);
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return null;
    }
    if (game.deleted_at) {
      res.status(409).json({ error: 'Cannot edit a deleted game' });
      return null;
    }
    if (game.finished_at) {
      res.status(409).json({ error: 'Cannot change rounds in a finished game' });
      return null;
    }
    const round = db.prepare('SELECT id FROM rounds WHERE id = ? AND game_id = ?').get(roundId, gameId);
    if (!round) {
      res.status(404).json({ error: 'Round not found' });
      return null;
    }
    return game;
  }

  // --- health ---

  app.get('/api/health', (_req, res) => {
    try {
      db.prepare('SELECT 1').get();
      res.json({ status: 'ok' });
    } catch {
      res.status(503).json({ status: 'error' });
    }
  });

  // --- auth ---

  app.get('/api/auth/session', (req, res) => {
    const session = getSession(req);
    const group = session?.groupId != null ? groupById(session.groupId) : undefined;
    res.json({
      authenticated: Boolean(session),
      role: session?.role ?? null,
      group: group ? { id: group.id, name: group.name } : null,
    });
  });

  app.post('/api/auth/login', (req, res) => {
    const ip = req.ip ?? 'unknown';
    if (!loginLimiter.hit(ip)) {
      return res.status(429).json({ error: 'Too many sign-in attempts. Try again in a few minutes.' });
    }

    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }

    let session: SessionPayload | null = null;
    if (passwordsMatch(password, AUTH_PASSWORD)) {
      session = { role: 'admin', groupId: null, exp: Date.now() + SESSION_TTL_MS };
    } else {
      for (const group of config.groups) {
        if (passwordsMatch(password, group.password)) {
          const groupId = groupIdByName(group.name);
          if (groupId !== null) {
            session = { role: 'player', groupId, exp: Date.now() + SESSION_TTL_MS };
          }
          break;
        }
      }
    }

    if (!session) {
      return res.status(401).json({ error: 'Invalid password' });
    }

    loginLimiter.reset(ip);
    setSessionCookie(res, session);
    const group = session.groupId != null ? groupById(session.groupId) : undefined;
    res.json({
      authenticated: true,
      role: session.role,
      group: group ? { id: group.id, name: group.name } : null,
    });
  });

  app.post('/api/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ authenticated: false, role: null, group: null });
  });

  // --- groups ---

  app.get('/api/groups', requireMember, (_req, res) => {
    const scope = scopeOf(sessionFor(res));
    res.json(db.prepare(`
      SELECT id, name FROM groups
      WHERE @scope IS NULL OR id = @scope
      ORDER BY name
    `).all({ scope }));
  });

  // --- players ---

  app.get('/api/players', requireMember, (_req, res) => {
    const scope = scopeOf(sessionFor(res));
    const players = db.prepare(`
      SELECT p.id, p.name, p.created_at, p.group_id, g.name AS group_name
      FROM players p
      LEFT JOIN groups g ON g.id = p.group_id
      WHERE @scope IS NULL OR p.group_id = @scope
      ORDER BY g.name, p.name
    `).all({ scope });
    res.json(players);
  });

  app.post('/api/players', requireAdmin, (req, res) => {
    const check = validatePlayerName(req.body?.name);
    if (!check.ok) return res.status(400).json({ error: check.error });

    const groupId = Number(req.body?.group_id);
    if (!Number.isInteger(groupId) || !groupById(groupId)) {
      return res.status(400).json({ error: 'Choose a group for this player' });
    }

    try {
      const result = db.prepare('INSERT INTO players (name, group_id) VALUES (?, ?)').run(check.name, groupId);
      res.status(201).json(db.prepare(`
        SELECT p.id, p.name, p.created_at, p.group_id, g.name AS group_name
        FROM players p LEFT JOIN groups g ON g.id = p.group_id WHERE p.id = ?
      `).get(result.lastInsertRowid));
    } catch {
      res.status(409).json({ error: 'Player name already exists' });
    }
  });

  app.patch('/api/players/:id', requireAdmin, (req, res) => {
    const playerId = Number(getRouteParam(req.params.id));
    if (!Number.isInteger(playerId) || playerId <= 0) {
      return res.status(400).json({ error: 'Invalid player id' });
    }

    const player = db.prepare('SELECT id, group_id FROM players WHERE id = ?').get(playerId) as
      | { id: number; group_id: number | null }
      | undefined;
    if (!player) return res.status(404).json({ error: 'Player not found' });

    let name: string | undefined;
    if (req.body?.name !== undefined) {
      const check = validatePlayerName(req.body.name);
      if (!check.ok) return res.status(400).json({ error: check.error });
      name = check.name;
    }

    let groupId: number | undefined;
    if (req.body?.group_id !== undefined) {
      groupId = Number(req.body.group_id);
      if (!Number.isInteger(groupId) || !groupById(groupId)) {
        return res.status(400).json({ error: 'Choose a valid group' });
      }
      if (groupId !== player.group_id) {
        const hasHistory = db.prepare(`
          SELECT EXISTS(SELECT 1 FROM game_players WHERE player_id = ?) AS has_games
        `).get(playerId) as { has_games: number };
        if (hasHistory.has_games) {
          return res.status(409).json({ error: 'Players with game history cannot be moved to another group' });
        }
      }
    }

    if (name === undefined && groupId === undefined) {
      return res.status(400).json({ error: 'Nothing to update' });
    }

    try {
      db.prepare('UPDATE players SET name = COALESCE(?, name), group_id = COALESCE(?, group_id) WHERE id = ?')
        .run(name ?? null, groupId ?? null, playerId);
    } catch {
      return res.status(409).json({ error: 'Player name already exists' });
    }
    res.json(db.prepare(`
      SELECT p.id, p.name, p.created_at, p.group_id, g.name AS group_name
      FROM players p LEFT JOIN groups g ON g.id = p.group_id WHERE p.id = ?
    `).get(playerId));
  });

  app.delete('/api/players/:id', requireAdmin, (req, res) => {
    const playerId = Number(getRouteParam(req.params.id));
    if (!Number.isInteger(playerId) || playerId <= 0) {
      return res.status(400).json({ error: 'Invalid player id' });
    }

    const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
    if (!player) {
      return res.status(404).json({ error: 'Player not found' });
    }

    const usage = db.prepare(`
      SELECT EXISTS(SELECT 1 FROM game_players WHERE player_id = ?) AS has_games,
             EXISTS(SELECT 1 FROM round_scores WHERE player_id = ?) AS has_rounds
    `).get(playerId, playerId) as { has_games: number; has_rounds: number };

    if (usage.has_games || usage.has_rounds) {
      return res.status(409).json({ error: 'Cannot delete a player with game history' });
    }

    db.prepare('DELETE FROM players WHERE id = ?').run(playerId);
    res.status(204).end();
  });

  // --- games ---

  app.get('/api/games', requireMember, (_req, res) => {
    res.json(getGames(false, scopeOf(sessionFor(res))));
  });

  app.get('/api/games/trash', requireMember, (_req, res) => {
    res.json(getGames(true, scopeOf(sessionFor(res))));
  });

  app.post('/api/games', requireMember, (req, res) => {
    const session = sessionFor(res);
    const playerIds = normalizePlayerIds(req.body?.player_ids);
    if (!playerIds || playerIds.length < 2) {
      return res.status(400).json({ error: 'At least 2 players required' });
    }

    // Players outside the session's group count as unknown, so their existence isn't revealed.
    const scope = scopeOf(session);
    const found = db.prepare(`
      SELECT id, group_id FROM players
      WHERE id IN (${playerIds.map(() => '?').join(', ')})
        AND (@scope IS NULL OR group_id = @scope)
    `).all(...playerIds, { scope }) as { id: number; group_id: number | null }[];

    if (found.length !== playerIds.length) {
      return res.status(400).json({ error: 'All players must exist and belong to the same group' });
    }
    const groups = new Set(found.map(p => p.group_id));
    if (groups.size !== 1 || groups.has(null)) {
      return res.status(400).json({ error: 'All players must belong to the same group' });
    }
    const groupId = [...groups][0] as number;

    try {
      const createGame = db.transaction(() => {
        const result = db.prepare('INSERT INTO games (group_id) VALUES (?)').run(groupId);
        const gameId = result.lastInsertRowid;
        const insertPlayer = db.prepare('INSERT INTO game_players (game_id, player_id) VALUES (?, ?)');
        for (const playerId of playerIds) {
          insertPlayer.run(gameId, playerId);
        }
        return db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
      });

      res.status(201).json(createGame());
    } catch {
      res.status(500).json({ error: 'Failed to create game' });
    }
  });

  app.post('/api/games/import', requireAdmin, (req, res) => {
    const rawPlayers = Array.isArray(req.body?.player_names) ? req.body.player_names : null;
    const rawRounds = Array.isArray(req.body?.rounds) ? req.body.rounds : null;
    const groupId = Number(req.body?.group_id);

    if (!rawPlayers || !rawRounds) {
      return res.status(400).json({ error: 'Player names and rounds are required' });
    }
    if (!Number.isInteger(groupId) || !groupById(groupId)) {
      return res.status(400).json({ error: 'Choose a group for this game' });
    }
    if (rawPlayers.length > MAX_IMPORT_PLAYERS) {
      return res.status(400).json({ error: `Import supports up to ${MAX_IMPORT_PLAYERS} players` });
    }
    if (rawRounds.length > MAX_IMPORT_ROUNDS) {
      return res.status(400).json({ error: `Import supports up to ${MAX_IMPORT_ROUNDS} rounds` });
    }

    const playerNames = rawPlayers
      .map(normalizePlayerName)
      .filter(Boolean);

    if (playerNames.length < 2) {
      return res.status(400).json({ error: 'At least 2 players are required' });
    }

    if (new Set(playerNames).size !== playerNames.length) {
      return res.status(400).json({ error: 'Player names must be unique' });
    }

    if (rawRounds.length === 0) {
      return res.status(400).json({ error: 'At least 1 round is required' });
    }

    const rounds = rawRounds as { scores: { player_name: string; score: number }[] }[];
    for (const round of rounds) {
      if (!Array.isArray(round?.scores) || round.scores.length !== playerNames.length) {
        return res.status(400).json({ error: 'Each round must include one score for each player' });
      }

      const roundNames = round.scores.map(score => normalizePlayerName(score?.player_name));
      if (new Set(roundNames).size !== playerNames.length) {
        return res.status(400).json({ error: 'Each round must contain each player exactly once' });
      }

      for (const score of round.scores) {
        const playerName = normalizePlayerName(score?.player_name);
        const value = score?.score;
        if (
          !playerNames.includes(playerName)
          || !Number.isInteger(value)
          || Math.abs(value as number) > MAX_ABS_SCORE
        ) {
          return res.status(400).json({ error: 'Imported scores must use known players and whole-number values' });
        }
      }
    }

    try {
      const importGame = db.transaction(() => {
        const selectPlayer = db.prepare('SELECT id, group_id FROM players WHERE name = ? COLLATE NOCASE');
        const insertPlayer = db.prepare('INSERT INTO players (name, group_id) VALUES (?, ?)');
        const assignGroup = db.prepare('UPDATE players SET group_id = ? WHERE id = ?');
        const insertGame = db.prepare('INSERT INTO games (group_id) VALUES (?)');
        const insertGamePlayer = db.prepare('INSERT INTO game_players (game_id, player_id) VALUES (?, ?)');
        const insertRound = db.prepare('INSERT INTO rounds (game_id, round_number) VALUES (?, ?)');
        const insertRoundScore = db.prepare(
          'INSERT INTO round_scores (round_id, player_id, cards_played, cards_in_hand, score) VALUES (?, ?, ?, ?, ?)'
        );

        const playersByName = new Map<string, { id: number }>();
        for (const playerName of playerNames) {
          let player = selectPlayer.get(playerName) as { id: number; group_id: number | null } | undefined;
          if (!player) {
            const result = insertPlayer.run(playerName, groupId);
            player = { id: Number(result.lastInsertRowid), group_id: groupId };
          } else if (player.group_id === null) {
            assignGroup.run(groupId, player.id);
          } else if (player.group_id !== groupId) {
            throw new ImportConflict(`${playerName} already belongs to another group`);
          }
          playersByName.set(playerName, player);
        }

        const gameResult = insertGame.run(groupId);
        const gameId = Number(gameResult.lastInsertRowid);

        for (const playerName of playerNames) {
          insertGamePlayer.run(gameId, playersByName.get(playerName)!.id);
        }

        for (const [index, round] of rounds.entries()) {
          const roundId = Number(insertRound.run(gameId, index + 1).lastInsertRowid);
          for (const score of round.scores) {
            const player = playersByName.get(normalizePlayerName(score.player_name))!;
            insertRoundScore.run(roundId, player.id, null, null, score.score);
          }
        }

        db.prepare("UPDATE games SET finished_at = datetime('now') WHERE id = ?").run(gameId);
        return db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
      });

      res.status(201).json(importGame());
    } catch (err) {
      if (err instanceof ImportConflict) return res.status(409).json({ error: err.message });
      res.status(500).json({ error: 'Failed to import game' });
    }
  });

  // Any member can finish a game in their own group; admins can finish any game.
  app.patch('/api/games/:id/finish', requireMember, (req, res) => {
    const gameId = getRouteParam(req.params.id);
    const game = gameInScope(gameId, sessionFor(res));
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.deleted_at) return res.status(409).json({ error: 'Cannot finish a deleted game' });

    // Idempotent: finishing an already-finished game keeps its original finish time.
    db.prepare("UPDATE games SET finished_at = datetime('now') WHERE id = ? AND finished_at IS NULL").run(gameId);
    res.json(db.prepare('SELECT * FROM games WHERE id = ?').get(gameId));
  });

  app.patch('/api/games/:id/trash', requireAdmin, (req, res) => {
    const gameId = getRouteParam(req.params.id);
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as GameRow | undefined;
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.deleted_at) return res.status(409).json({ error: 'Game is already in the trash' });

    db.prepare("UPDATE games SET deleted_at = datetime('now') WHERE id = ?").run(gameId);
    res.json(db.prepare('SELECT * FROM games WHERE id = ?').get(gameId));
  });

  app.patch('/api/games/:id/restore', requireAdmin, (req, res) => {
    const gameId = getRouteParam(req.params.id);
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as GameRow | undefined;
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (!game.deleted_at) return res.status(409).json({ error: 'Game is not in the trash' });

    db.prepare('UPDATE games SET deleted_at = NULL WHERE id = ?').run(gameId);
    res.json(db.prepare('SELECT * FROM games WHERE id = ?').get(gameId));
  });

  app.delete('/api/games/:id', requireAdmin, (req, res) => {
    const gameId = getRouteParam(req.params.id);
    const game = db.prepare('SELECT id FROM games WHERE id = ?').get(gameId);
    if (!game) return res.status(404).json({ error: 'Game not found' });

    db.prepare('DELETE FROM games WHERE id = ?').run(gameId);
    res.status(204).end();
  });

  app.get('/api/games/:id', requireMember, (req, res) => {
    const gameId = getRouteParam(req.params.id);
    const game = gameInScope(gameId, sessionFor(res));
    if (!game) return res.status(404).json({ error: 'Game not found' });

    const players = db.prepare(`
      SELECT p.* FROM players p
      JOIN game_players gp ON gp.player_id = p.id
      WHERE gp.game_id = ?
      ORDER BY p.name
    `).all(gameId);

    const rounds = db.prepare(`
      SELECT r.*, rs.player_id, rs.cards_played, rs.cards_in_hand, rs.score
      FROM rounds r
      JOIN round_scores rs ON rs.round_id = r.id
      WHERE r.game_id = ?
      ORDER BY r.round_number, rs.player_id
    `).all(gameId);

    res.json({ game, players, rounds });
  });

  // --- players joining mid-game ---

  // Any member can add a player from the game's own group while the game is unfinished.
  // The newcomer has no score for earlier rounds and must be scored from the next round on.
  app.post('/api/games/:id/players', requireMember, (req, res) => {
    const gameId = getRouteParam(req.params.id);
    const game = gameInScope(gameId, sessionFor(res));
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.deleted_at) return res.status(409).json({ error: 'Cannot edit a deleted game' });
    if (game.finished_at) return res.status(409).json({ error: 'Cannot add players to a finished game' });

    const playerId = Number(req.body?.player_id);
    if (!Number.isInteger(playerId) || playerId <= 0) {
      return res.status(400).json({ error: 'Choose a player to add' });
    }
    const player = db.prepare('SELECT id, name, group_id FROM players WHERE id = ?').get(playerId) as
      | { id: number; name: string; group_id: number | null }
      | undefined;
    if (!player || player.group_id !== game.group_id) {
      return res.status(400).json({ error: 'That player is not in this game’s group' });
    }
    if (db.prepare('SELECT 1 FROM game_players WHERE game_id = ? AND player_id = ?').get(gameId, playerId)) {
      return res.status(409).json({ error: `${player.name} is already in this game` });
    }

    db.prepare('INSERT INTO game_players (game_id, player_id) VALUES (?, ?)').run(gameId, playerId);
    res.status(201).json(db.prepare(`
      SELECT p.* FROM players p
      JOIN game_players gp ON gp.player_id = p.id
      WHERE gp.game_id = ?
      ORDER BY p.name
    `).all(gameId));
  });

  // --- rounds ---

  app.post('/api/games/:id/rounds', requireMember, (req, res) => {
    const gameId = getRouteParam(req.params.id);
    const game = gameInScope(gameId, sessionFor(res));
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.deleted_at) return res.status(409).json({ error: 'Cannot edit a deleted game' });
    if (game.finished_at) return res.status(409).json({ error: 'Cannot add rounds to a finished game' });

    const gamePlayerIds = (db.prepare(
      'SELECT player_id FROM game_players WHERE game_id = ?'
    ).all(gameId) as { player_id: number }[]).map(row => row.player_id);

    const parsed = parseRoundScores(req.body?.scores, gamePlayerIds);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    const insertRound = db.transaction(() => {
      const { max } = db.prepare(
        'SELECT COALESCE(MAX(round_number), 0) AS max FROM rounds WHERE game_id = ?'
      ).get(gameId) as { max: number };

      const roundId = db.prepare('INSERT INTO rounds (game_id, round_number) VALUES (?, ?)')
        .run(gameId, max + 1).lastInsertRowid;

      const insertScore = db.prepare(
        'INSERT INTO round_scores (round_id, player_id, cards_played, cards_in_hand, score) VALUES (?, ?, ?, ?, ?)'
      );
      for (const s of parsed.value) {
        insertScore.run(roundId, s.player_id, s.cards_played, s.cards_in_hand, s.score);
      }
      return roundId;
    });

    const roundId = insertRound();
    res.status(201).json(getRoundRows(roundId));
  });

  app.put('/api/games/:gameId/rounds/:roundId', requireAdmin, (req, res) => {
    const gameId = getRouteParam(req.params.gameId);
    const roundId = getRouteParam(req.params.roundId);
    if (!findEditableRound(gameId, roundId, res, sessionFor(res))) return;

    const gamePlayerIds = (db.prepare(
      'SELECT player_id FROM game_players WHERE game_id = ?'
    ).all(gameId) as { player_id: number }[]).map(row => row.player_id);

    const parsed = parseRoundScores(req.body?.scores, gamePlayerIds);
    if (!parsed.ok) return res.status(400).json({ error: parsed.error });

    db.transaction(() => {
      db.prepare('DELETE FROM round_scores WHERE round_id = ?').run(roundId);
      const insertScore = db.prepare(
        'INSERT INTO round_scores (round_id, player_id, cards_played, cards_in_hand, score) VALUES (?, ?, ?, ?, ?)'
      );
      for (const s of parsed.value) {
        insertScore.run(roundId, s.player_id, s.cards_played, s.cards_in_hand, s.score);
      }
    })();

    res.json(getRoundRows(roundId));
  });

  app.delete('/api/games/:gameId/rounds/:roundId', requireAdmin, (req, res) => {
    const gameId = getRouteParam(req.params.gameId);
    const roundId = getRouteParam(req.params.roundId);
    const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as GameRow | undefined;
    if (!game) return res.status(404).json({ error: 'Game not found' });
    if (game.deleted_at) return res.status(409).json({ error: 'Cannot edit a deleted game' });
    if (game.finished_at) return res.status(409).json({ error: 'Cannot change rounds in a finished game' });

    const result = db.prepare('DELETE FROM rounds WHERE id = ? AND game_id = ?').run(roundId, gameId);
    if (result.changes === 0) return res.status(404).json({ error: 'Round not found' });
    res.status(204).end();
  });

  // --- stats ---

  app.get('/api/stats', requireMember, (_req, res) => {
    const scope = scopeOf(sessionFor(res));

    // Outright wins vs shared wins (ties), over finished, non-trashed games in scope.
    const wins = new Map<string, { wins: number; ties: number }>();
    for (const names of getWinnersByGame(false, scope).values()) {
      for (const name of names) {
        const entry = wins.get(name) ?? { wins: 0, ties: 0 };
        if (names.length === 1) entry.wins += 1;
        else entry.ties += 1;
        wins.set(name, entry);
      }
    }

    const stats = db.prepare(`
      WITH game_counts AS (
        SELECT gp.player_id, COUNT(*) AS games_played
        FROM game_players gp
        JOIN games g ON g.id = gp.game_id
        WHERE g.deleted_at IS NULL
          AND (@scope IS NULL OR g.group_id = @scope)
        GROUP BY gp.player_id
      ),
      round_stats AS (
        SELECT
          rs.player_id,
          COUNT(*) AS rounds_played,
          COALESCE(SUM(rs.score), 0) AS total_score,
          COALESCE(ROUND(AVG(rs.score), 1), 0) AS avg_score_per_round,
          MAX(rs.score) AS best_round,
          MIN(rs.score) AS worst_round
        FROM round_scores rs
        JOIN rounds r ON r.id = rs.round_id
        JOIN games g ON g.id = r.game_id
        WHERE g.deleted_at IS NULL
          AND (@scope IS NULL OR g.group_id = @scope)
        GROUP BY rs.player_id
      )
      SELECT
        p.id,
        p.name,
        COALESCE(gc.games_played, 0) AS games_played,
        COALESCE(rs.rounds_played, 0) AS rounds_played,
        COALESCE(rs.total_score, 0) AS total_score,
        CASE
          WHEN COALESCE(gc.games_played, 0) = 0 THEN 0
          ELSE ROUND(COALESCE(rs.total_score, 0) * 1.0 / gc.games_played, 1)
        END AS avg_score_per_game,
        COALESCE(rs.avg_score_per_round, 0) AS avg_score_per_round,
        rs.best_round AS best_round,
        rs.worst_round AS worst_round
      FROM players p
      LEFT JOIN game_counts gc ON gc.player_id = p.id
      LEFT JOIN round_stats rs ON rs.player_id = p.id
      WHERE @scope IS NULL OR p.group_id = @scope
      ORDER BY total_score DESC, p.name
    `).all({ scope }) as { name: string }[];

    res.json(stats.map(row => {
      const record = wins.get(row.name) ?? { wins: 0, ties: 0 };
      return { ...row, wins: record.wins, ties: record.ties };
    }));
  });

  // --- static frontend + fallbacks ---

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });

  if (config.distDir && fs.existsSync(path.join(config.distDir, 'index.html'))) {
    const indexHtmlPath = path.join(config.distDir, 'index.html');
    app.use(express.static(config.distDir));
    app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
      res.sendFile(indexHtmlPath);
    });
  }

  // Keep error responses JSON so the client can always read `error`.
  // Express identifies error middleware by its four-argument signature, so `next` must stay.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    const status = (err as { status?: number })?.status;
    if (status === 400 && err instanceof SyntaxError) {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    if (status === 413) {
      return res.status(413).json({ error: 'Request body too large' });
    }
    console.error(err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

class ImportConflict extends Error {}
