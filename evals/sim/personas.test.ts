import { describe, expect, it } from 'vitest';
import { PERSONAS, type PersonaId } from './personas.ts';
import { rng } from './random.ts';
import { dayOf, dow, localMs, type Interval } from './world.ts';

const H = 3_600_000;
const FROM = -14, TO = 14; // TO exclusive
const persona = (id: PersonaId) => PERSONAS.find((p) => p.id === id)!;
const timeline = (id: PersonaId, seed: number) => persona(id).timeline(rng(seed), FROM, TO);
const days = Array.from({ length: TO - FROM }, (_, i) => FROM + i);
/** Intervals that start on `day`. */
const startingOn = (tl: Interval[], day: number) => tl.filter((iv) => dayOf(iv.from) === day);
const awayOn = (tl: Interval[], day: number) => startingOn(tl, day).reduce((s, iv) => s + iv.to - iv.from, 0);
const SEEDS = [1, 2, 3, 4, 5];

describe('PERSONAS', () => {
  it('has the six personas in order with their names', () => {
    expect(PERSONAS.map((p) => [p.id, p.name])).toEqual([
      ['nine_to_five', 'Ava'], ['stale_blocks', 'Ben'], ['shift_worker', 'Cam'], ['student', 'Dee'], ['traveler', 'Eli'], ['homebody', 'Fay'],
    ]);
  });

  it.each(PERSONAS.map((p) => p.id))('%s: sorted, non-overlapping, non-empty intervals inside the run, deterministic per seed', (id) => {
    for (const seed of SEEDS) {
      const tl = timeline(id, seed);
      expect(timeline(id, seed)).toEqual(tl);
      tl.forEach((iv, i) => {
        expect(iv.from).toBeLessThan(iv.to);
        if (i > 0) expect(iv.from).toBeGreaterThan(tl[i - 1].to);
      });
      expect(tl[0].from).toBeGreaterThanOrEqual(localMs(FROM, 0));
      expect(tl.at(-1)!.to).toBeLessThanOrEqual(localMs(TO + 1, 12 * 60)); // an overnight interval may end the morning after
    }
  });

  it('nine_to_five: at least 7 h out every weekday; weekend outings under 4 h each', () => {
    for (const seed of SEEDS) {
      const tl = timeline('nine_to_five', seed);
      for (const d of days) {
        if (dow(d) >= 1 && dow(d) <= 5) expect(awayOn(tl, d)).toBeGreaterThanOrEqual(7 * H);
        else for (const iv of startingOn(tl, d)) expect(iv.to - iv.from).toBeLessThan(4 * H);
      }
    }
  });

  it('stale_blocks: Monday and Friday at home most of the day (under 4 h out in total)', () => {
    for (const seed of SEEDS) {
      const tl = timeline('stale_blocks', seed);
      for (const d of days.filter((x) => dow(x) === 1 || dow(x) === 5)) expect(awayOn(tl, d)).toBeLessThan(4 * H);
    }
  });

  it('shift_worker: exactly 3 overnight shifts per Monday-Sunday week, each crossing midnight, two of them Tue and Thu', () => {
    for (const seed of SEEDS) {
      const tl = timeline('shift_worker', seed);
      const nights = tl.filter((iv) => dayOf(iv.to) > dayOf(iv.from));
      for (let w = FROM / 7; w < TO / 7; w++) {
        const week = nights.filter((iv) => Math.floor(dayOf(iv.from) / 7) === w);
        expect(week).toHaveLength(3);
        const dows = week.map((iv) => dow(dayOf(iv.from)));
        expect(dows).toEqual(expect.arrayContaining([2, 4]));
      }
    }
  });

  it('student: 2-4 outings a day, each 1-4 h', () => {
    for (const seed of SEEDS) {
      const tl = timeline('student', seed);
      for (const d of days) {
        const o = startingOn(tl, d);
        expect(o.length).toBeGreaterThanOrEqual(2);
        expect(o.length).toBeLessThanOrEqual(4);
        for (const iv of o) {
          expect(iv.to - iv.from).toBeGreaterThanOrEqual(H);
          expect(iv.to - iv.from).toBeLessThanOrEqual(4 * H);
        }
      }
    }
  });

  it('traveler: one trip of at least 3 days that starts on or after day 3, never in the warm-up', () => {
    for (const seed of SEEDS) {
      const trips = timeline('traveler', seed).filter((iv) => iv.to - iv.from >= 3 * 24 * H);
      expect(trips).toHaveLength(1);
      expect(dayOf(trips[0].from)).toBeGreaterThanOrEqual(3);
    }
  });

  it('homebody: at most 2 outings a day, each at most 3 h', () => {
    for (const seed of SEEDS) {
      const tl = timeline('homebody', seed);
      for (const d of days) {
        const o = startingOn(tl, d);
        expect(o.length).toBeLessThanOrEqual(2);
        for (const iv of o) expect(iv.to - iv.from).toBeLessThanOrEqual(3 * H);
      }
    }
  });

  it('declares the blocks from the spec', () => {
    const weekday = [{ daysOfWeek: [1, 2, 3, 4, 5], startLocal: '09:00', endLocal: '17:00' }];
    expect(persona('nine_to_five').blocks).toEqual(weekday);
    expect(persona('stale_blocks').blocks).toEqual(weekday);
    expect(persona('traveler').blocks).toEqual(weekday);
    expect(persona('shift_worker').blocks).toEqual([{ daysOfWeek: [2, 4], startLocal: '21:30', endLocal: '06:30' }]);
    expect(persona('student').blocks).toEqual([]);
    expect(persona('homebody').blocks).toEqual([]);
  });
});
