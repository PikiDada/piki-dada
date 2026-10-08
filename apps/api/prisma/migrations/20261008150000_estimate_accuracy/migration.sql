-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "durationFactor" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "durationFactor" DOUBLE PRECISION NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "PricingSettings" ADD COLUMN     "durationCorrectionEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "durationCorrectionMax" DOUBLE PRECISION NOT NULL DEFAULT 2,
ADD COLUMN     "durationCorrectionMinTrips" INTEGER NOT NULL DEFAULT 30;

