-- CreateEnum
CREATE TYPE "Visibility" AS ENUM ('public', 'members', 'hidden');

-- CreateEnum
CREATE TYPE "ConsentKind" AS ENUM ('personal_data', 'offer', 'public_reports', 'adult', 'sensitive_photos', 'marketing_messages', 'case_text', 'case_photo', 'case_name', 'autorenew');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('prestart', 'active', 'past_due', 'canceled_at_period_end', 'expired');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('initiated', 'pending', 'paid', 'failed', 'refunded', 'disputed');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('initial', 'renewal', 'debt', 'upsell');

-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('upcoming', 'active', 'finished');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('reserved', 'registered', 'active', 'finished', 'revoked');

-- CreateEnum
CREATE TYPE "GoalCategory" AS ENUM ('money', 'weightloss', 'blog', 'english', 'habits', 'selfdev');

-- CreateEnum
CREATE TYPE "Frequency" AS ENUM ('daily', 'every_n_days', 'n_per_week');

-- CreateEnum
CREATE TYPE "EvidenceType" AS ENUM ('checkbox', 'photo', 'screenshot', 'checkbox_photo', 'link');

-- CreateEnum
CREATE TYPE "OccurrenceStatus" AS ENUM ('pending', 'done', 'missed');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('accepted', 'rejected');

-- CreateEnum
CREATE TYPE "PrizeStatus" AS ENUM ('awaiting_review', 'approved', 'rejected', 'appealed');

-- CreateEnum
CREATE TYPE "AdminRole" AS ENUM ('owner', 'admin', 'moderator', 'expert', 'support', 'analyst');

-- CreateTable
CREATE TABLE "User" (
    "id" BIGINT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "username" TEXT,
    "photoUrl" TEXT,
    "displayName" TEXT,
    "city" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "interests" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "visibility" "Visibility" NOT NULL DEFAULT 'public',
    "isAdult" BOOLEAN NOT NULL DEFAULT false,
    "allowsWrite" BOOLEAN NOT NULL DEFAULT false,
    "botBlocked" BOOLEAN NOT NULL DEFAULT false,
    "marketingOptIn" BOOLEAN NOT NULL DEFAULT false,
    "lastScreen" TEXT,
    "onboardingStage" TEXT NOT NULL DEFAULT 'new',
    "sixMonthBadge" BOOLEAN NOT NULL DEFAULT false,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "kind" "ConsentKind" NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL,
    "context" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tariff" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "months" INTEGER NOT NULL,
    "goalLimit" INTEGER,
    "promoPrice" INTEGER NOT NULL,
    "regularPrice" INTEGER NOT NULL,
    "comparisonMonthPrice" INTEGER NOT NULL DEFAULT 2990,
    "renewalPrice" INTEGER NOT NULL,
    "prodamusSubscriptionPromo" INTEGER,
    "prodamusSubscriptionRegular" INTEGER,
    "highlighted" BOOLEAN NOT NULL DEFAULT false,
    "badge" TEXT,
    "features" JSONB NOT NULL DEFAULT '[]',
    "sort" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Tariff_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PriceOffer" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'intro',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "PriceOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subscription" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "tariffId" TEXT NOT NULL,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'prestart',
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "renewalPrice" INTEGER NOT NULL,
    "priceVariant" TEXT NOT NULL DEFAULT 'promo',
    "paidFromFlow" DATE NOT NULL,
    "paidThroughFlow" DATE NOT NULL,
    "nextChargeDate" DATE,
    "providerSubscriptionId" TEXT,
    "providerLocked" BOOLEAN NOT NULL DEFAULT false,
    "canceledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "subscriptionId" TEXT,
    "kind" "PaymentKind" NOT NULL,
    "tariffId" TEXT,
    "upsellCode" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'initiated',
    "provider" TEXT NOT NULL DEFAULT 'prodamus',
    "providerOrderId" TEXT,
    "paymentUrl" TEXT,
    "coversFromFlow" DATE,
    "months" INTEGER,
    "idempotencyKey" TEXT NOT NULL,
    "failureReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "paymentId" TEXT,
    "bodyHash" TEXT NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "status" TEXT,
    "payload" JSONB NOT NULL,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BillingSchedule" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "dueDate" DATE NOT NULL,
    "coversFromFlow" DATE NOT NULL,
    "months" INTEGER NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "providerSyncedAt" TIMESTAMP(3),
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingSchedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "timezone" TEXT NOT NULL DEFAULT 'Europe/Moscow',
    "title" TEXT NOT NULL,
    "status" "FlowStatus" NOT NULL DEFAULT 'upcoming',
    "prizePoolOverride" INTEGER,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowMembership" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "flowId" TEXT NOT NULL,
    "subscriptionId" TEXT,
    "tariffId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'reserved',
    "goalsLockedAt" TIMESTAMP(3),
    "registeredAt" TIMESTAMP(3),
    "finalSubmittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Goal" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "category" "GoalCategory" NOT NULL,
    "title" TEXT NOT NULL,
    "successCriterion" TEXT NOT NULL,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "finalAchieved" BOOLEAN,
    "finalComment" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Goal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Task" (
    "id" TEXT NOT NULL,
    "goalId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "frequency" "Frequency" NOT NULL,
    "n" INTEGER NOT NULL DEFAULT 1,
    "evidence" "EvidenceType" NOT NULL DEFAULT 'checkbox',
    "criteria" TEXT,
    "selfReported" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaskOccurrence" (
    "id" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "windowStart" DATE NOT NULL,
    "windowEnd" DATE NOT NULL,
    "slot" INTEGER NOT NULL DEFAULT 0,
    "status" "OccurrenceStatus" NOT NULL DEFAULT 'pending',
    "doneAt" TIMESTAMP(3),

    CONSTRAINT "TaskOccurrence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DailyReport" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "text" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'accepted',
    "rejectReason" TEXT,
    "late" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DailyReport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportItem" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "occurrenceId" TEXT NOT NULL,
    "done" BOOLEAN NOT NULL,
    "note" TEXT,
    "link" TEXT,
    "flagged" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ReportItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportEvidence" (
    "id" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "mediaId" TEXT NOT NULL,

    CONSTRAINT "ReportEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportComment" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "text" TEXT NOT NULL,
    "hidden" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportReaction" (
    "reportId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "emoji" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportReaction_pkey" PRIMARY KEY ("reportId","userId","emoji")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "id" TEXT NOT NULL,
    "reporterId" BIGINT NOT NULL,
    "reportId" TEXT,
    "targetUserId" BIGINT,
    "kind" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReportAppeal" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decidedBy" TEXT,
    "decision" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReportAppeal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MediaFile" (
    "id" TEXT NOT NULL,
    "ownerId" BIGINT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "sensitive" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MediaFile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BeforeAfter" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "phase" TEXT NOT NULL,
    "text" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BeforeAfter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaderboardEntry" (
    "flowId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "ratio" DOUBLE PRECISION NOT NULL,
    "completed" INTEGER NOT NULL,
    "scheduled" INTEGER NOT NULL,
    "successfulDays" INTEGER NOT NULL,
    "missedReports" INTEGER NOT NULL,
    "longestStreak" INTEGER NOT NULL,
    "currentStreak" INTEGER NOT NULL,
    "perfectSoFar" BOOLEAN NOT NULL,
    "rank" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaderboardEntry_pkey" PRIMARY KEY ("flowId","userId")
);

-- CreateTable
CREATE TABLE "PrizeCandidate" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "status" "PrizeStatus" NOT NULL DEFAULT 'awaiting_review',
    "place" INTEGER,
    "tiebreak" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrizeCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PrizeReview" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PrizeReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuddyInvite" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "fromUserId" BIGINT NOT NULL,
    "toUserId" BIGINT,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuddyInvite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuddyPair" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "userA" BIGINT NOT NULL,
    "userB" BIGINT NOT NULL,
    "source" TEXT NOT NULL,
    "matchReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "dissolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuddyPair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BuddyAssignment" (
    "flowId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "pairId" TEXT NOT NULL,

    CONSTRAINT "BuddyAssignment_pkey" PRIMARY KEY ("flowId","userId")
);

-- CreateTable
CREATE TABLE "BuddyReplacement" (
    "id" TEXT NOT NULL,
    "pairId" TEXT NOT NULL,
    "requesterId" BIGINT NOT NULL,
    "reason" TEXT NOT NULL,
    "comment" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "decidedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BuddyReplacement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TelegramChat" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "topic" TEXT,
    "flowId" TEXT,
    "telegramChatId" BIGINT,
    "title" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TelegramChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChatMembership" (
    "chatId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "inviteLink" TEXT,
    "status" TEXT NOT NULL DEFAULT 'invited',
    "joinedAt" TIMESTAMP(3),
    "removedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChatMembership_pkey" PRIMARY KEY ("chatId","userId")
);

-- CreateTable
CREATE TABLE "Expert" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "bio" TEXT,
    "photoUrl" TEXT,
    "adminUserId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Expert_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "expertId" TEXT,
    "direction" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 60,
    "joinUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "nextStep" TEXT,
    "expertReport" TEXT,
    "stats" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "meetingId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "joinClickedAt" TIMESTAMP(3),
    "attended" BOOLEAN,
    "remindedAt" TIMESTAMP(3),

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("meetingId","userId")
);

-- CreateTable
CREATE TABLE "Review" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "flowId" TEXT,
    "trigger" TEXT NOT NULL,
    "meetingId" TEXT,
    "rating" INTEGER,
    "emotions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "changes" TEXT,
    "result" TEXT,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "mediaIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowText" BOOLEAN NOT NULL DEFAULT false,
    "allowPhoto" BOOLEAN NOT NULL DEFAULT false,
    "allowName" BOOLEAN NOT NULL DEFAULT false,
    "consentRevokedAt" TIMESTAMP(3),
    "featured" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ShareCard" (
    "id" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "week" INTEGER NOT NULL,
    "stats" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReferralLink" (
    "code" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferralLink_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ReferralVisit" (
    "code" TEXT NOT NULL,
    "visitorId" BIGINT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" BIGSERIAL NOT NULL,
    "eventId" TEXT NOT NULL,
    "userId" BIGINT,
    "sessionId" TEXT NOT NULL,
    "flowId" TEXT,
    "screenId" TEXT,
    "eventName" TEXT NOT NULL,
    "ts" TIMESTAMP(3) NOT NULL,
    "tariffId" TEXT,
    "variant" TEXT,
    "device" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Experiment" (
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "variants" JSONB NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Experiment_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ExperimentAssignment" (
    "userId" BIGINT NOT NULL,
    "experimentKey" TEXT NOT NULL,
    "variant" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExperimentAssignment_pkey" PRIMARY KEY ("userId","experimentKey")
);

-- CreateTable
CREATE TABLE "BotMessageTemplate" (
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "buttons" JSONB NOT NULL DEFAULT '[]',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "isMarketing" BOOLEAN NOT NULL DEFAULT false,
    "delayMinutes" INTEGER NOT NULL DEFAULT 0,
    "capHours" INTEGER NOT NULL DEFAULT 24,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BotMessageTemplate_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "BotMessageLog" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "clickedAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),

    CONSTRAINT "BotMessageLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminUser" (
    "id" TEXT NOT NULL,
    "login" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "AdminRole" NOT NULL,
    "totpSecret" TEXT,
    "totpEnabled" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "adminId" TEXT,
    "action" TEXT NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Upsell" (
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "disclaimer" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sort" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Upsell_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "UpsellRequest" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "code" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'new',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UpsellRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JobRun" (
    "key" TEXT NOT NULL,
    "ranAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "result" JSONB,

    CONSTRAINT "JobRun_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "User_city_idx" ON "User"("city");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "Consent_userId_kind_idx" ON "Consent"("userId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PriceOffer_userId_kind_key" ON "PriceOffer"("userId", "kind");

-- CreateIndex
CREATE INDEX "Subscription_userId_idx" ON "Subscription"("userId");

-- CreateIndex
CREATE INDEX "Subscription_status_nextChargeDate_idx" ON "Subscription"("status", "nextChargeDate");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_providerOrderId_key" ON "Payment"("providerOrderId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_userId_createdAt_idx" ON "Payment"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Payment_status_createdAt_idx" ON "Payment"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentEvent_bodyHash_key" ON "PaymentEvent"("bodyHash");

-- CreateIndex
CREATE UNIQUE INDEX "BillingSchedule_subscriptionId_coversFromFlow_key" ON "BillingSchedule"("subscriptionId", "coversFromFlow");

-- CreateIndex
CREATE UNIQUE INDEX "Flow_startsOn_key" ON "Flow"("startsOn");

-- CreateIndex
CREATE INDEX "FlowMembership_flowId_status_idx" ON "FlowMembership"("flowId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "FlowMembership_userId_flowId_key" ON "FlowMembership"("userId", "flowId");

-- CreateIndex
CREATE INDEX "TaskOccurrence_membershipId_windowEnd_idx" ON "TaskOccurrence"("membershipId", "windowEnd");

-- CreateIndex
CREATE UNIQUE INDEX "TaskOccurrence_taskId_windowStart_slot_key" ON "TaskOccurrence"("taskId", "windowStart", "slot");

-- CreateIndex
CREATE INDEX "DailyReport_createdAt_idx" ON "DailyReport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReport_membershipId_date_key" ON "DailyReport"("membershipId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ReportItem_reportId_occurrenceId_key" ON "ReportItem"("reportId", "occurrenceId");

-- CreateIndex
CREATE INDEX "ReportComment_reportId_createdAt_idx" ON "ReportComment"("reportId", "createdAt");

-- CreateIndex
CREATE INDEX "Complaint_status_createdAt_idx" ON "Complaint"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MediaFile_storageKey_key" ON "MediaFile"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "BeforeAfter_membershipId_phase_key" ON "BeforeAfter"("membershipId", "phase");

-- CreateIndex
CREATE INDEX "LeaderboardEntry_flowId_rank_idx" ON "LeaderboardEntry"("flowId", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "PrizeCandidate_flowId_userId_key" ON "PrizeCandidate"("flowId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "BuddyInvite_token_key" ON "BuddyInvite"("token");

-- CreateIndex
CREATE INDEX "BuddyInvite_flowId_toUserId_idx" ON "BuddyInvite"("flowId", "toUserId");

-- CreateIndex
CREATE INDEX "BuddyPair_flowId_status_idx" ON "BuddyPair"("flowId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramChat_telegramChatId_key" ON "TelegramChat"("telegramChatId");

-- CreateIndex
CREATE UNIQUE INDEX "TelegramChat_kind_topic_flowId_key" ON "TelegramChat"("kind", "topic", "flowId");

-- CreateIndex
CREATE UNIQUE INDEX "Expert_adminUserId_key" ON "Expert"("adminUserId");

-- CreateIndex
CREATE INDEX "Meeting_startsAt_idx" ON "Meeting"("startsAt");

-- CreateIndex
CREATE INDEX "Review_trigger_createdAt_idx" ON "Review"("trigger", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ShareCard_membershipId_week_key" ON "ShareCard"("membershipId", "week");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralLink_userId_key" ON "ReferralLink"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ReferralVisit_visitorId_key" ON "ReferralVisit"("visitorId");

-- CreateIndex
CREATE UNIQUE INDEX "AnalyticsEvent_eventId_key" ON "AnalyticsEvent"("eventId");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_eventName_ts_idx" ON "AnalyticsEvent"("eventName", "ts");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_userId_ts_idx" ON "AnalyticsEvent"("userId", "ts");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_screenId_ts_idx" ON "AnalyticsEvent"("screenId", "ts");

-- CreateIndex
CREATE UNIQUE INDEX "BotMessageLog_dedupeKey_key" ON "BotMessageLog"("dedupeKey");

-- CreateIndex
CREATE INDEX "BotMessageLog_userId_sentAt_idx" ON "BotMessageLog"("userId", "sentAt");

-- CreateIndex
CREATE INDEX "BotMessageLog_templateKey_sentAt_idx" ON "BotMessageLog"("templateKey", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "AdminUser_login_key" ON "AdminUser"("login");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_idx" ON "AuditLog"("entity", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PriceOffer" ADD CONSTRAINT "PriceOffer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Subscription" ADD CONSTRAINT "Subscription_tariffId_fkey" FOREIGN KEY ("tariffId") REFERENCES "Tariff"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentEvent" ADD CONSTRAINT "PaymentEvent_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BillingSchedule" ADD CONSTRAINT "BillingSchedule_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowMembership" ADD CONSTRAINT "FlowMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowMembership" ADD CONSTRAINT "FlowMembership_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowMembership" ADD CONSTRAINT "FlowMembership_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Goal" ADD CONSTRAINT "Goal_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "FlowMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaskOccurrence" ADD CONSTRAINT "TaskOccurrence_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "FlowMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DailyReport" ADD CONSTRAINT "DailyReport_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "FlowMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItem" ADD CONSTRAINT "ReportItem_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportItem" ADD CONSTRAINT "ReportItem_occurrenceId_fkey" FOREIGN KEY ("occurrenceId") REFERENCES "TaskOccurrence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportEvidence" ADD CONSTRAINT "ReportEvidence_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ReportItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportEvidence" ADD CONSTRAINT "ReportEvidence_mediaId_fkey" FOREIGN KEY ("mediaId") REFERENCES "MediaFile"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportComment" ADD CONSTRAINT "ReportComment_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportComment" ADD CONSTRAINT "ReportComment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportReaction" ADD CONSTRAINT "ReportReaction_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportReaction" ADD CONSTRAINT "ReportReaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Complaint" ADD CONSTRAINT "Complaint_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReportAppeal" ADD CONSTRAINT "ReportAppeal_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "DailyReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MediaFile" ADD CONSTRAINT "MediaFile_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BeforeAfter" ADD CONSTRAINT "BeforeAfter_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "FlowMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaderboardEntry" ADD CONSTRAINT "LeaderboardEntry_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeCandidate" ADD CONSTRAINT "PrizeCandidate_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PrizeReview" ADD CONSTRAINT "PrizeReview_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "PrizeCandidate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuddyPair" ADD CONSTRAINT "BuddyPair_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BuddyAssignment" ADD CONSTRAINT "BuddyAssignment_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "BuddyPair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TelegramChat" ADD CONSTRAINT "TelegramChat_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatMembership" ADD CONSTRAINT "ChatMembership_chatId_fkey" FOREIGN KEY ("chatId") REFERENCES "TelegramChat"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_expertId_fkey" FOREIGN KEY ("expertId") REFERENCES "Expert"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShareCard" ADD CONSTRAINT "ShareCard_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "FlowMembership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralLink" ADD CONSTRAINT "ReferralLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReferralVisit" ADD CONSTRAINT "ReferralVisit_code_fkey" FOREIGN KEY ("code") REFERENCES "ReferralLink"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AnalyticsEvent" ADD CONSTRAINT "AnalyticsEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExperimentAssignment" ADD CONSTRAINT "ExperimentAssignment_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotMessageLog" ADD CONSTRAINT "BotMessageLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- У пользователя не больше одной живой подписки (защита от двойной покупки)
CREATE UNIQUE INDEX "Subscription_one_live_per_user" ON "Subscription"("userId")
  WHERE "status" IN ('prestart', 'active', 'past_due', 'canceled_at_period_end');

-- Не больше одного успешного первичного платежа на подписку
CREATE UNIQUE INDEX "Payment_one_paid_initial_per_subscription" ON "Payment"("subscriptionId")
  WHERE "kind" = 'initial' AND "status" = 'paid';

-- Пара бадди не может состоять из одного человека
ALTER TABLE "BuddyPair" ADD CONSTRAINT "BuddyPair_distinct_users" CHECK ("userA" <> "userB");

-- Суммы неотрицательные
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amount" >= 0);
