CREATE TYPE "PaymentAccessDeliveryStatus" AS ENUM ('pending', 'sending', 'sent', 'joined', 'failed', 'canceled');

CREATE TABLE "PaymentAccessDelivery" (
    "paymentId" TEXT NOT NULL,
    "status" "PaymentAccessDeliveryStatus" NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastError" TEXT,
    CONSTRAINT "PaymentAccessDelivery_pkey" PRIMARY KEY ("paymentId")
);

CREATE INDEX "PaymentAccessDelivery_status_nextAttemptAt_idx"
    ON "PaymentAccessDelivery"("status", "nextAttemptAt");

ALTER TABLE "PaymentAccessDelivery" ADD CONSTRAINT "PaymentAccessDelivery_paymentId_fkey"
    FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
