-- Местное время участницы: «сегодня», дедлайн отчёта и напоминания — по её часовому поясу, а не по Москве
ALTER TABLE "FlowMembership" ADD COLUMN "timezone" TEXT;
UPDATE "FlowMembership" m SET "timezone" = u."timezone" FROM "User" u WHERE u."id" = m."userId";
