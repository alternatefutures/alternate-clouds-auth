import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/**
 * Alternate Futures subscription plans (2026-02-14)
 *
 * Pricing model:
 *   - Monthly: $25/seat/month, 25% markup on usage
 *   - Yearly:  $20/seat/month ($240/year), 20% markup on usage
 *
 * Usage (AI inference, compute, storage, bandwidth) is billed from the
 * prepaid credits wallet. The markup is applied on top of raw provider cost:
 *   charged = rawCost * (1 + usageMarkup)
 *
 * Trial: 30-day free trial + $5 signup compute credit
 */
const subscriptionPlans = [
  {
    name: 'MONTHLY',
    basePricePerSeat: 2500, // $25/month in cents
    usageMarkup: 0.25, // 25% markup on usage
    billingInterval: 'MONTHLY',
    isActive: true,
    trialDays: 30,
    features: JSON.stringify([
      'Full platform access',
      'AI inference (usage-based)',
      'Akash deployments',
      'Phala TEE deployments',
      'Custom domains',
      'Team collaboration',
      'Priority support',
    ]),
  },
  {
    name: 'YEARLY',
    basePricePerSeat: 2000, // $20/month equivalent ($240/year) in cents
    usageMarkup: 0.20, // 20% markup on usage
    billingInterval: 'YEARLY',
    isActive: true,
    trialDays: 30,
    features: JSON.stringify([
      'Full platform access',
      'AI inference (usage-based)',
      'Akash deployments',
      'Phala TEE deployments',
      'Custom domains',
      'Team collaboration',
      'Priority support',
      'Save 20% vs monthly',
    ]),
  },
];

// Legacy plan names to deactivate
const LEGACY_PLANS = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];

async function seed() {
  console.log('Seeding subscription plans...\n');

  // Deactivate legacy plans (don't delete — they may have FK references)
  for (const legacyName of LEGACY_PLANS) {
    const existing = await prisma.subscriptionPlan.findUnique({
      where: { name: legacyName },
    });
    if (existing) {
      await prisma.subscriptionPlan.update({
        where: { name: legacyName },
        data: { isActive: false },
      });
      console.log(`  Deactivated legacy plan "${legacyName}"`);
    }
  }

  // Upsert current plans
  for (const plan of subscriptionPlans) {
    const existing = await prisma.subscriptionPlan.findUnique({
      where: { name: plan.name },
    });

    if (existing) {
      console.log(`  Plan "${plan.name}" already exists, updating...`);
      await prisma.subscriptionPlan.update({
        where: { name: plan.name },
        data: plan,
      });
    } else {
      console.log(`  Creating plan "${plan.name}"...`);
      await prisma.subscriptionPlan.create({
        data: plan,
      });
    }
  }

  console.log('\nDone seeding subscription plans!\n');

  // List all plans
  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: { isActive: 'desc' },
  });
  console.log('Current subscription plans:');
  for (const plan of plans) {
    const status = plan.isActive ? 'ACTIVE' : 'INACTIVE';
    const price = plan.basePricePerSeat / 100;
    const markup = Math.round(plan.usageMarkup * 100);
    console.log(
      `  [${status}] ${plan.name}: $${price}/seat/month, ${markup}% usage markup, billed ${plan.billingInterval}`
    );
  }
}

seed()
  .catch((e) => {
    console.error('Error seeding:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
