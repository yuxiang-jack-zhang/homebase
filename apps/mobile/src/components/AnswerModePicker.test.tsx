import { fireEvent, render, screen } from '@testing-library/react-native';
import { AnswerModePicker } from './AnswerModePicker';

test('shows three plain-language options and reports the pressed one', async () => {
  const onChange = jest.fn();
  await render(<AnswerModePicker value="ask_me" onChange={onChange} />);
  expect(screen.getByText('Ask me first')).toBeTruthy();
  expect(screen.getByText('Always answer')).toBeTruthy();
  await fireEvent.press(screen.getByText('Answer if confident'));
  expect(onChange).toHaveBeenCalledWith('auto_when_confident');
});

test('marks the current value as selected', async () => {
  await render(<AnswerModePicker value="always_auto" onChange={() => {}} />);
  expect(screen.getByRole('radio', { name: 'Always answer' })).toBeSelected();
});
