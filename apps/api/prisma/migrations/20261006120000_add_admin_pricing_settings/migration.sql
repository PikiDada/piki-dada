-- CreateEnum
CREATE TYPE "UnvisitedStopsPolicy" AS ENUM ('REMOVE_FROM_FARE', 'CHARGE_QUOTED');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "freeWaitMinutes" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "waitingPerMinute" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "freeWaitMinutes" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "waitingPerMinute" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PricingRule" ADD COLUMN     "freeWaitMinutes" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "waitingPerMinute" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "DeliverySizeTierPricingRule" ADD COLUMN     "freeWaitMinutes" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "waitingPerMinute" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "PricingSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "fareRoundingUnit" INTEGER NOT NULL DEFAULT 500,
    "platformCommissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.15,
    "unvisitedStopsPolicy" "UnvisitedStopsPolicy" NOT NULL DEFAULT 'REMOVE_FROM_FARE',
    "roadDistanceFallbackFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.3,
    "averageSpeedKmh" DOUBLE PRECISION NOT NULL DEFAULT 28,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingSettings_pkey" PRIMARY KEY ("id")
);

-- Backfill: until now waiting was charged at each rule's per-minute fare, so start there and
-- keep current behaviour until an admin changes it.
UPDATE "PricingRule" SET "waitingPerMinute" = "perMinute";
UPDATE "DeliverySizeTierPricingRule" SET "waitingPerMinute" = "perMinute";

-- Trips and deliveries already booked keep the rate they were booked under.
UPDATE "Trip" t SET "waitingPerMinute" = r."perMinute"
FROM "PricingRule" r WHERE r."rideType" = t."rideType";
UPDATE "Delivery" d SET "waitingPerMinute" = r."perMinute"
FROM "DeliverySizeTierPricingRule" r WHERE r."sizeTierId" = d."sizeTierId";

-- The one settings row, with the values that were hard-coded before.
INSERT INTO "PricingSettings" ("id", "updatedAt") VALUES (1, CURRENT_TIMESTAMP);
