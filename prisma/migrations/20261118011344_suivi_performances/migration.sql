-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "commentCount" INTEGER,
ADD COLUMN     "likeCount" INTEGER,
ADD COLUMN     "shareCount" INTEGER,
ADD COLUMN     "statsAt" TIMESTAMP(3),
ADD COLUMN     "statsError" TEXT,
ADD COLUMN     "statsNextAt" TIMESTAMP(3),
ADD COLUMN     "statsStatus" TEXT,
ADD COLUMN     "viewCount" INTEGER;

-- CreateTable
CREATE TABLE "PublicationStat" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "views" INTEGER NOT NULL,
    "likes" INTEGER,
    "comments" INTEGER,
    "shares" INTEGER,

    CONSTRAINT "PublicationStat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PublicationStat_publicationId_at_idx" ON "PublicationStat"("publicationId", "at");

-- CreateIndex
CREATE INDEX "PublicationStat_userId_at_idx" ON "PublicationStat"("userId", "at");

-- CreateIndex
CREATE INDEX "Publication_status_statsNextAt_idx" ON "Publication"("status", "statsNextAt");

-- AddForeignKey
ALTER TABLE "PublicationStat" ADD CONSTRAINT "PublicationStat_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
