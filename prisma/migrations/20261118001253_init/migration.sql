-- CreateEnum
CREATE TYPE "SourcePlatform" AS ENUM ('TWITCH', 'KICK', 'YOUTUBE', 'OTHER');

-- CreateEnum
CREATE TYPE "RecordingSource" AS ENUM ('LIVE', 'VOD');

-- CreateEnum
CREATE TYPE "RecordingStatus" AS ENUM ('PENDING', 'RECORDING', 'PROCESSING', 'DONE', 'FAILED');

-- CreateEnum
CREATE TYPE "ClipStatus" AS ENUM ('PROCESSING', 'READY', 'APPROVED', 'REJECTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ClipTemplate" AS ENUM ('BLUR', 'FULL', 'FACECAM');

-- CreateEnum
CREATE TYPE "SocialPlatform" AS ENUM ('YOUTUBE', 'TIKTOK');

-- CreateEnum
CREATE TYPE "PublicationStatus" AS ENUM ('QUEUED', 'UPLOADING', 'PROCESSING', 'PUBLISHED', 'FAILED', 'CANCELED');

-- CreateEnum
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "name" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Streamer" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "SourcePlatform" NOT NULL,
    "login" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "gameFilter" TEXT NOT NULL DEFAULT '',
    "quality" TEXT NOT NULL DEFAULT 'best',
    "facecam" JSONB,
    "isLive" BOOLEAN NOT NULL DEFAULT false,
    "liveTitle" TEXT,
    "liveCategory" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "lastLiveAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Streamer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Recording" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "streamerId" TEXT,
    "source" "RecordingSource" NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "status" "RecordingStatus" NOT NULL DEFAULT 'PENDING',
    "title" TEXT,
    "category" TEXT,
    "author" TEXT,
    "durationSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "options" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "Recording_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Clip" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recordingId" TEXT,
    "streamerId" TEXT,
    "status" "ClipStatus" NOT NULL DEFAULT 'PROCESSING',
    "template" "ClipTemplate" NOT NULL DEFAULT 'BLUR',
    "originSec" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "peakSec" DOUBLE PRECISION NOT NULL,
    "startSec" DOUBLE PRECISION NOT NULL,
    "endSec" DOUBLE PRECISION NOT NULL,
    "sourceDur" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    "signals" JSONB NOT NULL DEFAULT '{}',
    "title" TEXT NOT NULL DEFAULT '',
    "hook" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "hashtags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "transcript" JSONB,
    "captions" BOOLEAN NOT NULL DEFAULT true,
    "hasFinal" BOOLEAN NOT NULL DEFAULT false,
    "renderedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Clip_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SocialAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "platform" "SocialPlatform" NOT NULL,
    "externalId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "handle" TEXT,
    "avatarUrl" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "refreshTokenEnc" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" TEXT NOT NULL DEFAULT '',
    "valid" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SocialAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "status" "PublicationStatus" NOT NULL DEFAULT 'QUEUED',
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "privacy" TEXT NOT NULL DEFAULT 'public',
    "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMP(3),
    "externalId" TEXT,
    "externalUrl" TEXT,
    "note" TEXT,
    "uploadState" JSONB,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Job" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "lockedAt" TIMESTAMP(3),
    "lockedBy" TEXT,
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "Job_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeyValue" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeyValue_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Streamer_enabled_idx" ON "Streamer"("enabled");

-- CreateIndex
CREATE UNIQUE INDEX "Streamer_userId_platform_login_key" ON "Streamer"("userId", "platform", "login");

-- CreateIndex
CREATE INDEX "Recording_userId_startedAt_idx" ON "Recording"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "Recording_status_idx" ON "Recording"("status");

-- CreateIndex
CREATE INDEX "Clip_userId_status_createdAt_idx" ON "Clip"("userId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Clip_userId_createdAt_idx" ON "Clip"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SocialAccount_userId_platform_externalId_key" ON "SocialAccount"("userId", "platform", "externalId");

-- CreateIndex
CREATE INDEX "Publication_userId_createdAt_idx" ON "Publication"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Publication_clipId_idx" ON "Publication"("clipId");

-- CreateIndex
CREATE INDEX "Job_status_runAt_idx" ON "Job"("status", "runAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Streamer" ADD CONSTRAINT "Streamer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Recording" ADD CONSTRAINT "Recording_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_recordingId_fkey" FOREIGN KEY ("recordingId") REFERENCES "Recording"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Clip" ADD CONSTRAINT "Clip_streamerId_fkey" FOREIGN KEY ("streamerId") REFERENCES "Streamer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SocialAccount" ADD CONSTRAINT "SocialAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "SocialAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
