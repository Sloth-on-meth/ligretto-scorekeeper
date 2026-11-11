import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseServerDate, formatDate } from './dates.ts';

describe('parseServerDate', () => {
  it('treats SQLite timestamps as UTC', () => {
    assert.equal(parseServerDate('2026-11-11 20:30:42').toISOString(), '2026-11-11T20:30:42.000Z');
  });

  it('passes other formats through to Date', () => {
    assert.equal(parseServerDate('2026-11-11T20:30:42.000Z').toISOString(), '2026-11-11T20:30:42.000Z');
  });

  it('formats unparseable values as-is instead of "Invalid Date"', () => {
    assert.equal(formatDate('not a date'), 'not a date');
  });
});
