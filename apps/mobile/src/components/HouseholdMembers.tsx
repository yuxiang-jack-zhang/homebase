import { useState } from 'react';
import { Alert, Share, Text } from 'react-native';
import type { Household, Member } from '../hooks/useHouseholds';
import { deleteAccount } from '../lib/api';
import { friendlyError } from '../lib/errors';
import { signOut } from '../lib/geofence';
import { supabase } from '../lib/supabase';
import { Button, ErrorText, Row, ui } from './ui';

function confirm(title: string, message: string, action: string, onYes: () => void) {
  Alert.alert(title, message, [{ text: 'Cancel', style: 'cancel' }, { text: action, style: 'destructive', onPress: onYes }]);
}

/** Who's in the household and the controls over it: requests, remove, invite code, leave, delete account. */
export function HouseholdMembers({ household, userId, members, requests, onChanged }: {
  household: Pick<Household, 'id' | 'name' | 'invite_code'>;
  userId: string;
  members: Member[];
  requests: Member[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const isOwner = members.some((m) => m.user_id === userId && m.role === 'owner');
  const hid = household.id;

  async function run(key: string, action: () => PromiseLike<{ error: unknown }>) {
    setBusy(key);
    setError(null);
    try {
      const { error: e } = await action();
      if (e) throw e;
      await onChanged();
    } catch (e) {
      setError(friendlyError(e as Error));
    }
    setBusy(null);
  }
  const member = (fn: 'approve_member' | 'decline_member' | 'remove_member', id: string) =>
    run(`${fn}:${id}`, () => supabase.rpc(fn, { p_household_id: hid, p_user_id: id }));

  const leaveMessage = !isOwner
    ? 'You lose access, and your home/away history and away blocks here are deleted.'
    : members.length === 1
      ? `You're the only member, so ${household.name} is deleted.`
      : 'You lose access and your history here is deleted. The longest-standing member becomes the owner.';

  return (
    <>
      {isOwner && requests.length > 0 && (
        <>
          <Text style={ui.h2}>Asking to join</Text>
          {requests.map((r) => (
            <Row key={r.user_id}>
              <Text style={{ flex: 1 }}>{r.display_name}</Text>
              <Button title="Approve" busy={busy === `approve_member:${r.user_id}`} onPress={() => member('approve_member', r.user_id)} />
              <Button title="Decline" alt busy={busy === `decline_member:${r.user_id}`} onPress={() => member('decline_member', r.user_id)} />
            </Row>
          ))}
        </>
      )}

      <Text style={ui.h2}>Household</Text>
      {members.map((m) => (
        <Row key={m.user_id}>
          <Text style={{ flex: 1 }}>{m.display_name}{m.user_id === userId ? ' (you)' : ''}{m.role === 'owner' ? ' · owner' : ''}</Text>
          {isOwner && m.user_id !== userId && (
            <Button title="Remove" alt busy={busy === `remove_member:${m.user_id}`} onPress={() => confirm(
              `Remove ${m.display_name}?`, 'They lose access to this household, and their home/away history here is deleted.',
              'Remove', () => member('remove_member', m.user_id))} />
          )}
        </Row>
      ))}
      <Row>
        <Text selectable style={ui.optionTitle}>Invite code: {household.invite_code}</Text>
        <Button title="Share" alt onPress={() => Share.share({ message: `Join ${household.name} on Homebase with code ${household.invite_code}` })} />
      </Row>
      <Text style={ui.hint}>Anyone with the code can ask to join; {isOwner ? 'you approve' : 'the owner approves'} each request.</Text>
      {isOwner && (
        <Button title="New invite code" alt busy={busy === 'rotate'} onPress={() => confirm(
          'Make a new invite code?', 'The current code stops working. Pending requests stay.',
          'New code', () => run('rotate', () => supabase.rpc('rotate_invite_code', { p_household_id: hid })))} />
      )}
      <Button title="Leave household" alt busy={busy === 'leave'} onPress={() => confirm(
        `Leave ${household.name}?`, leaveMessage,
        'Leave', () => run('leave', () => supabase.rpc('leave_household', { p_household_id: hid })))} />
      <ErrorText text={error} />
    </>
  );
}

export function DeleteAccount() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function remove() {
    setBusy(true);
    setError(null);
    try {
      await deleteAccount();
      await signOut();
    } catch (e) {
      setError(friendlyError(e as Error));
    }
    setBusy(false);
  }
  return (
    <>
      <Button title="Delete account" alt busy={busy} onPress={() => confirm(
        'Delete your account?',
        "This deletes your account, your home/away history and your questions. Households you own pass to the longest-standing member, or are deleted if you're the only one.",
        'Delete', remove)} />
      <ErrorText text={error} />
    </>
  );
}
