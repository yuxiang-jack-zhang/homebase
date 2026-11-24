import { describe, expect, it } from 'vitest';
import { localMs } from '../world.ts';
import { applyChange, clipAfter, fmt, hhmm, toIntervals, validOutings, type Outing } from './day.ts';

const o = (leave: string, back: string, why = 'x'): Outing => ({ leave, back, why });

describe('hhmm / fmt', () => {
  it('round-trip, including after-midnight times up to 29:00', () => {
    expect(hhmm('09:30')).toBe(570);
    expect(hhmm('25:30')).toBe(1530);
    expect(fmt(1530)).toBe('25:30');
    expect(fmt(5)).toBe('00:05');
    expect(() => hhmm('9:3')).toThrow();
    expect(() => hhmm('30:00')).toThrow();
    expect(() => hhmm('10:60')).toThrow();
  });
});

describe('validOutings', () => {
  it('accepts sorted, separated outings inside 05:00-29:00', () => {
    expect(validOutings([o('08:30', '17:30'), o('19:00', '25:30')])).toBeNull();
    expect(validOutings([])).toBeNull();
  });
  it('rejects overlap, touching, back before leave, out of range and bad formats', () => {
    expect(validOutings([o('08:00', '12:00'), o('11:00', '13:00')])).toMatch(/overlap/);
    expect(validOutings([o('08:00', '12:00'), o('12:00', '13:00')])).toMatch(/overlap/);
    expect(validOutings([o('12:00', '11:00')])).toMatch(/before/);
    expect(validOutings([o('04:00', '06:00')])).toMatch(/range/);
    expect(validOutings([o('22:00', '29:30')])).toMatch(/range|format/);
    expect(validOutings([o('8am', '9am')])).toMatch(/format/);
  });
});

describe('toIntervals', () => {
  it('maps a plan day to UTC intervals, overnight included', () => {
    expect(toIntervals(2, [o('22:00', '26:00')])).toEqual([{ from: localMs(2, 22 * 60), to: localMs(2, 26 * 60) }]);
  });
});

describe('applyChange', () => {
  const plan = [o('08:00', '09:00', 'gym'), o('13:00', '18:00', 'work'), o('20:00', '23:00', 'bar')];

  it('while home: keeps finished outings, drops change outings before now, ignores backBy', () => {
    const now = hhmm('10:00');
    expect(applyChange(plan, { backBy: '11:00', outings: [o('09:30', '09:45'), o('16:00', '17:00', 'errand')] }, now))
      .toEqual([o('08:00', '09:00', 'gym'), o('16:00', '17:00', 'errand')]);
  });

  it('while out: the current outing ends at backBy (never before now), finished outings untouched', () => {
    const now = hhmm('14:00');
    expect(applyChange(plan, { backBy: '15:00', outings: [] }, now)).toEqual([o('08:00', '09:00', 'gym'), o('13:00', '15:00', 'work')]);
    expect(applyChange(plan, { backBy: '12:00', outings: [] }, now)).toEqual([o('08:00', '09:00', 'gym'), o('13:00', '14:00', 'work')]);
  });

  it('while out without backBy: keeps the current return and drops new outings that would overlap it', () => {
    const now = hhmm('14:00');
    expect(applyChange(plan, { outings: [o('17:00', '19:00'), o('19:30', '21:00', 'dinner')] }, now))
      .toEqual([o('08:00', '09:00', 'gym'), o('13:00', '18:00', 'work'), o('19:30', '21:00', 'dinner')]);
  });

  it('an invalid change leaves the plan as it was', () => {
    const now = hhmm('10:00');
    expect(applyChange(plan, { outings: [o('15:00', '16:00'), o('15:30', '17:00')] }, now)).toEqual(plan);
  });
});

describe('clipAfter', () => {
  it("moves outings that would start before yesterday's overnight return", () => {
    const yesterdayBack = hhmm('06:30'); // yesterday's 30:30
    expect(clipAfter([o('06:00', '09:00'), o('12:00', '13:00')], yesterdayBack)).toEqual([o('06:45', '09:00'), o('12:00', '13:00')]);
    expect(clipAfter([o('05:00', '06:40')], yesterdayBack)).toEqual([]);
  });
});
