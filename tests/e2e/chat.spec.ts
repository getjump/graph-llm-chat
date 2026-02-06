import { test, expect, type Page } from '@playwright/test';
import { resetStorage, setupOpenRouterMocks } from './helpers';

async function getActiveConversationId(page: Page) {
  return page
    .locator('[data-testid="conversation-item"][data-active="true"]')
    .getAttribute('data-conversation-id');
}

async function expectActiveConversationTitle(page: Page, title: string) {
  await expect(page.locator('[data-testid="conversation-item"][data-active="true"]')).toContainText(
    title
  );
}

test.beforeEach(async ({ page }) => {
  await resetStorage(page);
  await setupOpenRouterMocks(page);
});

test('create chat and send message', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-input').fill('Hello');
  await page.getByTestId('send-message').click();

  await expect(page.getByText('Hello', { exact: true })).toBeVisible();
  await expect(page.getByText('Hello from model.')).toBeVisible();
});

test('switch to context view', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-chat').click();
  await page.getByTestId('view-context').click();
  await expect(page.getByTestId('context-view')).toBeVisible();
});

test('reply to assistant message', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-input').fill('Hello');
  await page.getByTestId('send-message').click();

  await page.getByTestId('toggle-replies').click();
  await page.getByTestId('reply-input').fill('Reply message');
  await page.getByTestId('send-reply').click();

  await expect(
    page.getByTestId('message-item').filter({ hasText: 'Reply message' }).first()
  ).toBeVisible();
});

test('edit a message', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-input').fill('Hello');
  await page.getByTestId('send-message').click();

  const message = page.getByTestId('message-item').filter({
    hasText: 'Hello',
  });
  await message.first().hover();
  await message.first().getByTestId('edit-message').click();
  await page.getByTestId('edit-message-input').fill('Hello edited');
  await page.getByTestId('save-message').click();

  await expect(page.getByText('Hello edited', { exact: true })).toBeVisible();
});

test('delete a message', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-input').fill('Hello');
  await page.getByTestId('send-message').click();

  const message = page.getByTestId('message-item').filter({
    hasText: 'Hello',
  });
  await message.first().hover();
  await message.first().getByTestId('delete-message').click();

  await expect(page.getByText('Hello', { exact: true })).toHaveCount(0);
});

test('attach a file shows attachment chip', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-chat').click();

  await page.getByTestId('file-input').setInputFiles({
    name: 'notes.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('hello'),
  });

  await expect(page.getByTestId('attachment-chip')).toHaveCount(1);
  await expect(page.getByTestId('attachment-chip')).toContainText('notes.txt');
});

test('switch chats keeps messages isolated', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-input').fill('Message in chat one');
  await page.getByTestId('send-message').click();
  await expect(page.getByText('Message in chat one', { exact: true })).toBeVisible();
  await expect(page.getByText('Hello from model.')).toBeVisible();

  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-input').fill('Message in chat two');
  await page.getByTestId('send-message').click();
  await expect(page.getByText('Message in chat two', { exact: true })).toBeVisible();
  await expect(page.getByText('Hello from model.')).toBeVisible();

  await page.getByRole('button', { name: 'Chat 1' }).click();
  await expect(page.getByText('Message in chat one', { exact: true })).toBeVisible();
  await expect(page.getByText('Message in chat two', { exact: true })).toHaveCount(0);

  await page.getByRole('button', { name: 'Chat 2' }).click();
  await expect(page.getByText('Message in chat two', { exact: true })).toBeVisible();
});

test('preserves main draft while switching chats and tabs', async ({ page }) => {
  await page.goto('/');

  await page.getByTestId('new-chat').click();
  await expectActiveConversationTitle(page, 'Chat 1');
  await page.getByTestId('chat-input').fill('Draft in first chat');

  await page.getByTestId('new-chat').click();
  await expectActiveConversationTitle(page, 'Chat 2');
  await page.getByTestId('chat-input').fill('Draft in second chat');

  await page.getByRole('button', { name: 'Chat 1' }).click();
  await expectActiveConversationTitle(page, 'Chat 1');
  await expect(page.getByTestId('chat-input')).toHaveValue('Draft in first chat');

  await page.getByTestId('view-context').click();
  await page.getByTestId('view-chat').click();
  await expect(page.getByTestId('chat-input')).toHaveValue('Draft in first chat');

  await page.getByRole('button', { name: 'Chat 2' }).click();
  await expectActiveConversationTitle(page, 'Chat 2');
  await expect(page.getByTestId('chat-input')).toHaveValue('Draft in second chat');
});

test('supports parallel reply drafts on different messages', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-chat').click();

  const sourceChatId = await getActiveConversationId(page);
  expect(sourceChatId).toBeTruthy();

  await page.getByTestId('flow-mode-toggle').click();
  await expect(page.getByTestId('flow-mode-state')).toHaveText('Enabled');

  await page.getByTestId('chat-input').fill('First message');
  await page.getByTestId('send-message').click();
  await expect(page.getByText('First message', { exact: true })).toBeVisible();
  await expect(page.getByText('Hello from model.')).toBeVisible();

  await page.getByTestId('chat-input').fill('Second message');
  await page.getByTestId('send-message').click();
  await expect(page.getByText('Second message', { exact: true })).toBeVisible();
  await expect(page.getByText('Hello from model.')).toHaveCount(2);

  const toggles = page.getByTestId('toggle-replies');
  await expect(toggles).toHaveCount(2);

  await toggles.nth(0).click();
  await toggles.nth(1).click();

  const inputs = page.getByTestId('reply-input');
  await expect(inputs).toHaveCount(2);
  await inputs.nth(0).fill('Draft reply for first');
  await inputs.nth(1).fill('Draft reply for second');

  await page.getByTestId('new-chat').click();
  await page
    .locator(`[data-testid="conversation-item"][data-conversation-id="${sourceChatId}"]`)
    .click();

  const restoredToggles = page.getByTestId('toggle-replies');
  await expect(restoredToggles).toHaveCount(2);

  let restoredInputs = page.getByTestId('reply-input');
  if ((await restoredInputs.count()) === 0) {
    await restoredToggles.nth(0).click();
    await restoredToggles.nth(1).click();
    restoredInputs = page.getByTestId('reply-input');
  }
  await expect(restoredInputs).toHaveCount(2);

  const restoredValues = await page
    .getByTestId('reply-input')
    .evaluateAll((inputs) =>
      inputs
        .map((input) => (input as HTMLTextAreaElement).value)
        .sort()
    );
  expect(restoredValues).toEqual(['Draft reply for first', 'Draft reply for second']);
});
