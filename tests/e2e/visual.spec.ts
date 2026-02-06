import { test, expect } from '@playwright/test';
import { resetStorage, setupOpenRouterMocks } from './helpers';

test.beforeEach(async ({ page }) => {
  await resetStorage(page);
  await setupOpenRouterMocks(page);
});

test('chat view @visual', async ({ page }) => {
  await page.goto('/');
  await page.getByTestId('new-chat').click();
  await page.getByTestId('chat-input').fill('Visual test');
  await page.getByTestId('send-message').click();
  await page.waitForTimeout(300);

  await page.addStyleTag({
    content: `
      * { animation: none !important; transition: none !important; }
    `,
  });

  await expect(page).toHaveScreenshot('chat-view.png', {
    fullPage: true,
  });
});
