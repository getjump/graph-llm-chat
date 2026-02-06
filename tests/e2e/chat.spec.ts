import { test, expect } from '@playwright/test';
import { resetStorage, setupOpenRouterMocks } from './helpers';

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
