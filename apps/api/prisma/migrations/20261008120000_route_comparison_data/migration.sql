-- CreateEnum
CREATE TYPE "RouteSource" AS ENUM ('GOOGLE', 'MAPS_PLATFORM', 'STRAIGHT_LINE');

-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "mapsDistanceKm" DOUBLE PRECISION,
ADD COLUMN     "mapsDurationMin" DOUBLE PRECISION,
ADD COLUMN     "routeSource" "RouteSource";

-- AlterTable
ALTER TABLE "TripLocationPing" ADD COLUMN     "billed" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "actualDistanceKm" DOUBLE PRECISION,
ADD COLUMN     "actualDurationMin" DOUBLE PRECISION,
ADD COLUMN     "mapsDistanceKm" DOUBLE PRECISION,
ADD COLUMN     "mapsDurationMin" DOUBLE PRECISION,
ADD COLUMN     "routeSource" "RouteSource";

-- CreateTable
CREATE TABLE "DeliveryLocationPing" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "billed" BOOLEAN NOT NULL DEFAULT true,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeliveryLocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DeliveryLocationPing_deliveryId_recordedAt_idx" ON "DeliveryLocationPing"("deliveryId", "recordedAt");

-- AddForeignKey
ALTER TABLE "DeliveryLocationPing" ADD CONSTRAINT "DeliveryLocationPing_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

