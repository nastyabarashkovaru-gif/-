-- Личные даты старта: у каждого участия своя дата начала 30-дневного челленджа.
-- Уже существующим участиям — дата старта их потока (ноябрьские остаются с 1 ноября).
ALTER TABLE "FlowMembership" ADD COLUMN "startsOn" DATE;
UPDATE "FlowMembership" m SET "startsOn" = f."startsOn" FROM "Flow" f WHERE f."id" = m."flowId";
