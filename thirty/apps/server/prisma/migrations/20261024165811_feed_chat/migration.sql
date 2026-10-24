-- AlterTable
ALTER TABLE "DailyReport" ADD COLUMN     "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "LeaderboardEntry" ADD COLUMN     "reportDays" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "FeedMessage" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "text" TEXT,
    "reportId" TEXT,
    "replyToId" TEXT,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FeedMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FeedMessage_reportId_key" ON "FeedMessage"("reportId");

-- CreateIndex
CREATE INDEX "FeedMessage_flowId_createdAt_idx" ON "FeedMessage"("flowId", "createdAt");

-- AddForeignKey
ALTER TABLE "FeedMessage" ADD CONSTRAINT "FeedMessage_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedMessage" ADD CONSTRAINT "FeedMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FeedMessage" ADD CONSTRAINT "FeedMessage_replyToId_fkey" FOREIGN KEY ("replyToId") REFERENCES "FeedMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
