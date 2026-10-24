-- AlterEnum
ALTER TYPE "Frequency" ADD VALUE 'once';

-- AlterEnum
ALTER TYPE "GoalCategory" ADD VALUE 'other';

-- AlterTable
ALTER TABLE "Goal" ADD COLUMN     "confirmMethod" TEXT,
ADD COLUMN     "confirmNote" TEXT,
ADD COLUMN     "pointA" TEXT,
ADD COLUMN     "pointB" TEXT;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "dueDate" DATE;
