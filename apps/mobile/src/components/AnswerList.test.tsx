import { render, screen } from '@testing-library/react-native';
import { AnswerList, type QuestionItem } from './AnswerList';

const NOW = Date.parse('2026-11-22T12:00:00Z');
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();

const q = (t: Partial<QuestionItem['targets'][number]>): QuestionItem[] => [{
  id: 'q1', text: 'will you be home at 7?', created_at: ago(1),
  targets: [{ id: 't1', name: 'Bea', status: 'awaiting_reply', text: null, fallback_guess: null, created_at: ago(1), ...t }],
}];

test('awaiting under 10 minutes shows waiting', async () => {
  await render(<AnswerList questions={q({ created_at: ago(9) })} now={NOW} />);
  expect(screen.getByText('will you be home at 7?')).toBeTruthy();
  expect(screen.getByText('Asked Bea — waiting…')).toBeTruthy();
});

test('awaiting over 10 minutes shows No reply yet and the fallback guess', async () => {
  await render(<AnswerList questions={q({ created_at: ago(11), fallback_guess: 'Probably home around 7' })} now={NOW} />);
  expect(screen.getByText('No reply yet')).toBeTruthy();
  expect(screen.getByText('Probably home around 7')).toBeTruthy();
});

test('no guess line when fallback_guess is null', async () => {
  await render(<AnswerList questions={q({ created_at: ago(30) })} now={NOW} />);
  expect(screen.getByText('No reply yet')).toBeTruthy();
  expect(screen.queryByText(/probably/i)).toBeNull();
  expect(screen.queryByTestId('guess')).toBeNull();
});

test('answered, replied and unknown', async () => {
  const items: QuestionItem[] = [{
    id: 'q', text: 'home?', created_at: ago(1),
    targets: [
      { id: 'a', name: 'Bea', status: 'answered', text: 'Bea is home.', fallback_guess: null, created_at: ago(1) },
      { id: 'b', name: 'Cy', status: 'replied', text: 'Back at 8', fallback_guess: null, created_at: ago(1) },
      { id: 'c', name: 'Di', status: 'unknown', text: null, fallback_guess: null, created_at: ago(1) },
    ],
  }];
  await render(<AnswerList questions={items} now={NOW} />);
  expect(screen.getByText('Bea is home.')).toBeTruthy();
  expect(screen.getByText('Back at 8')).toBeTruthy();
  expect(screen.getByText('Di: unknown')).toBeTruthy();
});
