-- AlterTable
ALTER TABLE "Trip" ADD COLUMN     "actualDistanceKm" DOUBLE PRECISION,
ADD COLUMN     "actualDurationMin" DOUBLE PRECISION;

-- CreateTable
CREATE TABLE "TripLocationPing" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TripLocationPing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TripLocationPing_tripId_recordedAt_idx" ON "TripLocationPing"("tripId", "recordedAt");

-- AddForeignKey
ALTER TABLE "TripLocationPing" ADD CONSTRAINT "TripLocationPing_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "Trip"("id") ON DELETE CASCADE ON UPDATE CASCADE;
