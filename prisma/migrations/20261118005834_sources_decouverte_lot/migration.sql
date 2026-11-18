-- AlterEnum
ALTER TYPE "SourcePlatform" ADD VALUE 'TIKTOK';

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "checkedAt" TIMESTAMP(3),
ADD COLUMN     "dailyCap" INTEGER,
ADD COLUMN     "defaultPrivacy" TEXT;

-- AlterTable
ALTER TABLE "Streamer" ADD COLUMN     "autoFollowed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "autoViewers" INTEGER;

-- CreateTable
CREATE TABLE "Discovery" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "game" TEXT NOT NULL DEFAULT 'Grand Theft Auto VI',
    "language" TEXT NOT NULL DEFAULT 'fr',
    "autoFollow" BOOLEAN NOT NULL DEFAULT false,
    "autoCount" INTEGER NOT NULL DEFAULT 3,
    "excluded" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "results" JSONB NOT NULL DEFAULT '[]',
    "fetchedAt" TIMESTAMP(3),
    "error" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Discovery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Discovery_userId_key" ON "Discovery"("userId");

-- AddForeignKey
ALTER TABLE "Discovery" ADD CONSTRAINT "Discovery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
