-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('REQUESTED', 'SEARCHING', 'ACCEPTED', 'ARRIVED_PICKUP', 'PICKED_UP', 'ARRIVED_DROPOFF', 'DELIVERED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Delivery" (
    "id" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "riderId" TEXT,
    "categoryId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'REQUESTED',
    "pickupContactName" TEXT NOT NULL,
    "pickupContactPhone" TEXT NOT NULL,
    "pickupAddress" TEXT NOT NULL,
    "pickupLat" DOUBLE PRECISION NOT NULL,
    "pickupLng" DOUBLE PRECISION NOT NULL,
    "dropoffContactName" TEXT NOT NULL,
    "dropoffContactPhone" TEXT NOT NULL,
    "destinationAddress" TEXT NOT NULL,
    "destinationLat" DOUBLE PRECISION NOT NULL,
    "destinationLng" DOUBLE PRECISION NOT NULL,
    "itemDescription" TEXT NOT NULL,
    "itemPhotoUrl" TEXT,
    "isFragile" BOOLEAN NOT NULL DEFAULT false,
    "cashOnDeliveryAmount" DOUBLE PRECISION,
    "distanceKm" DOUBLE PRECISION,
    "durationMin" DOUBLE PRECISION,
    "fare" DOUBLE PRECISION,
    "currency" TEXT NOT NULL DEFAULT 'UGX',
    "paymentMethod" "PaymentMethod" NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "arrivedPickupAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    "arrivedDropoffAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Delivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPayment" (
    "id" TEXT NOT NULL,
    "deliveryId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UGX',
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "providerRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DeliveryPricingRule" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "baseFare" DOUBLE PRECISION NOT NULL,
    "perKm" DOUBLE PRECISION NOT NULL,
    "perMinute" DOUBLE PRECISION NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'UGX',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryPricingRule_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPayment_deliveryId_key" ON "DeliveryPayment"("deliveryId");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryCategory_name_key" ON "DeliveryCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "DeliveryPricingRule_categoryId_key" ON "DeliveryPricingRule"("categoryId");

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_riderId_fkey" FOREIGN KEY ("riderId") REFERENCES "Driver"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Delivery" ADD CONSTRAINT "Delivery_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DeliveryCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPayment" ADD CONSTRAINT "DeliveryPayment_deliveryId_fkey" FOREIGN KEY ("deliveryId") REFERENCES "Delivery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DeliveryPricingRule" ADD CONSTRAINT "DeliveryPricingRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "DeliveryCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

