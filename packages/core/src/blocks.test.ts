import { describe, expect, it } from 'vitest';
import { blockCovering, blockEndAfter } from './blocks.ts';
import type { AwayBlock } from './types.ts';

const LA = 'America/Los_Angeles';
const sunEve: AwayBlock = { daysOfWeek: [0], startLocal: '18:00', endLocal: '21:00' };
const night: AwayBlock = { daysOfWeek: [5], startLocal: '22:00', endLocal: '02:00' };

describe('blockCovering', () => {
  it('Saturday 18:30 PST is not covered by a Sunday block', () =>
    expect(blockCovering([sunEve], '2027-03-14T02:30:00Z', LA)).toBeNull());
  it('Sunday 19:00 PDT (after DST change) is covered', () =>
    expect(blockCovering([sunEve], '2027-03-15T02:00:00Z', LA)).toBe(sunEve));
  it('start inclusive, end exclusive', () => {
    expect(blockCovering([sunEve], '2027-03-15T01:00:00Z', LA)).toBe(sunEve); // 18:00 PDT
    expect(blockCovering([sunEve], '2027-03-15T04:00:00Z', LA)).toBeNull(); // 21:00 PDT
  });
  it('midnight-crossing block covers Saturday 01:00 local', () =>
    expect(blockCovering([night], '2027-01-09T09:00:00Z', LA)).toBe(night)); // Sat 01:00 PST
  it('midnight-crossing block does not cover Saturday 02:00 local or Friday 21:00', () => {
    expect(blockCovering([night], '2027-01-09T10:00:00Z', LA)).toBeNull();
    expect(blockCovering([night], '2027-01-09T05:00:00Z', LA)).toBeNull();
  });
  it('zero-length block never covers', () =>
    expect(blockCovering([{ daysOfWeek: [0, 1, 2, 3, 4, 5, 6], startLocal: '09:00', endLocal: '09:00' }], '2027-01-05T17:00:00Z', LA)).toBeNull());
});

describe('blockEndAfter', () => {
  it('midnight block ends Saturday 02:00 local as UTC', () =>
    expect(blockEndAfter(night, '2027-01-09T09:00:00Z', LA)).toBe('2027-01-09T10:00:00.000Z'));
  it('same-day block uses the offset in force (PDT)', () =>
    expect(blockEndAfter(sunEve, '2027-03-15T02:00:00Z', LA)).toBe('2027-03-15T04:00:00.000Z'));
  it('block ending after a DST change (spring forward Sun 2027-03-14 02:00)', () => {
    const b: AwayBlock = { daysOfWeek: [6], startLocal: '23:00', endLocal: '08:00' };
    // starts Sat 03-13 23:00 PST, ends Sun 08:00 PDT = 15:00Z
    expect(blockEndAfter(b, '2027-03-14T08:00:00Z', LA)).toBe('2027-03-14T15:00:00.000Z');
  });
});
