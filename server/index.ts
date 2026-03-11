import express from 'express';
import cors from 'cors';
import db from './db.js';

const app = express();
app.use(cors());
app.use(express.json());

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
  db.prepare('DELETE FROM players WHERE id = ?').run(req.params.id);
  res.status(204).end();
});

// --- Games ---

app.get('/api/games', (_req, res) => {
  const games = db.prepare(`
    SELECT g.*,
      (SELECT COUNT(*) FROM rounds WHERE game_id = g.id) AS round_count,
      (SELECT GROUP_CONCAT(p.name, ', ')
       FROM game_players gp JOIN players p ON p.id = gp.player_id
       WHERE gp.game_id = g.id) AS player_names
    FROM games g
    ORDER BY g.started_at DESC
  `).all();
  res.json(games);
});

app.post('/api/games', (req, res) => {
  const { player_ids } = req.body;
  if (!Array.isArray(player_ids) || player_ids.length < 2) {
    return res.status(400).json({ error: 'At least 2 players required' });
  }
  const result = db.prepare('INSERT INTO games DEFAULT VALUES').run();
  const gameId = result.lastInsertRowid;
  const insertPlayer = db.prepare('INSERT INTO game_players (game_id, player_id) VALUES (?, ?)');
  for (const pid of player_ids) insertPlayer.run(gameId, pid);
  const game = db.prepare('SELECT * FROM games WHERE id = ?').get(gameId);
  res.status(201).json(game);
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
  // scores: [{ player_id, cards_played, cards_in_hand }]
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
      'INSERT INTO round_scores (round_id, player_id, cards_played, cards_in_hand) VALUES (?, ?, ?, ?)'
    );
    for (const s of scores) {
      insertScore.run(roundId, s.player_id, s.cards_played, s.cards_in_hand);
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
    SELECT
      p.id,
      p.name,
      COUNT(DISTINCT gp.game_id) AS games_played,
      COUNT(rs.id) AS rounds_played,
      COALESCE(SUM(rs.score), 0) AS total_score,
      COALESCE(ROUND(AVG(rs.score), 1), 0) AS avg_score_per_round,
      MAX(rs.score) AS best_round,
      MIN(rs.score) AS worst_round
    FROM players p
    LEFT JOIN game_players gp ON gp.player_id = p.id
    LEFT JOIN round_scores rs ON rs.player_id = p.id
    GROUP BY p.id
    ORDER BY total_score DESC
  `).all();
  res.json(stats);
});

const PORT = 3001;
app.listen(PORT, () => console.log(`Server running on http://localhost:${PORT}`));
