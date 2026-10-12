import { test, expect, type Page } from '@playwright/test';

const SHOTS = process.env.SHOTS_DIR;
const shot = async (page: Page, name: string) => {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${test.info().project.name}-${name}.png` });
};

async function noHorizontalOverflow(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

/** Проходит продающие слайды и обучение до paywall. */
async function throughOnboarding(page: Page) {
  await page.goto('/');
  await expect(page.getByText('Устала начинать новую жизнь с понедельника?')).toBeVisible({ timeout: 20000 });
  await shot(page, '01-slide1');
  for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Дальше' }).click();
  await shot(page, '02-slide4');
  await page.getByRole('button', { name: 'Попробовать' }).click();
  await expect(page.getByText('Всё начинается с маленького ростка')).toBeVisible();
  await shot(page, '03-tutorial-intro');
  await page.getByRole('button', { name: 'Начать' }).click();
  await page.getByText('Выпить стакан воды').click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByText('Сделать 10 приседаний').click();
  await page.getByRole('button', { name: 'Дальше' }).click();
  await page.getByRole('button', { name: /Полить · 1/ }).click();
  await expect(page.getByText('Уровень 2!')).toBeVisible();
  await page.getByRole('button', { name: /Полить · 2/ }).click({ timeout: 10000 });
  await expect(page.getByText('Уровень 3!')).toBeVisible();
  await shot(page, '04-tutorial-watered');
  await page.getByRole('button', { name: 'Здорово! Дальше' }).click({ timeout: 10000 });
  await expect(page.getByText('Сад живёт вместе с тобой')).toBeVisible();
  await shot(page, '05-tutorial-wither');
  await page.getByRole('button', { name: 'Дальше' }).click();
  await shot(page, '06-tutorial-garden');
  await page.getByRole('button', { name: 'Выбрать свои сферы' }).click();
  await page.getByRole('button', { name: /Здоровье/ }).click();
  await page.getByRole('button', { name: /Работа/ }).click();
  await page.getByRole('button', { name: 'Продолжить' }).click();
  await expect(page.getByRole('button', { name: 'Открыть свой сад' })).toBeVisible();
}

async function pay(page: Page) {
  await page.getByRole('button', { name: 'Открыть свой сад' }).click();
  await page.getByRole('button', { name: 'Оплатить (тест)' }).click();
  await expect(page.getByText('Сад открыт! 🌱')).toBeVisible();
}

test('first entry: slides → tutorial → test watering → paywall; no real access without payment', async ({ page }) => {
  await throughOnboarding(page);
  await shot(page, '07-paywall');
  await noHorizontalOverflow(page);
  const token = await page.evaluate(() => sessionStorage.getItem('rostok.token'));
  const r = await page.request.get('/api/garden', { headers: { authorization: `Bearer ${token}` } });
  expect(r.status()).toBe(402);
  const t = await page.request.post('/api/tasks', { headers: { authorization: `Bearer ${token}` }, data: { title: 'x', sphere: 'work', kind: 'daily', drops: 1, hardcore: false } });
  expect(t.status()).toBe(402);
  // повторный вход: онбординг не повторяется
  await page.reload();
  await expect(page.getByRole('button', { name: 'Открыть свой сад' })).toBeVisible({ timeout: 20000 });
});

test('paid flow: first task, single reward per day on double tap, watering, history line, challenges demo', async ({ page }) => {
  await throughOnboarding(page);
  await pay(page);
  await shot(page, '08-first-task');
  await page.getByRole('button', { name: /Прогулка 30 минут/ }).click();
  await page.locator('#t-title').fill('Прогулка 30 минут');
  await shot(page, '09-wizard');
  await page.getByRole('button', { name: 'Создать задачу' }).click();
  await expect(page.getByRole('heading', { name: 'Мой сад' })).toBeVisible();
  await page.waitForTimeout(600);
  await shot(page, '10-garden');
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Задачи', exact: true }).click();
  const check = page.getByRole('button', { name: 'Отметить «Прогулка 30 минут» выполненной' });
  await check.dblclick();
  await expect(page.getByRole('button', { name: '«Прогулка 30 минут» выполнено' })).toBeVisible();
  const token = await page.evaluate(() => sessionStorage.getItem('rostok.token'));
  const g = await (await page.request.get('/api/garden', { headers: { authorization: `Bearer ${token}` } })).json();
  expect(g.trees.find((t: any) => t.sphere === 'health').availableDrops).toBe(1);
  expect(g.trees.find((t: any) => t.sphere === 'relationships').availableDrops).toBe(0);
  // мини-линия дней: компактная и горизонтальная
  const line = page.getByRole('list', { name: 'История выполнений' }).first();
  const box = await line.boundingBox();
  expect(box!.height).toBeLessThanOrEqual(44);
  await expect(page.getByText('Пример')).toBeVisible();
  const you = await page.getByText('Ты', { exact: true }).last().boundingBox();
  const friend = await page.getByText('Подруга', { exact: true }).boundingBox();
  expect(you!.y).toBeLessThan(friend!.y);
  await shot(page, '11-tasks');
  await noHorizontalOverflow(page);
  // полив
  await page.getByRole('button', { name: 'Сад', exact: true }).click();
  await page.getByRole('button', { name: /Здоровье, уровень 1/ }).click();
  await shot(page, '12-tree-sheet');
  await page.getByRole('button', { name: /Полить · 1/ }).click();
  await expect(page.getByText('Уровень 2!')).toBeVisible();
  await page.waitForTimeout(2800);
  await page.getByRole('button', { name: /Полить · 2/ }).click();
  await expect(page.getByText(/Для следующего полива нужно ещё 2 капли/)).toBeVisible();
  await shot(page, '13-not-enough');
});

test('cancel flow: two honest dialogs, then real cancellation with access until period end', async ({ page }) => {
  await throughOnboarding(page);
  await pay(page);
  await page.getByRole('button', { name: 'Позже, сначала посмотрю сад' }).click();
  await page.getByRole('button', { name: 'Профиль' }).click();
  await shot(page, '14-profile');
  await noHorizontalOverflow(page);
  await page.getByRole('button', { name: 'Настройки' }).click();
  await page.getByRole('button', { name: 'Управление подпиской' }).click();
  await page.getByRole('button', { name: 'Отменить подписку' }).click();
  await expect(page.getByText('Жалко, что ты уходишь')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Остаться' })).toBeVisible();
  await shot(page, '15-cancel-1');
  await page.getByRole('button', { name: 'Всё равно отменить' }).click();
  await expect(page.getByText(/Следующий месяц за 200 ⭐/)).toBeVisible();
  await shot(page, '16-cancel-2');
  await page.getByRole('button', { name: 'Отменить подписку' }).click();
  await expect(page.getByText(/Автопродление отключено. Доступ к саду сохранится до/)).toBeVisible();
  const token = await page.evaluate(() => sessionStorage.getItem('rostok.token'));
  const s = await (await page.request.get('/api/subscription', { headers: { authorization: `Bearer ${token}` } })).json();
  expect(s).toMatchObject({ access: true, status: 'cancel_at_period_end', autoRenew: false });
});

test('reduced motion is respected', async ({ browser }) => {
  const ctx = await browser.newContext({ reducedMotion: 'reduce', viewport: { width: 375, height: 667 } });
  const page = await ctx.newPage();
  await page.goto('/');
  await expect(page.getByText('Устала начинать новую жизнь с понедельника?')).toBeVisible({ timeout: 20000 });
  const anim = await page.evaluate(() => {
    const el = document.querySelector('.tree-sway');
    return el ? getComputedStyle(el).animationName : 'none';
  });
  expect(anim).toBe('none');
  await ctx.close();
});
