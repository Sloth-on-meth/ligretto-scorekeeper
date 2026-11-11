import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sanitizeScore, toggleSign, parseScore } from './score.ts';

describe('sanitizeScore', () => {
  it('keeps digits only', () => {
    assert.equal(sanitizeScore('1a2b3'), '123');
  });

  it('keeps a leading minus and drops any other', () => {
    assert.equal(sanitizeScore('-12'), '-12');
    assert.equal(sanitizeScore('1-2'), '12');
    assert.equal(sanitizeScore('--5'), '-5');
  });

  it('caps the number of digits', () => {
    assert.equal(sanitizeScore('123456'), '1234');
    assert.equal(sanitizeScore('-123456'), '-1234');
  });

  it('handles empty input', () => {
    assert.equal(sanitizeScore(''), '');
    assert.equal(sanitizeScore('-'), '-');
  });
});

describe('toggleSign', () => {
  it('flips between positive and negative', () => {
    assert.equal(toggleSign('7'), '-7');
    assert.equal(toggleSign('-7'), '7');
  });

  it('starts a negative entry from an empty field', () => {
    assert.equal(toggleSign(''), '-');
  });
});

describe('parseScore', () => {
  it('parses whole numbers including negatives', () => {
    assert.equal(parseScore('-3'), -3);
    assert.equal(parseScore('0'), 0);
    assert.equal(parseScore('12'), 12);
  });

  it('rejects empty, lone-minus and fractional input', () => {
    assert.equal(parseScore(''), null);
    assert.equal(parseScore('-'), null);
    assert.equal(parseScore('1.5'), null);
    assert.equal(parseScore('abc'), null);
  });
});
