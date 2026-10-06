import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
const password = 'Test-Password-2026!';
async function login(page: Page, email: string) {
  await page.goto('/login'); await page.getByLabel('Email', { exact: true }).fill(email); await page.getByLabel('Mật khẩu', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Đăng nhập', exact: true }).click(); await expect(page.getByRole('button', { name: 'Đăng xuất' })).toBeVisible();
}
test('worker: automatic keys, extra stock, multi-platform, withdraw, CLOSED; admin: payout through PAID', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  // Integration tests create this isolated DB fixture. Create a dedicated worker through the real admin UI.
  await login(page, 'admin@test.local');
  const email = `e2e-${Date.now()}@test.local`;
  await page.getByRole('button', { name: 'Thêm CTV', exact: true }).click();
  const create = page.getByRole('dialog');
  await create.getByLabel('Họ tên', { exact: true }).fill('E2E Worker'); await create.getByLabel('Email', { exact: true }).fill(email); await create.getByLabel('Mật khẩu', { exact: true }).fill(password); await create.getByRole('button', { name: 'Tạo tài khoản' }).click();
  await expect(create).not.toBeVisible(); await page.getByRole('button', { name: 'Đăng xuất' }).click(); await page.waitForURL('**/login');
  await login(page, email);
  await page.getByRole('button', { name: 'Làm nền tảng', exact: true }).click();
  let dialog = page.getByRole('dialog'); await dialog.getByLabel('Số Key', { exact: true }).fill('2');
  await expect(dialog.getByText('Thiếu:')).toContainText('2');
  const prefix = String(Date.now());
  await dialog.getByLabel('Data bổ sung').fill(`E2E One|${prefix}01|VCB\nE2E Two|${prefix}02|MB\nE2E Extra|${prefix}03|BIDV`);
  await dialog.getByRole('button', { name: 'Bắt đầu' }).click(); await expect(dialog).not.toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  await page.getByRole('button', { name: 'Kho Key', exact: true }).click(); await expect(page.locator('tbody tr')).toHaveCount(3);
  await page.getByRole('button', { name: 'Hôm nay', exact: true }).click();
  await page.getByRole('button', { name: 'Làm nền tảng', exact: true }).click(); dialog = page.getByRole('dialog');
  await dialog.getByLabel('Platform', { exact: true }).selectOption({ label: 'B' }); await dialog.getByLabel('Số Key', { exact: true }).fill('2');
  await expect(dialog.getByText('Key có sẵn:')).toContainText('3'); await dialog.getByRole('button', { name: 'Bắt đầu' }).click(); await expect(dialog).not.toBeVisible();
  await expect(page.locator('tbody tr')).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await page.getByRole('button', { name: 'Mở / Nhập Rút' }).nth(i).click(); dialog = page.getByRole('dialog');
    for (const name of ['A', 'B']) {
      const input = dialog.getByRole('spinbutton', { name: `Rút ${name}`, exact: true });
      await input.fill('200'); await input.locator('..').getByRole('button', { name: 'Hoàn thành', exact: true }).click();
      await expect(input.locator('..').getByRole('button', { name: 'Lưu', exact: true })).toBeVisible();
    }
    await dialog.getByRole('button', { name: 'Đóng', exact: true }).last().click();
  }
  await page.getByRole('button', { name: 'Tổng kết', exact: true }).click();
  await expect(page.locator('.metric.highlight strong')).toHaveText('560');
  await page.getByRole('button', { name: 'Chốt ngày', exact: true }).click(); await expect(page.locator('.locked-note')).toContainText('CLOSED');
  await page.getByRole('button', { name: 'Mở / Nhập Rút' }).first().click();
  await expect(page.getByRole('spinbutton', { name: 'Rút A', exact: true })).toBeDisabled(); await page.getByRole('dialog').getByRole('button', { name: 'Đóng', exact: true }).last().click();
  await page.screenshot({ path: 'test-results/worker-summary.png', fullPage: true });
  await page.getByRole('button', { name: 'Đăng xuất' }).click(); await page.waitForURL('**/login'); await login(page, 'admin@test.local');
  await page.getByRole('button', { name: 'Đối soát', exact: true }).click();
  const row = page.locator('tbody tr').filter({ hasText: 'E2E Worker' });
  await expect(row.locator('.payout-cell')).toHaveText('560');
  await row.getByRole('button', { name: 'Duyệt', exact: true }).click(); await expect(row).toContainText('APPROVED');
  await row.getByRole('button', { name: 'Đã trả', exact: true }).click(); await expect(row).toContainText('PAID');
  await page.screenshot({ path: 'test-results/admin-settlements.png', fullPage: true });
  expect(errors).toEqual([]);
});
test('HTTP authentication, CSRF, RBAC and invalid idempotency key', async ({ request }) => {
  expect((await request.get('/api/workspace')).status()).toBe(401);
  expect((await request.post('/api/auth/login', { data: { email: 'other@test.local', password }, headers: { Origin: 'https://evil.example' } })).status()).toBe(403);
  expect((await request.post('/api/auth/login', { data: { email: 'other@test.local', password }, headers: { Origin: 'http://localhost:3001' } })).status()).toBe(200);
  expect((await request.get('/api/workspace?view=settlements')).status()).toBe(403);
  expect((await request.post('/api/workspace', { data: { action: 'platform', name: 'forbidden' }, headers: { Origin: 'http://localhost:3001', 'Idempotency-Key': crypto.randomUUID() } })).status()).toBe(403);
  expect((await request.post('/api/workspace', { data: { action: 'import', data: 'X|999999999|MB' }, headers: { Origin: 'http://localhost:3001' } })).status()).toBe(400);
});
