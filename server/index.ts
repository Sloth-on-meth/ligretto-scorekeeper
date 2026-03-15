import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.join(__dirname, '..', 'dist');
const indexHtmlPath = path.join(distDir, 'index.html');

const app = express();
app.use(cors());
app.use(express.json());

function normalizePlayerIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;

  const ids = value.map(id => Number(id));
  if (ids.some(id => !Number.isInteger(id) || id <= 0)) return null;

  return [...new Set(ids)];
}

// --- Players ---

app.get('/api/players', (_req, res) => {
  const players = db.prepare('SELECT * FROM players ORDER BY name').all();
  res.json(players);
});

app.post('/api/players', (req, res) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'Name is required' });
  try {
    const result = db.prepare('INSERT INTO players (name) VALUES (?)').run(name.trim());
    const player = db.prepare('SELECT * FROM players WHERE id = ?').get(result.lastInsertRowid);
    res.status(201).json(player);
  } catch {
    res.status(409).json({ error: 'Player name already exists' });
  }
});

app.delete('/api/players/:id', (req, res) => {
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
  const games = db.prepare(`
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
    ORDER BY g.started_at DESC
  `).all();
  res.json(games);
});

app.post('/api/games', (req, res) => {
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

app.patch('/api/games/:id/finish', (req, res) => {
  db.prepare("UPDATE games SET finished_at = datetime('now') WHERE id = ?").run(req.params.id);
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  res.json(game);
});

app.delete('/api/games/:id', (req, res) => {
  db.prepare('DELETE FROM games WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// --- Game detail (players + rounds + scores) ---

app.get('/api/games/:id', (req, res) => {
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(req.params.id);
  if (!game) return res.status(404).json({ error: 'Game not found' });

  const players = db.prepare(`
    SELECT p.* FROM players p
    JOIN game_players gp ON gp.player_id = p.id
    WHERE gp.game_id = ?
    ORDER BY p.name
  `).all(req.params.id);

  const rounds = db.prepare(`
    SELECT r.*, rs.player_id, rs.cards_played, rs.cards_in_hand, rs.score
    FROM rounds r
    JOIN round_scores rs ON rs.round_id = r.id
    WHERE r.game_id = ?
    ORDER BY r.round_number, rs.player_id
  `).all(req.params.id);

  res.json({ game, players, rounds });
});

// --- Rounds ---

app.post('/api/games/:id/rounds', (req, res) => {
  const { scores } = req.body;
  // scores: [{ player_id, score, cards_played?, cards_in_hand? }]
  if (!Array.isArray(scores) || scores.length === 0) {
    return res.status(400).json({ error: 'Scores required' });
  }

  const gameId = req.params.id;
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

app.delete('/api/games/:gameId/rounds/:roundId', (req, res) => {
  db.prepare('DELETE FROM rounds WHERE id = ? AND game_id = ?').run(
    req.params.roundId,
    req.params.gameId
  );
  res.status(204).end();
});

// --- Stats ---

app.get('/api/stats', (_req, res) => {
  const stats = db.prepare(`
    WITH game_counts AS (
      SELECT player_id, COUNT(*) AS games_played
      FROM game_players
      GROUP BY player_id
    ),
    round_stats AS (
      SELECT
        player_id,
        COUNT(*) AS rounds_played,
        COALESCE(SUM(score), 0) AS total_score,
        COALESCE(ROUND(AVG(score), 1), 0) AS avg_score_per_round,
        MAX(score) AS best_round,
        MIN(score) AS worst_round
      FROM round_scores
      GROUP BY player_id
    )
    SELECT
      p.id,
      p.name,
      COALESCE(gc.games_played, 0) AS games_played,
      COALESCE(rs.rounds_played, 0) AS rounds_played,
      COALESCE(rs.total_score, 0) AS total_score,
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
