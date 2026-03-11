export interface Player {
  id: number;
  name: string;
  created_at: string;
}

export interface Game {
  id: number;
  started_at: string;
  finished_at: string | null;
  round_count?: number;
  player_names?: string;
}

export interface RoundScore {
  player_id: number;
  cards_played: number;
  cards_in_hand: number;
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
  avg_score_per_round: number;
  best_round: number | null;
  worst_round: number | null;
}
