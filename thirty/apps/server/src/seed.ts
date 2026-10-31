import { DEFAULT_TARIFFS } from '@thirty/domain';
import { prisma } from './db';
import { config } from './config';
import { seedTemplates } from './modules/bot';
import { seedPromos } from './modules/promos';
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
  // Решение владельца: после таймера 2 990 / 8 970 / 17 940 ₽. Старые черновые цены (1 490 / 3 490 / 5 490) исправляем
  const OLD_REGULAR: Record<string, number> = { m1: 1490, m3: 3490, m6: 5490 };
  for (const t of DEFAULT_TARIFFS) {
    const row = await prisma.tariff.findUnique({ where: { id: t.id } });
    if (row && row.regularPrice === OLD_REGULAR[t.id]) {
      await prisma.tariff.update({ where: { id: t.id }, data: { regularPrice: t.regularPrice } });
      console.log(`[seed] ${t.id}: цена после таймера ${row.regularPrice} → ${t.regularPrice}`);
    }
  }
  // 31.10: тариф на 3 месяца — 2 990 ₽ вместо 2 490 ₽ (только если цену не меняли в админке)
  if (!(await prisma.setting.findUnique({ where: { key: 'maintenance.m3priceV1' } }))) {
    await prisma.tariff.updateMany({ where: { id: 'm3', promoPrice: 2490 }, data: { promoPrice: 2990, renewalPrice: 2990 } });
    await prisma.setting.create({ data: { key: 'maintenance.m3priceV1', value: { at: new Date().toISOString() } } });
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
  // 25.10: новый состав «Что входит в клуб» от владельца (без цен, с пояснениями) — один раз заменяет сохранённый
  if (!(await prisma.setting.findUnique({ where: { key: 'maintenance.valueV3' } }))) {
    await prisma.setting.deleteMany({ where: { key: 'value.items' } });
    await prisma.setting.create({ data: { key: 'maintenance.valueV3', value: { at: new Date().toISOString() } } });
  }
  // 25.10: оплата после отмены не восстанавливала отменённое участие в потоке — чиним такие случаи один раз
  if (!(await prisma.setting.findUnique({ where: { key: 'maintenance.reviveV1' } }))) {
    const { reviveMembership } = await import('./modules/billing');
    const revoked = await prisma.flowMembership.findMany({ where: { status: 'revoked' }, include: { flow: true } });
    let fixed = 0;
    for (const m of revoked) {
      const sub = await prisma.subscription.findFirst({
        where: { userId: m.userId, status: { in: ['prestart', 'active', 'past_due', 'canceled_at_period_end'] }, paidFromFlow: { lte: m.flow.startsOn }, paidThroughFlow: { gte: m.flow.startsOn } },
      });
      if (!sub) continue;
      await prisma.$transaction((tx) => reviveMembership(tx, m.id, sub.id, sub.tariffId));
      fixed++;
    }
    await prisma.setting.create({ data: { key: 'maintenance.reviveV1', value: { at: new Date().toISOString(), fixed } } });
    if (fixed) console.log(`[seed] восстановлено участий в потоках: ${fixed}`);
  }
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
  await seedTemplates();
  await seedPromos();
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

