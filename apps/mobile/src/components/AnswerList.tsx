import { useEffect, useState } from 'react';
import { Text, View } from 'react-native';
import { targetLines, type TargetView } from '../lib/questionLogic';
import { ui } from './ui';

export interface QuestionItem {
  id: string;
  text: string;
  created_at: string;
  targets: (TargetView & { id: string })[];
}

/** `now` is injectable for tests; otherwise a timer re-evaluates the 10-minute "No reply yet" rule. */
export function AnswerList({ questions, now }: { questions: QuestionItem[]; now?: number }) {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    if (now !== undefined) return;
    const t = setInterval(() => setTick(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [now]);
  const clock = now ?? tick;

  if (questions.length === 0) return <Text style={ui.hint}>Nothing asked yet.</Text>;
  return (
    <View>
      <Text style={ui.h2}>Your questions</Text>
      {questions.map((q) => (
        <View key={q.id} style={ui.option}>
          <Text style={ui.optionTitle}>{q.text}</Text>
          {q.targets.map((t) => {
            const [first, ...rest] = targetLines(t, clock);
            return (
              <View key={t.id} style={{ marginTop: 4 }}>
                <Text>{first}</Text>
                {rest.map((l, i) => <Text key={`${i}${l}`} style={ui.hint}>{l}</Text>)}
              </View>
            );
          })}
        </View>
      ))}
    </View>
  );
}
