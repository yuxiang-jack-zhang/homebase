import { Pressable, Text, View } from 'react-native';
import type { AnswerMode } from '@homebase/core/src/types';
import { ui } from './ui';

export const ANSWER_MODES: { value: AnswerMode; label: string; hint: string }[] = [
  { value: 'ask_me', label: 'Ask me first', hint: 'I get a notification and reply myself.' },
  { value: 'auto_when_confident', label: 'Answer if confident', hint: 'Homebase answers when it is sure, otherwise asks me.' },
  { value: 'always_auto', label: 'Always answer', hint: 'Homebase answers for me, with a caveat when unsure.' },
];

export function AnswerModePicker({ value, onChange }: { value: AnswerMode; onChange: (m: AnswerMode) => void }) {
  return (
    <View accessibilityRole="radiogroup">
      {ANSWER_MODES.map((m) => {
        const selected = m.value === value;
        return (
          <Pressable
            key={m.value}
            accessibilityRole="radio"
            accessibilityLabel={m.label}
            accessibilityState={{ selected }}
            onPress={() => onChange(m.value)}
            style={[ui.option, selected && ui.optionOn]}>
            <Text style={ui.optionTitle}>{m.label}</Text>
            <Text style={ui.hint}>{m.hint}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}
