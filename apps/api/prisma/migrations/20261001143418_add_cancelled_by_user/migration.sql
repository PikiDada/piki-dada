-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "cancelledByUserId" TEXT;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "cancelledByUserId" TEXT;

-- CreateIndex
CREATE INDEX "Trip_cancelledByUserId_cancelledAt_idx" ON "Trip"("cancelledByUserId", "cancelledAt");

-- CreateIndex
CREATE INDEX "Delivery_cancelledByUserId_cancelledAt_idx" ON "Delivery"("cancelledByUserId", "cancelledAt");

