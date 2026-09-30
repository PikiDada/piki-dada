import { PrismaClient, RideType, UserRole } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

async function main() {
  // ADMIN accounts can't be self-registered through the public API (by design — see
  // RegisterDto), so the only way to bootstrap the first admin is here, via env vars.
  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const passwordHash = await argon2.hash(adminPassword, {
      type: argon2.argon2id,
    });
    await prisma.user.upsert({
      where: { email: adminEmail },
      update: {},
      create: {
        email: adminEmail,
        passwordHash,
        name: 'Admin',
        role: UserRole.ADMIN,
        emailVerifiedAt: new Date(),
        wallet: { create: { balance: 0 } },
      },
    });
    console.log(`Seed: admin account ensured for ${adminEmail}.`);
  } else {
    console.log(
      'Seed: SEED_ADMIN_EMAIL/SEED_ADMIN_PASSWORD not set, skipping admin bootstrap.',
    );
  }

  await prisma.pricingRule.upsert({
    where: { rideType: RideType.BODA },
    update: {},
    create: {
      rideType: RideType.BODA,
      baseFare: 1500,
      perKm: 500,
      perMinute: 50,
      currency: 'UGX',
    },
  });
  await prisma.pricingRule.upsert({
    where: { rideType: RideType.ECONOMY },
    update: {},
    create: {
      rideType: RideType.ECONOMY,
      baseFare: 3000,
      perKm: 900,
      perMinute: 100,
      currency: 'UGX',
    },
  });
  await prisma.pricingRule.upsert({
    where: { rideType: RideType.COMFORT },
    update: {},
    create: {
      rideType: RideType.COMFORT,
      baseFare: 4000,
      perKm: 1200,
      perMinute: 150,
      currency: 'UGX',
    },
  });

  await prisma.coupon.upsert({
    where: { code: 'WELCOME10' },
    update: {},
    create: { code: 'WELCOME10', discountPercent: 10, maxUses: 500 },
  });

  // Starting set of delivery categories — purely descriptive (what the item is, for the
  // rider's handling instructions). Admin can add/rename/disable more later via
  // /admin/delivery-categories without a deploy. Price comes from size tiers below, not these.
  const deliveryCategories = [
    { name: 'Parcels & Packages', icon: 'package', sortOrder: 0 },
    { name: 'Food', icon: 'utensils', sortOrder: 1 },
    { name: 'Groceries & Shopping', icon: 'shopping-cart', sortOrder: 2 },
    { name: 'Documents & Errands', icon: 'file-text', sortOrder: 3 },
    { name: 'Other', icon: 'box', sortOrder: 4 },
  ];
  for (const category of deliveryCategories) {
    await prisma.deliveryCategory.upsert({
      where: { name: category.name },
      update: {},
      create: category,
    });
  }

  // Size/weight tiers -- what actually drives delivery price, independent of category. A
  // parcel and a 50kg cargo item cost differently because of the tier they're in, not what
  // they're called. Admin can add more via /admin/delivery-size-tiers without a deploy.
  const sizeTiers = [
    {
      name: 'Small parcel (up to 5kg)',
      maxWeightKg: 5,
      sortOrder: 0,
      pricing: { baseFare: 1500, perKm: 500, perMinute: 50 },
    },
    {
      name: 'Medium (5-20kg)',
      maxWeightKg: 20,
      sortOrder: 1,
      pricing: { baseFare: 2500, perKm: 700, perMinute: 70 },
    },
    {
      name: 'Large / Cargo (20-50kg)',
      maxWeightKg: 50,
      sortOrder: 2,
      pricing: { baseFare: 4000, perKm: 1000, perMinute: 100 },
    },
    {
      name: 'Heavy (50kg+)',
      maxWeightKg: null,
      sortOrder: 3,
      pricing: { baseFare: 6000, perKm: 1500, perMinute: 150 },
    },
  ];
  for (const tier of sizeTiers) {
    const record = await prisma.deliverySizeTier.upsert({
      where: { name: tier.name },
      update: {},
      create: {
        name: tier.name,
        maxWeightKg: tier.maxWeightKg,
        sortOrder: tier.sortOrder,
      },
    });
    await prisma.deliverySizeTierPricingRule.upsert({
      where: { sizeTierId: record.id },
      update: {},
      create: { sizeTierId: record.id, ...tier.pricing, currency: 'UGX' },
    });
  }

  // Flat handling surcharges for delicate/awkward items, added on top of the tier fare.
  const surcharges = [
    { key: 'FRAGILE', label: 'Fragile handling', amount: 1000 },
    { key: 'LIQUID', label: 'Liquid/spillable handling', amount: 1000 },
  ];
  for (const surcharge of surcharges) {
    await prisma.deliverySurchargeRule.upsert({
      where: { key: surcharge.key },
      update: {},
      create: { ...surcharge, currency: 'UGX' },
    });
  }

  console.log(
    'Seed complete: pricing rules, welcome coupon, delivery categories, size tiers, and surcharges created.',
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
