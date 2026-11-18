-- CreateEnum
CREATE TYPE "CompilationStatus" AS ENUM ('DRAFT', 'RENDERING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "Publication" ADD COLUMN     "compilationId" TEXT,
ALTER COLUMN "clipId" DROP NOT NULL;

-- CreateTable
CREATE TABLE "Compilation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "CompilationStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "thumbText" TEXT NOT NULL DEFAULT '',
    "metaPending" BOOLEAN NOT NULL DEFAULT true,
    "countdown" BOOLEAN NOT NULL DEFAULT true,
    "captions" BOOLEAN NOT NULL DEFAULT true,
    "intro" BOOLEAN NOT NULL DEFAULT true,
    "origin" JSONB NOT NULL DEFAULT '{}',
    "montage" JSONB,
    "chapters" JSONB,
    "hasFinal" BOOLEAN NOT NULL DEFAULT false,
    "hasThumb" BOOLEAN NOT NULL DEFAULT false,
    "progress" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "renderedAt" TIMESTAMP(3),
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Compilation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompilationItem" (
    "id" TEXT NOT NULL,
    "compilationId" TEXT NOT NULL,
    "clipId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "label" TEXT NOT NULL DEFAULT '',

    CONSTRAINT "CompilationItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Compilation_userId_createdAt_idx" ON "Compilation"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CompilationItem_clipId_idx" ON "CompilationItem"("clipId");

-- CreateIndex
CREATE UNIQUE INDEX "CompilationItem_compilationId_clipId_key" ON "CompilationItem"("compilationId", "clipId");

-- CreateIndex
CREATE INDEX "Publication_compilationId_idx" ON "Publication"("compilationId");

-- AddForeignKey
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_compilationId_fkey" FOREIGN KEY ("compilationId") REFERENCES "Compilation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Compilation" ADD CONSTRAINT "Compilation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompilationItem" ADD CONSTRAINT "CompilationItem_compilationId_fkey" FOREIGN KEY ("compilationId") REFERENCES "Compilation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompilationItem" ADD CONSTRAINT "CompilationItem_clipId_fkey" FOREIGN KEY ("clipId") REFERENCES "Clip"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Une publication porte exactement un contenu : un clip OU une compilation.
ALTER TABLE "Publication" ADD CONSTRAINT "Publication_contenu_unique_check"
  CHECK (("clipId" IS NOT NULL AND "compilationId" IS NULL) OR ("clipId" IS NULL AND "compilationId" IS NOT NULL));
