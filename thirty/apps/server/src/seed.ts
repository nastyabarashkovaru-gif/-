import { DEFAULT_TARIFFS } from '@thirty/domain';
import { prisma } from './db';
import { config } from './config';
import { seedTemplates } from './modules/bot';
import { hashPassword } from './auth/admin';

/** Начальные данные: тарифы ТЗ 1.1, шаблоны бота, первый администратор (owner). Идемпотентно. */
export async function seed() {
  for (const [i, t] of DEFAULT_TARIFFS.entries()) {
    await prisma.tariff.upsert({
      where: { id: t.id },
      create: {
        id: t.id, title: t.title, months: t.months, goalLimit: t.goalLimit, promoPrice: t.promoPrice, regularPrice: t.regularPrice,
        comparisonMonthPrice: t.comparisonMonthPrice, renewalPrice: t.renewalPrice, highlighted: t.highlighted, badge: t.badge, features: t.features, sort: i,
      },
      update: {},
    });
  }
  // Редизайн 24.10: старые формулировки («эксперты», «Хит продаж») заменяем на утверждённые; правки владельца не трогаем
  for (const t of DEFAULT_TARIFFS) {
    const row = await prisma.tariff.findUnique({ where: { id: t.id } });
    const old = row && ((row.features as string[]).some((f) => /эксперт/i.test(f)) || row.badge === 'Хит продаж');
    if (old) await prisma.tariff.update({ where: { id: t.id }, data: { features: t.features, badge: t.badge } });
  }
  // Редизайн 25.10: старый состав экрана ценности (без эмодзи) заменяем новым утверждённым
  const value = await prisma.setting.findUnique({ where: { key: 'value.items' } });
  if (value && Array.isArray(value.value) && (value.value as { emoji?: string }[]).every((i) => !i.emoji)) await prisma.setting.delete({ where: { key: 'value.items' } });
  // Разовый сброс таймеров скидки (OFFER_RESET=<метка>): удаляет неиспользованные окна цены, один раз на метку
  const reset = process.env.OFFER_RESET;
  if (reset) {
    const key = `maintenance.offerReset:${reset}`.slice(0, 120);
    if (!(await prisma.setting.findUnique({ where: { key } }))) {
      const r = await prisma.priceOffer.deleteMany({ where: { consumedAt: null } });
      await prisma.setting.create({ data: { key, value: { at: new Date().toISOString(), removed: r.count } } });
      console.log(`[seed] таймеры скидки сброшены: ${r.count}`);
    }
  }
  await applyProdamusSubscriptionIds();
  await seedTemplates();
  const upsells = [
    { code: 'blog_vip', title: 'Блог VIP', price: 15000, description: 'Личный разбор ваших роликов экспертом. Объём и сроки разбора уточняются до оплаты.', disclaimer: 'Без гарантий роста подписчиков и дохода.' },
    { code: 'personal', title: 'Персональное ведение', price: 120000, description: 'Индивидуальная работа с куратором в течение месяца.', disclaimer: 'Мы не гарантируем рост подписчиков или дохода.' },
    { code: 'partner', title: 'Партнёрское обучение', price: 10000, description: 'Обучение продвижению продукта клуба.', disclaimer: 'Без обещаний заработка.' },
  ];
  for (const [i, u] of upsells.entries()) await prisma.upsell.upsert({ where: { code: u.code }, create: { ...u, sort: i, active: false }, update: {} });
  if (config.ADMIN_BOOTSTRAP_LOGIN && config.ADMIN_BOOTSTRAP_PASSWORD) {
    const exists = await prisma.adminUser.findUnique({ where: { login: config.ADMIN_BOOTSTRAP_LOGIN } });
    if (!exists) await prisma.adminUser.create({ data: { login: config.ADMIN_BOOTSTRAP_LOGIN, passwordHash: await hashPassword(config.ADMIN_BOOTSTRAP_PASSWORD), role: 'owner' } });
    // Аварийный сброс: ADMIN_BOOTSTRAP_RESET=true задаёт пароль из переменной и сбрасывает 2FA (после входа переменную убрать)
    else if (process.env.ADMIN_BOOTSTRAP_RESET === 'true') {
      await prisma.adminUser.update({ where: { id: exists.id }, data: { passwordHash: await hashPassword(config.ADMIN_BOOTSTRAP_PASSWORD), totpEnabled: false, totpSecret: null, active: true } });
      console.log(`[seed] admin ${config.ADMIN_BOOTSTRAP_LOGIN}: пароль и 2FA сброшены`);
    }
  }
}

if (process.argv[1]?.endsWith('seed.ts')) {
  seed().then(() => {
    console.log('seed ok');
    process.exit(0);
  });
}

/**
 * ID подписок Prodamus из переменной PRODAMUS_SUBSCRIPTIONS
 * («m1:promo:3113454,m1:regular:3113523,…»). Заполняет только пустые поля — правки из админки не затираются.
 */
async function applyProdamusSubscriptionIds() {
  const raw = process.env.PRODAMUS_SUBSCRIPTIONS ?? '';
  for (const part of raw.split(',').map((x) => x.trim()).filter(Boolean)) {
    const [tariffId, variant, id] = part.split(':');
    if (!['m1', 'm3', 'm6'].includes(tariffId) || !/^\d+$/.test(id ?? '')) continue;
    const field = variant === 'regular' ? 'prodamusSubscriptionRegular' : 'prodamusSubscriptionPromo';
    await prisma.tariff.updateMany({ where: { id: tariffId, [field]: null }, data: { [field]: Number(id) } });
  }
}
