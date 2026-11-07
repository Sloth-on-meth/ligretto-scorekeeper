import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';
import {
  MAX_ABS_SCORE,
  createRateLimiter,
  findWinners,
  normalizePlayerIds,
  normalizePlayerName,
  parseRoundScores,
} from './logic.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const SESSION_COOKIE = 'ligretto_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
// Secrets come from the environment (.env in development, compose env_file in Docker).
// AUTH_PASSWORD  - admin: full access.
// PLAYER_PASSWORD - players: start games and enter round scores only.
const AUTH_PASSWORD = process.env.AUTH_PASSWORD ?? '';
const PLAYER_PASSWORD = process.env.PLAYER_PASSWORD ?? '';
const SESSION_SECRET = process.env.SESSION_SECRET ?? '';

if (!AUTH_PASSWORD || !SESSION_SECRET) {
  console.error('Missing AUTH_PASSWORD or SESSION_SECRET. Add them to your .env file (see .env.example).');
  process.exit(1);
}
if (!PLAYER_PASSWORD) {
  console.warn('PLAYER_PASSWORD is not set, so player sign-in is disabled.');
}
// Set COOKIE_SECURE=true when the app is served over HTTPS.
const COOKIE_SECURE = process.env.COOKIE_SECURE === 'true';
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;


const app = express();
app.use(cors());
app.use(express.json({ limit: '100kb' }));

const loginLimiter = createRateLimiter(LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MS);

type Role = 'admin' | 'player';

interface SessionPayload {
  role: Role;
  exp: number;
}

interface ImportedRoundScore {
  player_name: string;
  score: number;
}

interface ImportedRound {
  scores: ImportedRoundScore[];
}

interface GameRow {
  id: number;
  started_at: string;
  finished_at: string | null;
  deleted_at: string | null;
}

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
  const signature = signSession(data);
  return `${data}.${signature}`;
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

  const expectedSignature = signSession(data);
  const provided = Buffer.from(signature, 'utf8');
  const expected = Buffer.from(expectedSignature, 'utf8');
  if (provided.length !== expected.length || !crypto.timingSafeEqual(provided, expected)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(data)) as SessionPayload;
    if (payload.exp <= Date.now()) return null;
    if (payload.role !== 'admin' && payload.role !== 'player') return null;
    return payload;
  } catch {
    return null;
  }
}

function getSession(req: express.Request) {
  const cookies = parseCookies(req.headers.cookie);
  return decodeSession(cookies[SESSION_COOKIE]);
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
  const token = encodeSession(payload);
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${cookieAttributes(Math.floor(SESSION_TTL_MS / 1000))}`,
  );
}

function clearSessionCookie(res: express.Response) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; ${cookieAttributes(0)}`);
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = getSession(req);
  if (!session || session.role !== 'admin') {
    return res.status(session ? 403 : 401).json({ error: session ? 'Admin access required' : 'Sign in required' });
  }
  next();
}

// Players and admins can start games and enter scores.
function requirePlayer(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = getSession(req);
  if (!session) {
    return res.status(401).json({ error: 'Sign in required' });
  }
  next();
}

function passwordsMatch(input: string, expected: string) {
  // Hash both sides so the comparison is constant-time regardless of length.
  const inputDigest = crypto.createHash('sha256').update(input, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(inputDigest, expectedDigest);
}

function getGameById(gameId: string | number) {
  return db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as GameRow | undefined;
}

function getWinnersByGame(includeTrashed: boolean): Map<number, string[]> {
  const rows = db.prepare(`
    SELECT gp.game_id AS game_id, p.name AS name, COALESCE(SUM(rs.score), 0) AS total
    FROM game_players gp
    JOIN games g ON g.id = gp.game_id AND g.finished_at IS NOT NULL
      ${includeTrashed ? '' : 'AND g.deleted_at IS NULL'}
    JOIN players p ON p.id = gp.player_id
    JOIN rounds r ON r.game_id = gp.game_id
    LEFT JOIN round_scores rs ON rs.round_id = r.id AND rs.player_id = gp.player_id
    GROUP BY gp.game_id, gp.player_id
  `).all() as { game_id: number; name: string; total: number }[];

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

function getGames(includeDeleted: boolean) {
  const games = db.prepare(`
    SELECT g.*,
      (SELECT COUNT(*) FROM rounds WHERE game_id = g.id) AS round_count,
      (SELECT GROUP_CONCAT(p.name, ', ')
       FROM game_players gp JOIN players p ON p.id = gp.player_id
       WHERE gp.game_id = g.id) AS player_names
    FROM games g
    WHERE g.deleted_at IS ${includeDeleted ? 'NOT' : ''} NULL
    ORDER BY COALESCE(g.deleted_at, g.started_at) DESC, g.id DESC
  `).all() as (GameRow & { round_count: number; player_names: string | null })[];

  const winners = getWinnersByGame(includeDeleted);
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

// --- Health (used by Docker healthchecks; no auth, no data) ---

app.get('/api/health', (_req, res) => {
  try {
    db.prepare('SELECT 1').get();
    res.json({ status: 'ok' });
  } catch {
    res.status(503).json({ status: 'error' });
  }
});

// --- Auth ---

app.get('/api/auth/session', (req, res) => {
  const session = getSession(req);
  res.json({
    authenticated: Boolean(session),
    role: session?.role ?? null,
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

  let role: Role | null = null;
  if (passwordsMatch(password, AUTH_PASSWORD)) role = 'admin';
  else if (PLAYER_PASSWORD && passwordsMatch(password, PLAYER_PASSWORD)) role = 'player';

  if (!role) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  loginLimiter.reset(ip);
  const payload: SessionPayload = {
    role,
    exp: Date.now() + SESSION_TTL_MS,
  };
  setSessionCookie(res, payload);
  res.json({ authenticated: true, role: payload.role });
});

app.post('/api/auth/logout', (_req, res) => {
  clearSessionCookie(res);
  res.json({ authenticated: false, role: null });
});

// --- Players ---

app.get('/api/players', (_req, res) => {
  const players = db.prepare('SELECT * FROM players ORDER BY name').all();
  res.json(players);
});

app.post('/api/players', requireAdmin, (req, res) => {
  const normalizedName = normalizePlayerName(req.body?.name);
  if (!normalizedName) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = db.prepare('INSERT INTO players (name) VALUES (?)').run(normalizedName);
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(player);
  } catch {
    res.status(409).json({ error: 'Player name already exists' });
  }
});

app.patch('/api/players/:id', requireAdmin, (req, res) => {
  const playerId = Number(getRouteParam(req.params.id));
  if (!Number.isInteger(playerId) || playerId <= 0) {
    return res.status(400).json({ error: 'Invalid player id' });
  }

  const normalizedName = normalizePlayerName(req.body?.name);
  if (!normalizedName) return res.status(400).json({ error: 'Name is required' });

  const player = db.prepare('SELECT id FROM players WHERE id = ?').get(playerId);
  if (!player) return res.status(404).json({ error: 'Player not found' });

  try {
    db.prepare('UPDATE players SET name = ? WHERE id = ?').run(normalizedName, playerId);
  } catch {
    return res.status(409).json({ error: 'Player name already exists' });
  }
  res.json(db.prepare('SELECT * FROM players WHERE id = ?').get(playerId));
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

// --- Games ---

app.get('/api/games', (_req, res) => {
  res.json(getGames(false));
});

app.get('/api/games/trash', (_req, res) => {
  res.json(getGames(true));
});

app.post('/api/games', requirePlayer, (req, res) => {
  const playerIds = normalizePlayerIds(req.body?.player_ids);
  if (!playerIds || playerIds.length < 2) {
    return res.status(400).json({ error: 'At least 2 players required' });
  }

  const existingPlayers = db.prepare(`
    SELECT id
    FROM players
    WHERE id IN (${playerIds.map(() => '?').join(', ')})
  `).all(...playerIds) as { id: number }[];

  if (existingPlayers.length !== playerIds.length) {
    return res.status(400).json({ error: 'All players must exist before starting a game' });
  }

  try {
    const createGame = db.transaction(() => {
      const result = db.prepare('INSERT INTO games DEFAULT VALUES').run();
      const gameId = result.lastInsertRowid;
      const insertPlayer = db.prepare('INSERT INTO game_players (game_id, player_id) VALUES (?, ?)');

      for (const playerId of playerIds) {
        insertPlayer.run(gameId, playerId);
      }

      return db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    });

    const game = createGame();
    res.status(201).json(game);
  } catch {
    res.status(500).json({ error: 'Failed to create game' });
  }
});

app.post('/api/games/import', requireAdmin, (req, res) => {
  const rawPlayers = Array.isArray(req.body?.player_names) ? req.body.player_names : null;
  const rawRounds = Array.isArray(req.body?.rounds) ? req.body.rounds : null;

  if (!rawPlayers || !rawRounds) {
    return res.status(400).json({ error: 'Player names and rounds are required' });
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

  const rounds = rawRounds as ImportedRound[];
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
      const selectPlayer = db.prepare('SELECT * FROM players WHERE name = ?');
      const insertPlayer = db.prepare('INSERT INTO players (name) VALUES (?)');
      const insertGame = db.prepare('INSERT INTO games DEFAULT VALUES');
      const insertGamePlayer = db.prepare('INSERT INTO game_players (game_id, player_id) VALUES (?, ?)');
      const insertRound = db.prepare('INSERT INTO rounds (game_id, round_number) VALUES (?, ?)');
      const insertRoundScore = db.prepare(
        'INSERT INTO round_scores (round_id, player_id, cards_played, cards_in_hand, score) VALUES (?, ?, ?, ?, ?)'
      );

      const playersByName = new Map<string, { id: number }>();
      for (const playerName of playerNames) {
        let player = selectPlayer.get(playerName) as { id: number } | undefined;
        if (!player) {
          const result = insertPlayer.run(playerName);
          player = { id: Number(result.lastInsertRowid) };
        }
        playersByName.set(playerName, player);
      }

      const gameResult = insertGame.run();
      const gameId = Number(gameResult.lastInsertRowid);

      for (const playerName of playerNames) {
        const player = playersByName.get(playerName)!;
        insertGamePlayer.run(gameId, player.id);
      }

      for (const [index, round] of rounds.entries()) {
        const roundResult = insertRound.run(gameId, index + 1);
        const roundId = Number(roundResult.lastInsertRowid);

        for (const score of round.scores) {
          const player = playersByName.get(normalizePlayerName(score.player_name))!;
          insertRoundScore.run(roundId, player.id, null, null, score.score);
        }
      }

      db.prepare("UPDATE games SET finished_at = datetime('now') WHERE id = ?").run(gameId);
      return db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
    });

    const game = importGame();
    res.status(201).json(game);
  } catch {
    res.status(500).json({ error: 'Failed to import game' });
  }
});

app.patch('/api/games/:id/finish', requireAdmin, (req, res) => {
  const gameId = getRouteParam(req.params.id);
  const game = getGameById(gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.deleted_at) return res.status(409).json({ error: 'Cannot finish a deleted game' });

  // Idempotent: finishing an already-finished game keeps its original finish time.
  db.prepare("UPDATE games SET finished_at = datetime('now') WHERE id = ? AND finished_at IS NULL").run(gameId);
  res.json(getGameById(gameId));
});

app.patch('/api/games/:id/trash', requireAdmin, (req, res) => {
  const gameId = getRouteParam(req.params.id);
  const game = getGameById(gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.deleted_at) return res.status(409).json({ error: 'Game is already in the trash' });

  db.prepare("UPDATE games SET deleted_at = datetime('now') WHERE id = ?").run(gameId);
  res.json(getGameById(gameId));
});

app.patch('/api/games/:id/restore', requireAdmin, (req, res) => {
  const gameId = getRouteParam(req.params.id);
  const game = getGameById(gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (!game.deleted_at) return res.status(409).json({ error: 'Game is not in the trash' });

  db.prepare('UPDATE games SET deleted_at = NULL WHERE id = ?').run(gameId);
  res.json(getGameById(gameId));
});

app.delete('/api/games/:id', requireAdmin, (req, res) => {
  const gameId = getRouteParam(req.params.id);
  const game = getGameById(gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  db.prepare('DELETE FROM games WHERE id = ?').run(gameId);
  res.status(204).end();
});

// --- Game detail (players + rounds + scores) ---

app.get('/api/games/:id', (req, res) => {
  const gameId = getRouteParam(req.params.id);
  const game = getGameById(gameId);
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

// --- Rounds ---

app.post('/api/games/:id/rounds', requirePlayer, (req, res) => {
  const gameId = getRouteParam(req.params.id);
  const game = getGameById(gameId);
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

    const roundResult = db.prepare(
      'INSERT INTO rounds (game_id, round_number) VALUES (?, ?)'
    ).run(gameId, max + 1);
    const roundId = roundResult.lastInsertRowid;

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

function findEditableRound(gameId: string, roundId: string, res: express.Response) {
  const game = getGameById(gameId);
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

app.put('/api/games/:gameId/rounds/:roundId', requireAdmin, (req, res) => {
  const gameId = getRouteParam(req.params.gameId);
  const roundId = getRouteParam(req.params.roundId);
  if (!findEditableRound(gameId, roundId, res)) return;

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
  const game = getGameById(gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.deleted_at) return res.status(409).json({ error: 'Cannot edit a deleted game' });
  if (game.finished_at) return res.status(409).json({ error: 'Cannot change rounds in a finished game' });

  const result = db.prepare('DELETE FROM rounds WHERE id = ? AND game_id = ?').run(roundId, gameId);
  if (result.changes === 0) return res.status(404).json({ error: 'Round not found' });
  res.status(204).end();
});

// --- Stats ---

app.get('/api/stats', (_req, res) => {
  // Outright wins vs shared wins (ties), counted over finished, non-trashed games.
  const wins = new Map<string, { wins: number; ties: number }>();
  for (const names of getWinnersByGame(false).values()) {
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
    ORDER BY total_score DESC, p.name
  `).all();
  res.json(stats.map(row => {
    const record = wins.get((row as { name: string }).name) ?? { wins: 0, ties: 0 };
    return { ...(row as object), wins: record.wins, ties: record.ties };
  }));
});

// --- Static frontend + fallbacks ---

app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Not found' });
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
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

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
