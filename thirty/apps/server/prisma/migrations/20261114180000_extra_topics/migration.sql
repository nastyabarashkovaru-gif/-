-- Тематические чаты, открытые вручную из админки
ALTER TABLE "User" ADD COLUMN "extraTopics" TEXT[] DEFAULT ARRAY[]::TEXT[];
