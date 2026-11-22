import { gate, type GateInput } from './gate';

const base: GateInput = { signedIn: true, loading: false, error: null, households: [{ id: 'h1' }], current: { id: 'h1' }, confirmed: true };

test.each<[string, Partial<GateInput> & { signedIn?: boolean | undefined }, string]>([
  ['session still loading', { signedIn: undefined }, 'loading'],
  ['signed out', { signedIn: false }, 'auth'],
  ['households loading', { loading: true }, 'loading'],
  ['load error with no data never goes to onboarding', { error: 'offline', households: [], current: null }, 'error'],
  ['load error wins over loading=false data', { error: 'offline' }, 'error'],
  ['no households', { households: [], current: null }, 'onboarding'],
  ['current unconfirmed', { confirmed: false }, 'confirm-home'],
  ['multi-household with unconfirmed current', { households: [{ id: 'h1' }, { id: 'h2' }], confirmed: false }, 'confirm-home'],
  ['confirmed', {}, 'tabs'],
])('%s', (_n, over, expected) => {
  expect(gate({ ...base, ...over })).toBe(expected);
});
