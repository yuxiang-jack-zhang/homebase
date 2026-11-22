import { chooseRegions, decideInitialEvents, presenceLabel } from './presenceLogic';

const home = { lat: 37, lng: -122, radiusM: 100 };
const row = (id: string, joined: string | null, confirmed = true) => ({
  householdId: id, home, joinedAt: joined, confirmed,
});

describe('chooseRegions', () => {
  test('only confirmed homes', () => {
    const r = chooseRegions([row('a', '2026-01-01'), row('b', '2026-01-02', false)]);
    expect(r.regions.map((x) => x.householdId)).toEqual(['a']);
    expect(r.truncated).toBe(false);
  });
  test('keeps the 20 most recently joined and flags truncation', () => {
    const rows = Array.from({ length: 22 }, (_, i) => row(`h${i}`, `2026-01-${String(i + 1).padStart(2, '0')}`));
    const r = chooseRegions(rows);
    expect(r.regions).toHaveLength(20);
    expect(r.regions.map((x) => x.householdId)).not.toContain('h0');
    expect(r.regions.map((x) => x.householdId)).not.toContain('h1');
    expect(r.truncated).toBe(true);
  });
  test('null joined_at sorts as oldest', () => {
    const r = chooseRegions([row('old', null), row('new', '2026-01-01')], 1);
    expect(r.regions.map((x) => x.householdId)).toEqual(['new']);
  });
});

describe('decideInitialEvents', () => {
  const homes = [{ householdId: 'h1', home }];
  const inside = { lat: 37, lng: -122 };
  const outside = { lat: 38, lng: -122 };
  test('no prior event: insert current state', () => {
    expect(decideInitialEvents(homes, inside, {})).toEqual([{ household_id: 'h1', kind: 'enter' }]);
    expect(decideInitialEvents(homes, outside, {})).toEqual([{ household_id: 'h1', kind: 'exit' }]);
  });
  test('same as latest: nothing; different: insert', () => {
    expect(decideInitialEvents(homes, inside, { h1: 'enter' })).toEqual([]);
    expect(decideInitialEvents(homes, outside, { h1: 'enter' })).toEqual([{ household_id: 'h1', kind: 'exit' }]);
  });
});

describe('presenceLabel', () => {
  const now = new Date(2026, 10, 22, 20, 0);
  test('dash when no visible presence', () => {
    expect(presenceLabel(undefined, now)).toBe('—');
  });
  test('same day shows time only', () => {
    const l = presenceLabel({ kind: 'enter', at: new Date(2026, 10, 22, 17, 42).toISOString() }, now);
    expect(l).toMatch(/^Home · since .*5:42/);
    expect(l).not.toMatch(/Nov/);
  });
  test('other day shows the day', () => {
    const l = presenceLabel({ kind: 'exit', at: new Date(2026, 10, 20, 9, 5).toISOString() }, now);
    expect(l).toMatch(/^Away · since .*Nov/);
  });
});
