import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { ask } from '../lib/api';
import { AskBox } from './AskBox';

jest.mock('../lib/api', () => ({ ask: jest.fn() }));

const H = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const others = [{ user_id: B, display_name: 'Bea' }, { user_id: C, display_name: 'Cy' }];
const resp = { questionId: H, targets: [] };

beforeEach(() => jest.mocked(ask).mockReset().mockResolvedValue(resp));

test('Send is disabled without a target or without text', async () => {
  await render(<AskBox householdId={H} others={others} />);
  const send = () => screen.getByRole('button', { name: 'Send' });
  expect(send()).toBeDisabled();
  await fireEvent.changeText(screen.getByPlaceholderText(/ask/i), 'are you home?');
  expect(send()).toBeDisabled(); // text but no target
  await fireEvent.press(screen.getByText('Bea'));
  expect(send()).toBeEnabled();
  await fireEvent.changeText(screen.getByPlaceholderText(/ask/i), '   ');
  expect(send()).toBeDisabled(); // blank text
});

test('Everyone sends target "everyone"', async () => {
  const onAsked = jest.fn();
  await render(<AskBox householdId={H} others={others} onAsked={onAsked} />);
  await fireEvent.press(screen.getByText('Everyone'));
  await fireEvent.changeText(screen.getByPlaceholderText(/ask/i), ' who is home? ');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(ask).toHaveBeenCalledWith({ householdId: H, target: 'everyone', text: 'who is home?' }));
  await waitFor(() => expect(onAsked).toHaveBeenCalled());
});

test('individual chips send userIds', async () => {
  await render(<AskBox householdId={H} others={others} />);
  await fireEvent.press(screen.getByText('Bea'));
  await fireEvent.press(screen.getByText('Cy'));
  await fireEvent.changeText(screen.getByPlaceholderText(/ask/i), 'home at 7?');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  await waitFor(() => expect(ask).toHaveBeenCalledWith({ householdId: H, target: { userIds: [B, C] }, text: 'home at 7?' }));
});

test('shows a server error', async () => {
  jest.mocked(ask).mockRejectedValue(new Error('no_targets'));
  await render(<AskBox householdId={H} others={others} />);
  await fireEvent.press(screen.getByText('Bea'));
  await fireEvent.changeText(screen.getByPlaceholderText(/ask/i), 'hi');
  await fireEvent.press(screen.getByRole('button', { name: 'Send' }));
  expect(await screen.findByText(/nobody to ask/)).toBeTruthy();
});
