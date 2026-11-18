-- AlterTable
ALTER TABLE "Clip" ADD COLUMN     "edit" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "emphasis" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "hookOptions" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "montage" JSONB,
ADD COLUMN     "titleOptions" TEXT[] DEFAULT ARRAY[]::TEXT[];
