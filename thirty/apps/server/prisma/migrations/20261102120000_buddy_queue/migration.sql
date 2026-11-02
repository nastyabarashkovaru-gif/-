-- Бадди: способ поиска (автоподбор / сама) и очередь автоподбора
ALTER TABLE "FlowMembership" ADD COLUMN "buddyMode" TEXT;
ALTER TABLE "FlowMembership" ADD COLUMN "buddyQueuedAt" TIMESTAMP(3);
CREATE INDEX "FlowMembership_buddyMode_buddyQueuedAt_idx" ON "FlowMembership"("buddyMode", "buddyQueuedAt");
