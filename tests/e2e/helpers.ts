import type { Page, Route } from '@playwright/test';

export async function setupOpenRouterMocks(page: Page) {
  await page.route('https://openrouter.ai/api/v1/models', async (route: Route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        data: [
          {
            id: 'openai/gpt-4-turbo',
            name: 'GPT-4 Turbo',
            context_length: 4096,
            pricing: { prompt: '0.00001', completion: '0.00002' },
          },
        ],
      }),
    });
  });

  await page.route('https://openrouter.ai/api/v1/chat/completions', async (route: Route) => {
    const request = route.request();
    const body = request.postDataJSON() as { stream?: boolean } | null;

    if (body?.stream) {
      await route.fulfill({
        status: 200,
        headers: {
          'content-type': 'text/event-stream',
          connection: 'keep-alive',
          'cache-control': 'no-cache',
        },
        body:
          'data: {"choices":[{"delta":{"content":"Hello from model."},"finish_reason":null,"index":0}]}\n\n' +
          'data: [DONE]\n\n',
      });
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        choices: [
          {
            message: { content: 'Summary response.' },
          },
        ],
      }),
    });
  });
}

export async function resetStorage(page: Page) {
  await page.addInitScript(() => {
    localStorage.clear();
    indexedDB.deleteDatabase('GraphChatDB');
    localStorage.setItem('openrouter-api-key', 'test-key');
  });
}
