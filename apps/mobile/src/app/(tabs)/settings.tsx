import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ScrollView, Share, Switch, Text } from 'react-native';
import { AnswerModePicker } from '../../components/AnswerModePicker';
import { AwayBlocks } from '../../components/AwayBlocks';
import { MoveHome } from '../../components/MoveHome';
import { Button, ErrorText, Row, ui } from '../../components/ui';
import { useHouseholds, type Membership } from '../../hooks/useHouseholds';
import { friendlyError } from '../../lib/errors';
import { supabase } from '../../lib/supabase';

export default function Settings() {
  const router = useRouter();
  const { current, me, members, refresh } = useHouseholds();
  const [error, setError] = useState<string | null>(null);
  if (!current || !me) return null;

  async function save(visibility: boolean, answerMode: Membership['answer_mode']) {
    const { error: e } = await supabase.rpc('update_my_settings', {
      p_household_id: current!.id, p_visibility: visibility, p_answer_mode: answerMode,
    });
    setError(e ? friendlyError(e) : null);
    await refresh();
  }

  return (
    <ScrollView style={ui.screen} contentContainerStyle={{ paddingBottom: 48 }}>
      <Text style={ui.h2}>Household</Text>
      <Text style={ui.hint}>Members: {members.map((m) => m.display_name).join(', ')}</Text>
      <Row>
        <Text selectable style={ui.optionTitle}>Invite code: {current.invite_code}</Text>
        <Button title="Share" alt onPress={() => Share.share({ message: `Join ${current.name} on Homebase with code ${current.invite_code}` })} />
      </Row>

      <Text style={ui.h2}>Privacy</Text>
      <Row>
        <Text style={{ flex: 1 }}>Roommates can see if I'm home</Text>
        <Switch value={me.visibility} onValueChange={(v) => save(v, me.answer_mode)} />
      </Row>

      <Text style={ui.h2}>When a roommate asks about me</Text>
      <AnswerModePicker value={me.answer_mode} onChange={(m) => save(me.visibility, m)} />
      <ErrorText text={error} />

      <Text style={ui.h2}>Away blocks</Text>
      <AwayBlocks key={current.id} householdId={current.id} userId={me.user_id} />

      {me.role === 'owner' && (
        <>
          <Text style={ui.h2}>Move home</Text>
          <MoveHome key={current.id} householdId={current.id} radiusM={current.home_radius_m} />
        </>
      )}

      <Text style={ui.h2}>More</Text>
      <Button title="Create or join another household" alt onPress={() => router.push('/onboarding/household')} />
      <Button title="Sign out" alt onPress={() => supabase.auth.signOut()} />
    </ScrollView>
  );
}
