import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Alert, type AlertButton } from 'react-native';
import type { Member } from '../hooks/useHouseholds';
import { deleteAccount } from '../lib/api';
import { signOut } from '../lib/geofence';
import { supabase } from '../lib/supabase';
import { DeleteAccount, HouseholdMembers } from './HouseholdMembers';

jest.mock('../lib/supabase', () => ({ supabase: { rpc: jest.fn() } }));
jest.mock('../lib/api', () => ({ deleteAccount: jest.fn() }));
jest.mock('../lib/geofence', () => ({ signOut: jest.fn() }));
const rpc = jest.mocked(supabase.rpc);

const H = { id: 'h1', name: 'Flat 4', invite_code: 'ABC234' };
const person = (user_id: string, display_name: string, role: 'owner' | 'member' = 'member', status: 'active' | 'pending' = 'active') =>
  ({ user_id, display_name, role, status, household_id: H.id }) as Member;
const ann = person('a', 'Ann', 'owner');
const bob = person('b', 'Bob');
const pat = person('p', 'Pat', 'member', 'pending');

/** Presses the destructive button of the confirm dialog the last tap opened. */
async function confirmDialog() {
  const buttons = jest.mocked(Alert.alert).mock.calls.at(-1)![2] as AlertButton[];
  await act(async () => buttons.find((b) => b.style === 'destructive')!.onPress!());
}

const onChanged = jest.fn();
beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  rpc.mockReset().mockResolvedValue({ error: null } as never);
  onChanged.mockReset().mockResolvedValue(undefined);
  jest.mocked(deleteAccount).mockReset();
  jest.mocked(signOut).mockReset();
});

const renderAs = (userId: string) =>
  render(<HouseholdMembers household={H} userId={userId} members={[ann, bob]} requests={[pat]} onChanged={onChanged} />);

test('the owner approves and declines requests', async () => {
  await renderAs('a');
  expect(screen.getByText('Pat')).toBeTruthy();
  await fireEvent.press(screen.getByRole('button', { name: 'Approve' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('approve_member', { p_household_id: 'h1', p_user_id: 'p' }));
  await fireEvent.press(screen.getByRole('button', { name: 'Decline' }));
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('decline_member', { p_household_id: 'h1', p_user_id: 'p' }));
  expect(onChanged).toHaveBeenCalledTimes(2);
});

test('the owner removes a member only after confirming, and never sees Remove on themself', async () => {
  await renderAs('a');
  expect(screen.getAllByRole('button', { name: 'Remove' })).toHaveLength(1);
  await fireEvent.press(screen.getByRole('button', { name: 'Remove' }));
  expect(rpc).not.toHaveBeenCalled();
  await confirmDialog();
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('remove_member', { p_household_id: 'h1', p_user_id: 'b' }));
});

test('the owner rotates the invite code after confirming', async () => {
  await renderAs('a');
  await fireEvent.press(screen.getByRole('button', { name: 'New invite code' }));
  await confirmDialog();
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('rotate_invite_code', { p_household_id: 'h1' }));
});

test('a member sees no requests, Remove or rotate, and can leave after confirming', async () => {
  await renderAs('b');
  expect(screen.queryByText('Pat')).toBeNull();
  expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'New invite code' })).toBeNull();
  await fireEvent.press(screen.getByRole('button', { name: 'Leave household' }));
  expect(rpc).not.toHaveBeenCalled();
  await confirmDialog();
  await waitFor(() => expect(rpc).toHaveBeenCalledWith('leave_household', { p_household_id: 'h1' }));
  expect(onChanged).toHaveBeenCalled();
});

test('a server error is shown and nothing refreshes', async () => {
  rpc.mockResolvedValue({ error: { message: 'not_owner' } } as never);
  await renderAs('a');
  await fireEvent.press(screen.getByRole('button', { name: 'Approve' }));
  expect(await screen.findByText(/only the household owner/i)).toBeTruthy();
  expect(onChanged).not.toHaveBeenCalled();
});

test('delete account confirms, calls the function, then signs out', async () => {
  jest.mocked(deleteAccount).mockResolvedValue({ status: 'deleted' });
  await render(<DeleteAccount />);
  await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
  expect(deleteAccount).not.toHaveBeenCalled();
  await confirmDialog();
  await waitFor(() => expect(signOut).toHaveBeenCalled());
  expect(deleteAccount).toHaveBeenCalled();
});

test('a failed delete keeps the user signed in and says why', async () => {
  jest.mocked(deleteAccount).mockRejectedValue(new Error('internal_error'));
  await render(<DeleteAccount />);
  await fireEvent.press(screen.getByRole('button', { name: 'Delete account' }));
  await confirmDialog();
  expect(await screen.findByText(/server had a problem/i)).toBeTruthy();
  expect(signOut).not.toHaveBeenCalled();
});
