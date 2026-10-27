-- AlterTable
ALTER TABLE "FlowMembership" ADD COLUMN     "expectation" TEXT,
ADD COLUMN     "finalResult" TEXT;

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "finalOutcome" TEXT;

-- AlterTable
ALTER TABLE "PriceOffer" ADD COLUMN     "amount" INTEGER,
ADD COLUMN     "tariffId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "trackerPromptAt" TIMESTAMP(3),
ADD COLUMN     "trackersGrantedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "FlowFeedback" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "flowId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "helped" TEXT[],
    "helpedOther" TEXT,
    "hindered" TEXT[],
    "hinderedOther" TEXT,
    "benefit" TEXT NOT NULL,
    "change" TEXT NOT NULL,
    "needHelp" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackerReview" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "mediaId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "decidedBy" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackerReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FlowFeedback_membershipId_key" ON "FlowFeedback"("membershipId");

-- CreateIndex
CREATE INDEX "FlowFeedback_flowId_idx" ON "FlowFeedback"("flowId");

-- CreateIndex
CREATE INDEX "TrackerReview_userId_createdAt_idx" ON "TrackerReview"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "TrackerReview_status_createdAt_idx" ON "TrackerReview"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "FlowFeedback" ADD CONSTRAINT "FlowFeedback_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "FlowMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
