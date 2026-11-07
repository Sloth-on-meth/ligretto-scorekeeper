import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeScore,
  createRateLimiter,
  findWinners,
  normalizePlayerIds,
  normalizePlayerName,
  parseRoundScores,
} from './logic.js';

describe('normalizePlayerName', () => {
  it('trims, collapses whitespace and title-cases', () => {
    assert.equal(normalizePlayerName('  sAM   van  dER '), 'Sam Van Der');
  });

  it('returns an empty string for non-strings and blanks', () => {
    assert.equal(normalizePlayerName(42), '');
    assert.equal(normalizePlayerName(undefined), '');
    assert.equal(normalizePlayerName('   '), '');
  });
});

describe('normalizePlayerIds', () => {
  it('de-duplicates valid ids', () => {
    assert.deepEqual(normalizePlayerIds([1, 2, 2, '3']), [1, 2, 3]);
  });

  it('rejects non-arrays, zero, negatives and fractions', () => {
    assert.equal(normalizePlayerIds('1,2'), null);
    assert.equal(normalizePlayerIds([0]), null);
    assert.equal(normalizePlayerIds([-1]), null);
    assert.equal(normalizePlayerIds([1.5]), null);
  });
});

describe('computeScore', () => {
  it('applies played minus twice the stack', () => {
    assert.equal(computeScore(10, 0), 10);
    assert.equal(computeScore(3, 4), -5);
    assert.equal(computeScore(0, 0), 0);
  });
});

describe('parseRoundScores', () => {
  const players = [1, 2, 3];

  it('accepts formula inputs and derives the score', () => {
    const result = parseRoundScores(
      [
        { player_id: 1, cards_played: 12, cards_in_hand: 1 },
        { player_id: 2, cards_played: 5, cards_in_hand: 0 },
        { player_id: 3, cards_played: 0, cards_in_hand: 3 },
      ],
      players,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.value.map(s => s.score), [10, 5, -6]);
    assert.equal(result.value[0].cards_played, 12);
  });

  it('accepts direct scores with null card counts', () => {
    const result = parseRoundScores(
      [
        { player_id: 1, score: -4 },
        { player_id: 2, score: 7 },
        { player_id: 3, score: 0 },
      ],
      players,
    );
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.value[0].cards_played, null);
    assert.equal(result.value[0].score, -4);
  });

  it('accepts a direct score that agrees with the formula', () => {
    const result = parseRoundScores(
      [
        { player_id: 1, cards_played: 6, cards_in_hand: 1, score: 4 },
        { player_id: 2, score: 0 },
        { player_id: 3, score: 0 },
      ],
      players,
    );
    assert.equal(result.ok, true);
  });

  it('rejects a direct score that contradicts the formula', () => {
    const result = parseRoundScores(
      [
        { player_id: 1, cards_played: 6, cards_in_hand: 1, score: 9 },
        { player_id: 2, score: 0 },
        { player_id: 3, score: 0 },
      ],
      players,
    );
    assert.equal(result.ok, false);
  });

  it('rejects players who are not in the game', () => {
    const result = parseRoundScores(
      [
        { player_id: 1, score: 0 },
        { player_id: 2, score: 0 },
        { player_id: 99, score: 0 },
      ],
      players,
    );
    assert.equal(result.ok, false);
  });

  it('rejects duplicate players', () => {
    const result = parseRoundScores(
      [
        { player_id: 1, score: 0 },
        { player_id: 1, score: 0 },
        { player_id: 2, score: 0 },
      ],
      players,
    );
    assert.equal(result.ok, false);
  });

  it('rejects a round that leaves a game player out', () => {
    const result = parseRoundScores(
      [
        { player_id: 1, score: 0 },
        { player_id: 2, score: 0 },
      ],
      players,
    );
    assert.equal(result.ok, false);
  });

  it('rejects fractional, negative-stack and oversized card counts', () => {
    const base = [{ player_id: 2, score: 0 }, { player_id: 3, score: 0 }];
    assert.equal(parseRoundScores([{ player_id: 1, cards_played: 2.5, cards_in_hand: 0 }, ...base], players).ok, false);
    assert.equal(parseRoundScores([{ player_id: 1, cards_played: 5, cards_in_hand: -1 }, ...base], players).ok, false);
    assert.equal(parseRoundScores([{ player_id: 1, cards_played: 41, cards_in_hand: 0 }, ...base], players).ok, false);
    assert.equal(parseRoundScores([{ player_id: 1, cards_played: 5, cards_in_hand: 11 }, ...base], players).ok, false);
  });

  it('rejects a half-filled formula entry', () => {
    const result = parseRoundScores(
      [
        { player_id: 1, cards_played: 5 },
        { player_id: 2, score: 0 },
        { player_id: 3, score: 0 },
      ],
      players,
    );
    assert.equal(result.ok, false);
  });

  it('rejects an empty or missing scores array', () => {
    assert.equal(parseRoundScores([], players).ok, false);
    assert.equal(parseRoundScores(undefined, players).ok, false);
  });
});

describe('findWinners', () => {
  it('returns the single top scorer', () => {
    assert.deepEqual(findWinners([{ name: 'A', total: 5 }, { name: 'B', total: 9 }]), ['B']);
  });

  it('returns every player tied for first, sorted by name', () => {
    assert.deepEqual(
      findWinners([{ name: 'Sofie', total: 9 }, { name: 'Amber', total: 9 }, { name: 'Sam', total: 2 }]),
      ['Amber', 'Sofie'],
    );
  });

  it('returns nothing without totals', () => {
    assert.deepEqual(findWinners([]), []);
  });
});

describe('createRateLimiter', () => {
  it('blocks after the limit within the window and recovers afterwards', () => {
    let now = 0;
    const limiter = createRateLimiter(2, 1000, () => now);

    assert.equal(limiter.hit('ip'), true);
    assert.equal(limiter.hit('ip'), true);
    assert.equal(limiter.hit('ip'), false);

    now = 1001;
    assert.equal(limiter.hit('ip'), true);
  });

  it('tracks keys independently', () => {
    const limiter = createRateLimiter(1, 1000, () => 0);
    assert.equal(limiter.hit('a'), true);
    assert.equal(limiter.hit('b'), true);
    assert.equal(limiter.hit('a'), false);
  });
});
