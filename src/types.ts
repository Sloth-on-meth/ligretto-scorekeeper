export interface Group {
  id: number;
  name: string;
}

export interface Player {
  id: number;
  name: string;
  created_at: string;
  group_id: number | null;
  group_name?: string | null;
}

export type Role = 'admin' | 'player';

export interface AuthSession {
  authenticated: boolean;
  role: Role | null;
  /** The group a player session is limited to; null for admins and signed-out visitors. */
  group: Group | null;
}

export interface Game {
  id: number;
  started_at: string;
  finished_at: string | null;
  deleted_at: string | null;
  group_id: number | null;
  group_name?: string | null;
  round_count?: number;
  player_names?: string | null;
  /** Everyone tied for the top total in a finished game; empty otherwise. */
  winners: string[];
}

export interface RoundScore {
  id: number; // round id
  player_id: number;
  cards_played: number | null;
  cards_in_hand: number | null;
  score: number;
  round_number: number;
  game_id: number;
}

export interface GameDetail {
  game: Game;
  players: Player[];
  rounds: RoundScore[];
}

export interface PlayerStats {
  id: number;
  name: string;
  games_played: number;
  rounds_played: number;
  total_score: number;
  avg_score_per_game: number;
  avg_score_per_round: number;
  best_round: number | null;
  worst_round: number | null;
  /** Finished games won outright. */
  wins: number;
  /** Finished games shared with another player. */
  ties: number;
}
