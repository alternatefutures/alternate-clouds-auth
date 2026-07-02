import { PrismaClient } from '@prisma/client';
import Stripe from 'stripe';

const prisma = new PrismaClient();

const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY || '';

/**
 * Alternate Clouds subscription plans (2026-02-14)
 *
 * Pricing model:
 *   - Monthly: $25/seat/month, 25% markup on usage
 *   - Yearly:  $240/seat/year (= $20/seat/month equivalent), 20% markup on usage
 *
 * IMPORTANT: `basePricePerSeat` stores the TRUE per-period line-item amount that
 * matches the Stripe price — MONTHLY = 2500 ($25/mo), YEARLY = 24000 ($240/yr).
 * Storing the monthly-equivalent ($20) for YEARLY made seat-proback previews
 * understate the yearly seat proration ~12×. Display layers divide by 12 to show a
 * monthly-equivalent. (Fixed 2026-06-03, decision #11 / §9.3.)
 *
 * Usage (AI inference, compute, storage, bandwidth) is billed from the
 * prepaid credits wallet. The markup is applied on top of raw provider cost:
 *   charged = rawCost * (1 + usageMarkup)
 *
 * Trial: 12-day free trial + $5 signup compute credit
 */
const subscriptionPlans = [
  {
    name: 'MONTHLY',
    basePricePerSeat: 2500,
    usageMarkup: 0.25,
    billingInterval: 'MONTHLY',
    isActive: true,
    trialDays: 12,
    features: JSON.stringify([]),
    stripe: {
      productName: 'Alternate Clouds Monthly',
      unitAmount: 2500,
      interval: 'month' as const,
    },
  },
  {
    name: 'YEARLY',
    basePricePerSeat: 24000, // $240/seat/year — TRUE annual amount, matches Stripe unit_amount
    usageMarkup: 0.20,
    billingInterval: 'YEARLY',
    isActive: true,
    trialDays: 12,
    features: JSON.stringify([]),
    stripe: {
      productName: 'Alternate Clouds Yearly',
      unitAmount: 24000, // $240/year
      interval: 'year' as const,
    },
  },
];

const LEGACY_PLANS = ['FREE', 'STARTER', 'PRO', 'ENTERPRISE'];

/**
 * Create or retrieve a Stripe Product + Price for a plan.
 * Returns the Stripe Price ID, or null if Stripe is not configured.
 */
async function ensureStripePrice(plan: typeof subscriptionPlans[0]): Promise<string | null> {
  if (!STRIPE_SECRET_KEY) {
    console.log(`  [Stripe] No STRIPE_SECRET_KEY — skipping Stripe price creation for ${plan.name}`);
    return null;
  }

  const stripe = new Stripe(STRIPE_SECRET_KEY);
  const { stripe: s } = plan;

  // Search for existing product by metadata
  const products = await stripe.products.search({
    query: `metadata["af_plan"]:"${plan.name}"`,
  });

  let productId: string;

  if (products.data.length > 0) {
    productId = products.data[0].id;
    console.log(`  [Stripe] Found existing product for ${plan.name}: ${productId}`);
  } else {
    const product = await stripe.products.create({
      name: s.productName,
      metadata: { af_plan: plan.name },
    });
    productId = product.id;
    console.log(`  [Stripe] Created product for ${plan.name}: ${productId}`);
  }

  // Search for existing price on this product
  const prices = await stripe.prices.list({
    product: productId,
    active: true,
    type: 'recurring',
    limit: 10,
  });

  const matchingPrice = prices.data.find(
    p => p.unit_amount === s.unitAmount && p.recurring?.interval === s.interval
  );

  if (matchingPrice) {
    console.log(`  [Stripe] Found existing price for ${plan.name}: ${matchingPrice.id}`);
    return matchingPrice.id;
  }

  const price = await stripe.prices.create({
    product: productId,
    unit_amount: s.unitAmount,
    currency: 'usd',
    recurring: { interval: s.interval },
    metadata: { af_plan: plan.name },
  });

  console.log(`  [Stripe] Created price for ${plan.name}: ${price.id}`);
  return price.id;
}

async function seed() {
  console.log('Seeding subscription plans...\n');

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

  for (const plan of subscriptionPlans) {
    const stripePriceId = await ensureStripePrice(plan);

    const dbData = {
      name: plan.name,
      basePricePerSeat: plan.basePricePerSeat,
      usageMarkup: plan.usageMarkup,
      billingInterval: plan.billingInterval,
      isActive: plan.isActive,
      trialDays: plan.trialDays,
      features: plan.features,
      ...(stripePriceId ? { stripePriceId } : {}),
    };

    const existing = await prisma.subscriptionPlan.findUnique({
      where: { name: plan.name },
    });

    if (existing) {
      console.log(`  Plan "${plan.name}" already exists, updating...`);
      await prisma.subscriptionPlan.update({
        where: { name: plan.name },
        data: dbData,
      });
    } else {
      console.log(`  Creating plan "${plan.name}"...`);
      await prisma.subscriptionPlan.create({ data: dbData });
    }
  }

  console.log('\nDone seeding subscription plans!\n');

  const plans = await prisma.subscriptionPlan.findMany({
    orderBy: { isActive: 'desc' },
  });
  console.log('Current subscription plans:');
  for (const plan of plans) {
    const status = plan.isActive ? 'ACTIVE' : 'INACTIVE';
    const price = plan.basePricePerSeat / 100;
    const perSeatUnit = plan.billingInterval === 'YEARLY' ? 'seat/year' : 'seat/month';
    const markup = Math.round(plan.usageMarkup * 100);
    const stripe = plan.stripePriceId ? ` stripe:${plan.stripePriceId}` : ' (no stripe price)';
    console.log(
      `  [${status}] ${plan.name}: $${price}/${perSeatUnit}, ${markup}% usage markup, billed ${plan.billingInterval}${stripe}`
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
