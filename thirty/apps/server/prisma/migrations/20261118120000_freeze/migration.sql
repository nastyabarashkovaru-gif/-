-- Заморозка личного челленджа: прогресс сохраняется, дни паузы не считаются
ALTER TABLE "FlowMembership" ADD COLUMN "pausedFrom" DATE, ADD COLUMN "pausedUntil" DATE, ADD COLUMN "pausedDays" INTEGER NOT NULL DEFAULT 0, ADD COLUMN "pauses" JSONB NOT NULL DEFAULT '[]';
