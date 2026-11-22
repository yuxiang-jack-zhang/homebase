export interface GateInput {
  signedIn: boolean | undefined; // undefined while the stored session loads
  loading: boolean;
  error: string | null;
  households: { id: string }[];
  current: { id: string } | null;
  confirmed: boolean; // current membership has home_confirmed_at
}
export type GateState = 'loading' | 'auth' | 'error' | 'onboarding' | 'confirm-home' | 'tabs';

/** Where the signed-in flow belongs. A load error must never look like "no household". */
export function gate(i: GateInput): GateState {
  if (i.signedIn === undefined) return 'loading';
  if (!i.signedIn) return 'auth';
  if (i.error) return 'error';
  if (i.loading) return 'loading';
  if (i.households.length === 0 || !i.current) return 'onboarding';
  return i.confirmed ? 'tabs' : 'confirm-home';
}
