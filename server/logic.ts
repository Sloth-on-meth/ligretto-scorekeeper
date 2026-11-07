// Pure, framework-free helpers shared by the API and the database layer.
// Kept free of side effects so they can be unit-tested directly.

export const DEFAULT_ADMIN_PASSWORD = 'ligretto-admin';
export const DEFAULT_SESSION_SECRET = 'ligretto-dev-session-secret';

/** Sanity bounds for a single player's numbers in one round. */
export const MAX_CARDS = 40; // one Ligretto deck per player
export const MAX_STACK = 10; // cards left in the Ligretto stack
export const MAX_ABS_SCORE = 1000;

export function toTitleCase(value: string): string {
  return value
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}

/** Normalises a player name for storage: trimmed, title-cased, single spaces. */
export function normalizePlayerName(value: unknown): string {
  if (typeof value !== 'string') return '';
  return toTitleCase(value);
}

/** Returns a de-duplicated list of positive integer ids, or null if any entry is invalid. */
export function normalizePlayerIds(value: unknown): number[] | null {
  if (!Array.isArray(value)) return null;

  const ids = value.map(id => Number(id));
  if (ids.some(id => !Number.isInteger(id) || id <= 0)) return null;

  return [...new Set(ids)];
}

/** Ligretto scoring: cards played to the middle, minus twice the cards left in the stack. */
export function computeScore(cardsPlayed: number, cardsInHand: number): number {
  return cardsPlayed - cardsInHand * 2;
}

function isBoundedInteger(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;
}

export interface RoundScoreInput {
  player_id: unknown;
  score?: unknown;
  cards_played?: unknown;
  cards_in_hand?: unknown;
}

export interface ValidRoundScore {
  player_id: number;
  score: number;
  cards_played: number | null;
  cards_in_hand: number | null;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * Validates one round submitted for a game. Every player in the game must appear
 * exactly once. Each entry may give formula inputs (cards_played + cards_in_hand),
 * a direct score, or both if they agree.
 */
export function parseRoundScores(
  value: unknown,
  gamePlayerIds: number[],
): ParseResult<ValidRoundScore[]> {
  if (!Array.isArray(value) || value.length === 0) {
    return { ok: false, error: 'Scores required' };
  }

  const expected = new Set(gamePlayerIds);
  const seen = new Set<number>();
  const result: ValidRoundScore[] = [];

  for (const entry of value as RoundScoreInput[]) {
    const playerId = typeof entry?.player_id === 'number' ? entry.player_id : Number(entry?.player_id);
    if (!expected.has(playerId)) {
      return { ok: false, error: 'Every score must belong to a player in this game' };
    }
    if (seen.has(playerId)) {
      return { ok: false, error: 'Each player may appear only once per round' };
    }
    seen.add(playerId);

    const hasPlayed = entry.cards_played !== undefined && entry.cards_played !== null;
    const hasHand = entry.cards_in_hand !== undefined && entry.cards_in_hand !== null;
    const hasScore = entry.score !== undefined && entry.score !== null;

    if (hasPlayed !== hasHand) {
      return { ok: false, error: 'Both cards played and cards in hand are required' };
    }

    if (!hasPlayed && !hasScore) {
      return { ok: false, error: 'Each player needs a score or card counts' };
    }

    let cardsPlayed: number | null = null;
    let cardsInHand: number | null = null;
    let score: number | null = null;

    if (hasPlayed && hasHand) {
      if (!isBoundedInteger(entry.cards_played, 0, MAX_CARDS)) {
        return { ok: false, error: `Cards played must be a whole number from 0 to ${MAX_CARDS}` };
      }
      if (!isBoundedInteger(entry.cards_in_hand, 0, MAX_STACK)) {
        return { ok: false, error: `Cards in hand must be a whole number from 0 to ${MAX_STACK}` };
      }
      cardsPlayed = entry.cards_played;
      cardsInHand = entry.cards_in_hand;
      score = computeScore(cardsPlayed, cardsInHand);
    }

    if (hasScore) {
      if (!isBoundedInteger(entry.score, -MAX_ABS_SCORE, MAX_ABS_SCORE)) {
        return { ok: false, error: 'Scores must be whole numbers' };
      }
      if (score !== null && entry.score !== score) {
        return { ok: false, error: 'Score does not match cards played and cards in hand' };
      }
      score = entry.score;
    }

    result.push({
      player_id: playerId,
      score: score as number,
      cards_played: cardsPlayed,
      cards_in_hand: cardsInHand,
    });
  }

  if (seen.size !== expected.size) {
    return { ok: false, error: 'Every player in the game needs a score for this round' };
  }

  return { ok: true, value: result };
}

/**
 * Given each player's total, returns the names of everyone tied for first.
 * Returns an empty array when there are no totals.
 */
export function findWinners(totals: { name: string; total: number }[]): string[] {
  if (totals.length === 0) return [];
  const best = Math.max(...totals.map(t => t.total));
  return totals
    .filter(t => t.total === best)
    .map(t => t.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Basic fixed-window rate limiter keyed by string (e.g. client IP). */
export function createRateLimiter(maxAttempts: number, windowMs: number, now: () => number = Date.now) {
  const buckets = new Map<string, { count: number; resetAt: number }>();

  return {
    /** Records an attempt. Returns false when the key is over the limit. */
    hit(key: string): boolean {
      const current = now();
      const bucket = buckets.get(key);
      if (!bucket || bucket.resetAt <= current) {
        buckets.set(key, { count: 1, resetAt: current + windowMs });
        return true;
      }
      bucket.count += 1;
      return bucket.count <= maxAttempts;
    },
    reset(key: string) {
      buckets.delete(key);
    },
  };
}
