import { test, expect } from '@playwright/test';

test.describe('mount', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/e2e/mount');
    page.on('pageerror', (err) => expect(err).toEqual(undefined));
  });

  test('should render logs correctly', async ({ page }) => {
    const btn = await page.locator('button');
    const logs = await page.locator('#logs');
    const renders = await page.locator('#renders');
    await expect(renders).toHaveText('Renders: 2');
    await expect(logs).toHaveText(`BEFORE useServerMount1()
AFTER useServerMount1()
BEFORE useMount2()
AFTER useMount2()
BEFORE useWatch3()
AFTER useWatch3()
BEFORE useServerMount4()
AFTER useServerMount4()`);

    await btn.click();
    await expect(renders).toHaveText('Renders: 3');
    await expect(logs).toHaveText(`BEFORE useServerMount1()
AFTER useServerMount1()
BEFORE useMount2()
AFTER useMount2()
BEFORE useWatch3()
AFTER useWatch3()
BEFORE useServerMount4()
AFTER useServerMount4()
Click`);
  });
});
