import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDbPath = path.join(__dirname, '..', 'data', 'ligretto.db');
const dbPath = process.env.DB_PATH ?? defaultDbPath;
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

function toTitleCase(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS games (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    started_at TEXT NOT NULL DEFAULT (datetime('now')),
    finished_at TEXT
  );

  CREATE TABLE IF NOT EXISTS game_players (
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    PRIMARY KEY (game_id, player_id)
  );

  CREATE TABLE IF NOT EXISTS rounds (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
    round_number INTEGER NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (game_id, round_number)
  );

  CREATE TABLE IF NOT EXISTS round_scores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    round_id INTEGER NOT NULL REFERENCES rounds(id) ON DELETE CASCADE,
    player_id INTEGER NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    cards_played INTEGER,
    cards_in_hand INTEGER,
    score INTEGER NOT NULL,
    UNIQUE (round_id, player_id)
  );

  CREATE TRIGGER IF NOT EXISTS prevent_player_delete_with_history
  BEFORE DELETE ON players
  WHEN EXISTS (SELECT 1 FROM game_players WHERE player_id = OLD.id)
    OR EXISTS (SELECT 1 FROM round_scores WHERE player_id = OLD.id)
  BEGIN
    SELECT RAISE(ABORT, 'Cannot delete a player with game history');
  END;
`);

const hasDeletedAt = db.prepare(`
  SELECT 1
  FROM pragma_table_info('games')
  WHERE name = 'deleted_at'
`).get();

if (!hasDeletedAt) {
  db.exec("ALTER TABLE games ADD COLUMN deleted_at TEXT");
}

const mergeDuplicatePlayers = db.transaction(() => {
  const duplicateGroups = db.prepare(`
    SELECT LOWER(name) AS normalized_name
    FROM players
    GROUP BY LOWER(name)
    HAVING COUNT(*) > 1
  `).all() as { normalized_name: string }[];

  const getPlayersByNormalizedName = db.prepare(`
    SELECT
      p.id,
      p.name,
      p.created_at,
      (SELECT COUNT(*) FROM round_scores rs WHERE rs.player_id = p.id) AS round_count,
      (SELECT COUNT(*) FROM game_players gp WHERE gp.player_id = p.id) AS game_count
    FROM players p
    WHERE LOWER(p.name) = ?
    ORDER BY round_count DESC, game_count DESC, p.id ASC
  `);

  const removeDuplicateGamePlayers = db.prepare(`
    DELETE FROM game_players
    WHERE player_id = ?
      AND game_id IN (
        SELECT game_id
        FROM game_players
        WHERE player_id = ?
      )
  `);

  const moveGamePlayers = db.prepare('UPDATE game_players SET player_id = ? WHERE player_id = ?');

  const removeDuplicateRoundScores = db.prepare(`
    DELETE FROM round_scores
    WHERE player_id = ?
      AND round_id IN (
        SELECT round_id
        FROM round_scores
        WHERE player_id = ?
      )
  `);

  const moveRoundScores = db.prepare('UPDATE round_scores SET player_id = ? WHERE player_id = ?');
  const renamePlayer = db.prepare('UPDATE players SET name = ? WHERE id = ?');
  const deletePlayer = db.prepare('DELETE FROM players WHERE id = ?');

  for (const group of duplicateGroups) {
    const players = getPlayersByNormalizedName.all(group.normalized_name) as {
      id: number;
      name: string;
      created_at: string;
      round_count: number;
      game_count: number;
    }[];

    if (players.length < 2) continue;

    const preferredName = toTitleCase(players[0].name);
    const canonical =
      players.find(player => player.name === preferredName)
      ?? players[0];

    for (const duplicate of players) {
      if (duplicate.id === canonical.id) continue;

      removeDuplicateGamePlayers.run(duplicate.id, canonical.id);
      moveGamePlayers.run(canonical.id, duplicate.id);

      removeDuplicateRoundScores.run(duplicate.id, canonical.id);
      moveRoundScores.run(canonical.id, duplicate.id);

      deletePlayer.run(duplicate.id);
    }

    renamePlayer.run(preferredName, canonical.id);
  }

  const playersToNormalize = db.prepare('SELECT id, name FROM players').all() as { id: number; name: string }[];
  for (const player of playersToNormalize) {
    const normalizedName = toTitleCase(player.name);
    if (normalizedName !== player.name) {
      renamePlayer.run(normalizedName, player.id);
    }
  }
});

mergeDuplicatePlayers();
db.exec('CREATE UNIQUE INDEX IF NOT EXISTS players_name_nocase ON players(name COLLATE NOCASE)');

export default db;
