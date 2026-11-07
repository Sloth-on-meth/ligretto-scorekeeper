import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseImportedGame } from './importParser.ts';

describe('parseImportedGame', () => {
  it('parses tab-separated scores', () => {
    const result = parseImportedGame('sam\tamber\n14\t25\n11\t-3');
    assert.equal(result.delimiterLabel, 'tab');
    assert.deepEqual(result.playerNames, ['sam', 'amber']);
    assert.equal(result.rounds.length, 2);
    assert.deepEqual(result.rounds[1].scores, [
      { player_name: 'sam', score: 11 },
      { player_name: 'amber', score: -3 },
    ]);
  });

  it('accepts commas and semicolons when the header uses them', () => {
    assert.equal(parseImportedGame('a,b,c\n1,2,3').delimiterLabel, 'comma');
    assert.equal(parseImportedGame('a;b\n1;-2').delimiterLabel, 'semicolon');
  });

  it('strips quotes and surrounding whitespace', () => {
    const result = parseImportedGame('"Sam" , Amber\n 4 , +2 ');
    assert.deepEqual(result.playerNames, ['Sam', 'Amber']);
    assert.deepEqual(result.rounds[0].scores.map(s => s.score), [4, 2]);
  });

  it('reports a clear error for a row with the wrong number of values', () => {
    assert.throws(() => parseImportedGame('a\tb\n1\t2\n3'), /Row 2 has 1 values; expected 2/);
  });

  it('rejects non-integer scores and duplicate headers', () => {
    assert.throws(() => parseImportedGame('a\tb\n1.5\t2'), /not a whole number/);
    assert.throws(() => parseImportedGame('a\tA\n1\t2'), /must be unique/);
  });

  it('needs a header and at least one round', () => {
    assert.throws(() => parseImportedGame('a\tb'), /header row/);
    assert.throws(() => parseImportedGame(''), /header row/);
  });
});
