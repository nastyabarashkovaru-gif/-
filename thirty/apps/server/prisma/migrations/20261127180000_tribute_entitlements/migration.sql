ALTER TABLE "Subscription" ADD COLUMN "tributeExpiresAt" TIMESTAMP(3);
CREATE INDEX "Subscription_tributeExpiresAt_idx" ON "Subscription"("tributeExpiresAt");

CREATE TABLE "TributeEntitlement" (
    "userId" BIGINT NOT NULL,
    "offerId" TEXT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "autoRenew" BOOLEAN NOT NULL,
    "pending" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "TributeEntitlement_pkey" PRIMARY KEY ("userId")
);

CREATE INDEX "TributeEntitlement_pending_expiresAt_idx" ON "TributeEntitlement"("pending", "expiresAt");
