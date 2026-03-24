import { PrismaClient } from '@prisma/client';
import { generateApiKey, hashApiKey } from '../utils/hash';
import { computeChainHash, GENESIS_HASH } from '../utils/chainHash';
import { buildAuditEntryContent } from '../utils/audit';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Starting seed...');

  // Temporarily disable append-only trigger for seed reset
  await prisma.$executeRaw`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_delete`;
  await prisma.$executeRaw`ALTER TABLE audit_logs DISABLE TRIGGER audit_logs_no_update`;

  // Clean existing data
  await prisma.emailLog.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.apiKey.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();

  // Re-enable append-only trigger
  await prisma.$executeRaw`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_delete`;
  await prisma.$executeRaw`ALTER TABLE audit_logs ENABLE TRIGGER audit_logs_no_update`;

  // ─── TENANT 1 ───────────────────────────────────────────
  const tenant1 = await prisma.tenant.create({
    data: { name: 'Acme Corporation' },
  });

  const tenant1Owner = await prisma.user.create({
    data: {
      email: 'owner@acme.com',
      name: 'Alice Owner',
      role: 'OWNER',
      tenantId: tenant1.id,
    },
  });

  const tenant1Member1 = await prisma.user.create({
    data: {
      email: 'bob@acme.com',
      name: 'Bob Member',
      role: 'MEMBER',
      tenantId: tenant1.id,
    },
  });

  const tenant1Member2 = await prisma.user.create({
    data: {
      email: 'carol@acme.com',
      name: 'Carol Member',
      role: 'MEMBER',
      tenantId: tenant1.id,
    },
  });

  const t1Key = generateApiKey();
  const t1KeyHash = await hashApiKey(t1Key.raw);
  const tenant1ApiKey = await prisma.apiKey.create({
    data: {
      keyHash: t1KeyHash,
      prefix: t1Key.prefix,
      tenantId: tenant1.id,
      userId: tenant1Owner.id,
    },
  });

  // ─── TENANT 2 ───────────────────────────────────────────
  const tenant2 = await prisma.tenant.create({
    data: { name: 'Globex Industries' },
  });

  const tenant2Owner = await prisma.user.create({
    data: {
      email: 'owner@globex.com',
      name: 'Dave Owner',
      role: 'OWNER',
      tenantId: tenant2.id,
    },
  });

  const tenant2Member1 = await prisma.user.create({
    data: {
      email: 'eve@globex.com',
      name: 'Eve Member',
      role: 'MEMBER',
      tenantId: tenant2.id,
    },
  });

  const tenant2Member2 = await prisma.user.create({
    data: {
      email: 'frank@globex.com',
      name: 'Frank Member',
      role: 'MEMBER',
      tenantId: tenant2.id,
    },
  });

  const t2Key = generateApiKey();
  const t2KeyHash = await hashApiKey(t2Key.raw);
  const tenant2ApiKey = await prisma.apiKey.create({
    data: {
      keyHash: t2KeyHash,
      prefix: t2Key.prefix,
      tenantId: tenant2.id,
      userId: tenant2Owner.id,
    },
  });

  // ─── AUDIT LOG CHAIN FOR TENANT 1 (10 entries) ──────────
  console.log('🔗 Building audit chain for Tenant 1...');

  const tenant1AuditEntries = [
    {
      action: 'TENANT_CREATED',
      resourceType: 'tenant',
      resourceId: tenant1.id,
      userId: tenant1Owner.id,
      apiKeyId: tenant1ApiKey.id,
      newValue: { name: tenant1.name },
      previousValue: null,
    },
    {
      action: 'USER_CREATED',
      resourceType: 'user',
      resourceId: tenant1Owner.id,
      userId: tenant1Owner.id,
      apiKeyId: tenant1ApiKey.id,
      newValue: { email: tenant1Owner.email, role: 'OWNER' },
      previousValue: null,
    },
    {
      action: 'API_KEY_CREATED',
      resourceType: 'api_key',
      resourceId: tenant1ApiKey.id,
      userId: tenant1Owner.id,
      apiKeyId: tenant1ApiKey.id,
      newValue: { prefix: t1Key.prefix },
      previousValue: null,
    },
    {
      action: 'USER_CREATED',
      resourceType: 'user',
      resourceId: tenant1Member1.id,
      userId: tenant1Owner.id,
      apiKeyId: tenant1ApiKey.id,
      newValue: { email: tenant1Member1.email, role: 'MEMBER' },
      previousValue: null,
    },
    {
      action: 'USER_CREATED',
      resourceType: 'user',
      resourceId: tenant1Member2.id,
      userId: tenant1Owner.id,
      apiKeyId: tenant1ApiKey.id,
      newValue: { email: tenant1Member2.email, role: 'MEMBER' },
      previousValue: null,
    },
    {
      action: 'USER_UPDATED',
      resourceType: 'user',
      resourceId: tenant1Member1.id,
      userId: tenant1Owner.id,
      apiKeyId: tenant1ApiKey.id,
      previousValue: { name: 'Bob Member' },
      newValue: { name: 'Bob Updated' },
    },
    {
      action: 'TENANT_UPDATED',
      resourceType: 'tenant',
      resourceId: tenant1.id,
      userId: tenant1Owner.id,
      apiKeyId: tenant1ApiKey.id,
      previousValue: { name: 'Acme Corporation' },
      newValue: { name: 'Acme Corp' },
    },
    {
      action: 'TENANT_UPDATED',
      resourceType: 'tenant',
      resourceId: tenant1.id,
      userId: tenant1Owner.id,
      apiKeyId: tenant1ApiKey.id,
      previousValue: { name: 'Acme Corp' },
      newValue: { name: 'Acme Corporation' },
    },
    {
      action: 'API_KEY_ROTATED',
      resourceType: 'api_key',
      resourceId: tenant1ApiKey.id,
      userId: tenant1Owner.id,
      apiKeyId: tenant1ApiKey.id,
      previousValue: { keyId: tenant1ApiKey.id },
      newValue: { rotatedAt: new Date().toISOString() },
    },
    {
      action: 'USER_UPDATED',
      resourceType: 'user',
      resourceId: tenant1Member2.id,
      userId: tenant1Owner.id,
      apiKeyId: tenant1ApiKey.id,
      previousValue: { role: 'MEMBER' },
      newValue: { role: 'OWNER' },
    },
  ];

  let previousHash = GENESIS_HASH;

  for (let i = 0; i < tenant1AuditEntries.length; i++) {
    const entry = tenant1AuditEntries[i];
    const sequence = i + 1;

    const entryContent = buildAuditEntryContent({
      tenantId: tenant1.id,
      userId: entry.userId,
      apiKeyId: entry.apiKeyId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      previousValue: entry.previousValue ?? null,
      newValue: entry.newValue ?? null,
      ipAddress: '127.0.0.1',
      sequence,
    });

    const chainHash = computeChainHash(entryContent, previousHash);

    await prisma.auditLog.create({
      data: {
        ...entryContent,
        chainHash,
        previousValue: entry.previousValue ?? undefined,
        newValue: entry.newValue ?? undefined,
      },
    });

    previousHash = chainHash;
  }

  // ─── AUDIT LOG CHAIN FOR TENANT 2 (10 entries) ──────────
  console.log('🔗 Building audit chain for Tenant 2...');

  const tenant2AuditEntries = [
    {
      action: 'TENANT_CREATED',
      resourceType: 'tenant',
      resourceId: tenant2.id,
      userId: tenant2Owner.id,
      apiKeyId: tenant2ApiKey.id,
      newValue: { name: tenant2.name },
      previousValue: null,
    },
    {
      action: 'USER_CREATED',
      resourceType: 'user',
      resourceId: tenant2Owner.id,
      userId: tenant2Owner.id,
      apiKeyId: tenant2ApiKey.id,
      newValue: { email: tenant2Owner.email, role: 'OWNER' },
      previousValue: null,
    },
    {
      action: 'API_KEY_CREATED',
      resourceType: 'api_key',
      resourceId: tenant2ApiKey.id,
      userId: tenant2Owner.id,
      apiKeyId: tenant2ApiKey.id,
      newValue: { prefix: t2Key.prefix },
      previousValue: null,
    },
    {
      action: 'USER_CREATED',
      resourceType: 'user',
      resourceId: tenant2Member1.id,
      userId: tenant2Owner.id,
      apiKeyId: tenant2ApiKey.id,
      newValue: { email: tenant2Member1.email, role: 'MEMBER' },
      previousValue: null,
    },
    {
      action: 'USER_CREATED',
      resourceType: 'user',
      resourceId: tenant2Member2.id,
      userId: tenant2Owner.id,
      apiKeyId: tenant2ApiKey.id,
      newValue: { email: tenant2Member2.email, role: 'MEMBER' },
      previousValue: null,
    },
    {
      action: 'USER_UPDATED',
      resourceType: 'user',
      resourceId: tenant2Member1.id,
      userId: tenant2Owner.id,
      apiKeyId: tenant2ApiKey.id,
      previousValue: { name: 'Eve Member' },
      newValue: { name: 'Eve Updated' },
    },
    {
      action: 'TENANT_UPDATED',
      resourceType: 'tenant',
      resourceId: tenant2.id,
      userId: tenant2Owner.id,
      apiKeyId: tenant2ApiKey.id,
      previousValue: { name: 'Globex Industries' },
      newValue: { name: 'Globex Inc' },
    },
    {
      action: 'TENANT_UPDATED',
      resourceType: 'tenant',
      resourceId: tenant2.id,
      userId: tenant2Owner.id,
      apiKeyId: tenant2ApiKey.id,
      previousValue: { name: 'Globex Inc' },
      newValue: { name: 'Globex Industries' },
    },
    {
      action: 'API_KEY_ROTATED',
      resourceType: 'api_key',
      resourceId: tenant2ApiKey.id,
      userId: tenant2Owner.id,
      apiKeyId: tenant2ApiKey.id,
      previousValue: { keyId: tenant2ApiKey.id },
      newValue: { rotatedAt: new Date().toISOString() },
    },
    {
      action: 'USER_UPDATED',
      resourceType: 'user',
      resourceId: tenant2Member2.id,
      userId: tenant2Owner.id,
      apiKeyId: tenant2ApiKey.id,
      previousValue: { role: 'MEMBER' },
      newValue: { role: 'OWNER' },
    },
  ];

  previousHash = GENESIS_HASH;

  for (let i = 0; i < tenant2AuditEntries.length; i++) {
    const entry = tenant2AuditEntries[i];
    const sequence = i + 1;

    const entryContent = buildAuditEntryContent({
      tenantId: tenant2.id,
      userId: entry.userId,
      apiKeyId: entry.apiKeyId,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      previousValue: entry.previousValue ?? null,
      newValue: entry.newValue ?? null,
      ipAddress: '127.0.0.1',
      sequence,
    });

    const chainHash = computeChainHash(entryContent, previousHash);

    await prisma.auditLog.create({
      data: {
        ...entryContent,
        chainHash,
        previousValue: entry.previousValue ?? undefined,
        newValue: entry.newValue ?? undefined,
      },
    });

    previousHash = chainHash;
  }

  console.log('\n✅ Seed completed!\n');
  console.log('─────────────────────────────────────────');
  console.log('TENANT 1: Acme Corporation');
  console.log(`  Owner:    owner@acme.com`);
  console.log(`  Members:  bob@acme.com, carol@acme.com`);
  console.log(`  API Key:  ${t1Key.raw}`);
  console.log('─────────────────────────────────────────');
  console.log('TENANT 2: Globex Industries');
  console.log(`  Owner:    owner@globex.com`);
  console.log(`  Members:  eve@globex.com, frank@globex.com`);
  console.log(`  API Key:  ${t2Key.raw}`);
  console.log('─────────────────────────────────────────');
  console.log('\n⚠️  Copy these API keys — they will never be shown again!\n');
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });