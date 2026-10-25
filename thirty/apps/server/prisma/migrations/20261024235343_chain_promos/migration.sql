-- AlterTable
ALTER TABLE "BotMessageTemplate" ADD COLUMN     "imageUrl" TEXT;

-- AlterTable
ALTER TABLE "PriceOffer" ADD COLUMN     "promoId" TEXT;

-- CreateTable
CREATE TABLE "Promo" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'public',
    "window" TEXT NOT NULL DEFAULT 'dates',
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "daysBefore" INTEGER NOT NULL DEFAULT 1,
    "daysAfter" INTEGER NOT NULL DEFAULT 0,
    "userId" BIGINT,
    "maxUses" INTEGER,
    "uses" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "promoId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "appliedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paymentId" TEXT,
    "paidAt" TIMESTAMP(3),

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StoryRequest" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "instagram" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "reason" TEXT,
    "promoId" TEXT,
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoryRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Promo_code_key" ON "Promo"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_paymentId_key" ON "PromoRedemption"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_promoId_userId_key" ON "PromoRedemption"("promoId", "userId");

-- CreateIndex
CREATE INDEX "StoryRequest_status_createdAt_idx" ON "StoryRequest"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoId_fkey" FOREIGN KEY ("promoId") REFERENCES "Promo"("id") ON DELETE CASCADE ON UPDATE CASCADE;
