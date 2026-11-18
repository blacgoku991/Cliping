-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "publishKit" JSONB;

-- AlterTable
ALTER TABLE "SocialAccount" ADD COLUMN     "profileKit" JSONB;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "coach" JSONB NOT NULL DEFAULT '{}';
