/*
  Warnings:

  - You are about to drop the column `prodamusSubscriptionPromo` on the `Tariff` table. All the data in the column will be lost.
  - You are about to drop the column `prodamusSubscriptionRegular` on the `Tariff` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Payment" ALTER COLUMN "provider" SET DEFAULT 'cloudpayments';

-- AlterTable
ALTER TABLE "Tariff" DROP COLUMN "prodamusSubscriptionPromo",
DROP COLUMN "prodamusSubscriptionRegular";
