-- Дожимная цепочка от последнего /start (14.11): у кого уже был /start — от первого приветствия, как раньше
ALTER TABLE "User" ADD COLUMN "chainStartedAt" TIMESTAMP(3);
UPDATE "User" u SET "chainStartedAt" = l.m FROM (SELECT "userId", MIN("sentAt") AS m FROM "BotMessageLog" WHERE "templateKey" = 'welcome' GROUP BY "userId") l WHERE l."userId" = u."id";
