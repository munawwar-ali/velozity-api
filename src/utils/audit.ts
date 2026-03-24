import { prisma } from '../config/prisma';
import { computeChainHash, GENESIS_HASH } from './chainHash';

interface CreateAuditLogParams {
  tenantId: string;
  userId?: string;
  apiKeyId?: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  previousValue?: unknown;
  newValue?: unknown;
  ipAddress?: string;
}

export function buildAuditEntryContent(params: {
  tenantId: string;
  userId: string | null;
  apiKeyId: string | null;
  action: string;
  resourceType: string;
  resourceId: string | null;
  previousValue: unknown;
  newValue: unknown;
  ipAddress: string | null;
  sequence: number;
}) {
  return {
    tenantId: params.tenantId,
    userId: params.userId,
    apiKeyId: params.apiKeyId,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId,
    previousValue: params.previousValue,
    newValue: params.newValue,
    ipAddress: params.ipAddress,
    sequence: params.sequence,
  };
}

export async function createAuditLog(params: CreateAuditLogParams): Promise<void> {
  const lastEntry = await prisma.auditLog.findFirst({
    where: { tenantId: params.tenantId },
    orderBy: { sequence: 'desc' },
  });

  const previousHash = lastEntry ? lastEntry.chainHash : GENESIS_HASH;
  const sequence = lastEntry ? lastEntry.sequence + 1 : 1;

  const entryContent = buildAuditEntryContent({
    tenantId: params.tenantId,
    userId: params.userId ?? null,
    apiKeyId: params.apiKeyId ?? null,
    action: params.action,
    resourceType: params.resourceType,
    resourceId: params.resourceId ?? null,
    previousValue: params.previousValue ?? null,
    newValue: params.newValue ?? null,
    ipAddress: params.ipAddress ?? null,
    sequence,
  });

  const chainHash = computeChainHash(entryContent, previousHash);

  await prisma.auditLog.create({
    data: {
      ...entryContent,
      chainHash,
      previousValue: params.previousValue
        ? JSON.parse(JSON.stringify(params.previousValue))
        : undefined,
      newValue: params.newValue
        ? JSON.parse(JSON.stringify(params.newValue))
        : undefined,
    },
  });
}