-- AlterTable
ALTER TABLE "Delivery" ADD COLUMN     "isLiquid" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "sizeTierId" TEXT;

-- CreateTable
CREATE TABLE "DeliverySizeTier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "maxWeightKg" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySizeTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverySizeTierPricingRule" (
    "id" TEXT NOT NULL,
    "sizeTierId" TEXT NOT NULL,
    "baseFare" DOUBLE PRECISION NOT NULL,
    "perKm" DOUBLE PRECISION NOT NULL,
    "perMinute" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UGX',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySizeTierPricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliverySurchargeRule" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UGX',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliverySurchargeRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySizeTier_name_key" ON "DeliverySizeTier"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySizeTierPricingRule_sizeTierId_key" ON "DeliverySizeTierPricingRule"("sizeTierId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliverySurchargeRule_key_key" ON "DeliverySurchargeRule"("key");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_sizeTierId_fkey" FOREIGN KEY ("sizeTierId") REFERENCES "DeliverySizeTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliverySizeTierPricingRule" ADD CONSTRAINT "DeliverySizeTierPricingRule_sizeTierId_fkey" FOREIGN KEY ("sizeTierId") REFERENCES "DeliverySizeTier"("id") ON DELETE CASCADE ON UPDATE CASCADE;

