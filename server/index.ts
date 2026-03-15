import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');
const SESSION_COOKIE = 'ligretto_session';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const AUTH_PASSWORD = process.env.AUTH_PASSWORD ?? 'ligretto-admin';
const SESSION_SECRET = process.env.SESSION_SECRET ?? 'ligretto-dev-session-secret';

const app = express();
app.use(cors());
app.use(express.json());

type Role = 'admin';

interface SessionPayload {
  role: Role;
  exp: number;
}

function normalizePlayerIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;

  const ids = value.map(id => Number(id));
  if (ids.some(id => !Number.isInteger(id) || id <= 0)) return null;

  return [...new Set(ids)];
}

function normalizePlayerName(value: unknown): string {
  if (typeof value !== 'string') return '';

  return value
    .trim()
    .split(/\s+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

interface ImportedRoundScore {
  player_name: string;
  score: number;
}

interface ImportedRound {
  scores: ImportedRoundScore[];
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
    cookies[rawName] = decodeURIComponent(rawValue.join('='));
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
    if (payload.role !== 'admin') return null;
    return payload;
  } catch {
    return null;
  }
}

function getSession(req: express.Request) {
  const cookies = parseCookies(req.headers.cookie);
  return decodeSession(cookies[SESSION_COOKIE]);
}

function setSessionCookie(res: express.Response, payload: SessionPayload) {
  const token = encodeSession(payload);
  const cookie = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
  ].join('; ');
  res.setHeader('Set-Cookie', cookie);
}

function clearSessionCookie(res: express.Response) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`);
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const session = getSession(req);
  if (!session || session.role !== 'admin') {
    return res.status(401).json({ error: 'Sign in required' });
  }
  next();
}

function passwordsMatch(input: string, expected: string) {
  const inputBuffer = Buffer.from(input, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');
  if (inputBuffer.length !== expectedBuffer.length) return false;
  return crypto.timingSafeEqual(inputBuffer, expectedBuffer);
}

function getGames(includeDeleted: boolean) {
  return db.prepare(`
    SELECT g.*,
      (SELECT COUNT(*) FROM rounds WHERE game_id = g.id) AS round_count,
      (SELECT GROUP_CONCAT(p.name, ', ')
       FROM game_players gp JOIN players p ON p.id = gp.player_id
       WHERE gp.game_id = g.id) AS player_names,
      CASE WHEN g.finished_at IS NOT NULL THEN (
        SELECT p.name FROM players p
        JOIN game_players gp ON gp.player_id = p.id
        JOIN round_scores rs ON rs.player_id = p.id
        JOIN rounds r ON r.id = rs.round_id
        WHERE gp.game_id = g.id AND r.game_id = g.id
        GROUP BY p.id
        ORDER BY SUM(rs.score) DESC
        LIMIT 1
      ) END AS winner_name
    FROM games g
    WHERE g.deleted_at IS ${includeDeleted ? 'NOT' : ''} NULL
    ORDER BY COALESCE(g.deleted_at, g.started_at) DESC, g.id DESC
  `).all();
}

function getGameById(gameId: string | number) {
  return db.prepare('SELECT * FROM games WHERE id = ?').get(gameId) as
    | { id: number; finished_at: string | null; deleted_at: string | null }
    | undefined;
}

// --- Auth ---

app.get('/api/auth/session', (req, res) => {
  const session = getSession(req);
  res.json({
    authenticated: Boolean(session),
    role: session?.role ?? null,
  });
});

app.post('/api/auth/login', (req, res) => {
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!password) {
    return res.status(400).json({ error: 'Password is required' });
  }

  if (!passwordsMatch(password, AUTH_PASSWORD)) {
    return res.status(401).json({ error: 'Invalid password' });
  }

  const payload: SessionPayload = {
    role: 'admin',
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

app.delete('/api/players/:id', requireAdmin, (req, res) => {
  const playerId = Number(req.params.id);
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

app.post('/api/games', requireAdmin, (req, res) => {
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
      if (!playerNames.includes(playerName) || !Number.isInteger(score?.score)) {
        return res.status(400).json({ error: 'Imported scores must use known players and integer values' });
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

  db.prepare("UPDATE games SET finished_at = datetime('now') WHERE id = ?").run(gameId);
  const updatedGame = getGameById(gameId);
  res.json(updatedGame);
});

app.patch('/api/games/:id/trash', requireAdmin, (req, res) => {
  const gameId = getRouteParam(req.params.id);
  const game = getGameById(gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.deleted_at) return res.status(409).json({ error: 'Game is already in the trash' });

  db.prepare("UPDATE games SET deleted_at = datetime('now') WHERE id = ?").run(gameId);
  const updatedGame = getGameById(gameId);
  res.json(updatedGame);
});

app.patch('/api/games/:id/restore', requireAdmin, (req, res) => {
  const gameId = getRouteParam(req.params.id);
  const game = getGameById(gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (!game.deleted_at) return res.status(409).json({ error: 'Game is not in the trash' });

  db.prepare('UPDATE games SET deleted_at = NULL WHERE id = ?').run(gameId);
  const updatedGame = getGameById(gameId);
  res.json(updatedGame);
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

app.post('/api/games/:id/rounds', requireAdmin, (req, res) => {
  const gameId = getRouteParam(req.params.id);
  const game = getGameById(gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.deleted_at) return res.status(409).json({ error: 'Cannot edit a deleted game' });

  const { scores } = req.body;
  // scores: [{ player_id, score, cards_played?, cards_in_hand? }]
  if (!Array.isArray(scores) || scores.length === 0) {
    return res.status(400).json({ error: 'Scores required' });
  }

  const lastRound = db.prepare(
    'SELECT MAX(round_number) as max FROM rounds WHERE game_id = ?'
  ).get(gameId) as { max: number | null };
  const nextRound = (lastRound.max ?? 0) + 1;

  const insertRound = db.transaction(() => {
    const roundResult = db.prepare(
      'INSERT INTO rounds (game_id, round_number) VALUES (?, ?)'
    ).run(gameId, nextRound);
    const roundId = roundResult.lastInsertRowid;

    const insertScore = db.prepare(
      'INSERT INTO round_scores (round_id, player_id, cards_played, cards_in_hand, score) VALUES (?, ?, ?, ?, ?)'
    );
    for (const s of scores) {
      const score = s.score ?? (s.cards_played - s.cards_in_hand * 2);
      insertScore.run(roundId, s.player_id, s.cards_played ?? null, s.cards_in_hand ?? null, score);
    }
    return roundId;
  });

  const roundId = insertRound();
  const round = db.prepare(`
    SELECT r.*, rs.player_id, rs.cards_played, rs.cards_in_hand, rs.score
    FROM rounds r
    JOIN round_scores rs ON rs.round_id = r.id
    WHERE r.id = ?
  `).all(roundId);

  res.status(201).json(round);
});

app.delete('/api/games/:gameId/rounds/:roundId', requireAdmin, (req, res) => {
  const gameId = getRouteParam(req.params.gameId);
  const roundId = getRouteParam(req.params.roundId);
  const game = getGameById(gameId);
  if (!game) return res.status(404).json({ error: 'Game not found' });
  if (game.deleted_at) return res.status(409).json({ error: 'Cannot edit a deleted game' });

  db.prepare('DELETE FROM rounds WHERE id = ? AND game_id = ?').run(
    roundId,
    gameId
  );
  res.status(204).end();
});

// --- Stats ---

app.get('/api/stats', (_req, res) => {
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
    ORDER BY total_score DESC
  `).all();
  res.json(stats);
});

if (fs.existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/^(?!\/api(?:\/|$)).*/, (_req, res) => {
    res.sendFile(indexHtmlPath);
  });
}

const PORT = Number(process.env.PORT ?? 3001);
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
