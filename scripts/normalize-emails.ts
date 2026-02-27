import { PrismaClient } from '@prisma/client';

/**
 * One-time migration: normalize all stored emails to lowercase.
 *
 * Handles auth_users.email, auth_methods.identifier (email type),
 * and auth_verification_codes.identifier (email type).
 *
 * Run with: npx tsx scripts/normalize-emails.ts
 */
const prisma = new PrismaClient();

async function main() {
  console.log('=== Email Normalization Migration ===\n');

  // 1. Check for case-collision conflicts in auth_users
  const users = await prisma.authUser.findMany({
    where: { email: { not: null } },
    select: { id: true, email: true },
  });

  const emailMap = new Map<string, typeof users>();
  for (const u of users) {
    const lower = u.email!.toLowerCase();
    const group = emailMap.get(lower) || [];
    group.push(u);
    emailMap.set(lower, group);
  }

  const conflicts = [...emailMap.entries()].filter(([, group]) => group.length > 1);
  if (conflicts.length > 0) {
    console.error('CONFLICT: Multiple users share the same email (case-insensitive):');
    for (const [email, group] of conflicts) {
      console.error(`  ${email}: ${group.map((u) => `${u.id} (${u.email})`).join(', ')}`);
    }
    console.error('\nResolve duplicates manually before running this migration.');
    process.exit(1);
  }

  // 2. Lowercase auth_users.email
  const mixedCaseUsers = users.filter((u) => u.email !== u.email!.toLowerCase());
  if (mixedCaseUsers.length > 0) {
    console.log(`Lowercasing ${mixedCaseUsers.length} user email(s)...`);
    for (const u of mixedCaseUsers) {
      await prisma.authUser.update({
        where: { id: u.id },
        data: { email: u.email!.toLowerCase() },
      });
      console.log(`  ${u.email} → ${u.email!.toLowerCase()}`);
    }
  } else {
    console.log('All user emails already lowercase.');
  }

  // 3. Lowercase auth_methods.identifier where method_type = 'email'
  const emailMethods = await prisma.authMethod.findMany({
    where: { methodType: 'email' },
    select: { id: true, identifier: true },
  });
  const mixedCaseMethods = emailMethods.filter((m) => m.identifier !== m.identifier.toLowerCase());
  if (mixedCaseMethods.length > 0) {
    console.log(`Lowercasing ${mixedCaseMethods.length} auth method identifier(s)...`);
    for (const m of mixedCaseMethods) {
      await prisma.authMethod.update({
        where: { id: m.id },
        data: { identifier: m.identifier.toLowerCase() },
      });
      console.log(`  ${m.identifier} → ${m.identifier.toLowerCase()}`);
    }
  } else {
    console.log('All email auth method identifiers already lowercase.');
  }

  // 4. Lowercase verification code identifiers for email type
  const emailCodes = await prisma.verificationCode.findMany({
    where: { codeType: 'email' },
    select: { id: true, identifier: true },
  });
  const mixedCaseCodes = emailCodes.filter((c) => c.identifier !== c.identifier.toLowerCase());
  if (mixedCaseCodes.length > 0) {
    console.log(`Lowercasing ${mixedCaseCodes.length} verification code identifier(s)...`);
    for (const c of mixedCaseCodes) {
      await prisma.verificationCode.update({
        where: { id: c.id },
        data: { identifier: c.identifier.toLowerCase() },
      });
    }
  } else {
    console.log('All email verification code identifiers already lowercase.');
  }

  console.log('\nDone.');
}

main()
  .catch((e) => {
    console.error('Migration failed:', e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
