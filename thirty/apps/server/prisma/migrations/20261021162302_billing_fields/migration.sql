-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "needsRefund" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "priceVariant" TEXT;

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "providerCustomer" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "providerDeactivatedAt" TIMESTAMP(3);
