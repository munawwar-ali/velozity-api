import { computeChainHash, GENESIS_HASH } from '../src/utils/chainHash';

interface AuditEntry {
  id: string;
  tenantId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  previousValue: unknown;
  newValue: unknown;
  ipAddress: string;
  sequence: number;
  chainHash: string;
}

function buildChain(entries: Omit<AuditEntry, 'chainHash'>[]): AuditEntry[] {
  let previousHash = GENESIS_HASH;
  const chain: AuditEntry[] = [];

  for (const entry of entries) {
    const content = {
      tenantId: entry.tenantId,
      userId: entry.userId,
      apiKeyId: null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      previousValue: entry.previousValue,
      newValue: entry.newValue,
      ipAddress: entry.ipAddress,
      sequence: entry.sequence,
    };

    const chainHash = computeChainHash(content, previousHash);
    chain.push({ ...entry, chainHash });
    previousHash = chainHash;
  }

  return chain;
}

function verifyChain(entries: AuditEntry[]): {
  intact: boolean;
  tamperedId?: string;
  tamperedSequence?: number;
} {
  let previousHash = GENESIS_HASH;

  for (const entry of entries) {
    const content = {
      tenantId: entry.tenantId,
      userId: entry.userId,
      apiKeyId: null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      previousValue: entry.previousValue,
      newValue: entry.newValue,
      ipAddress: entry.ipAddress,
      sequence: entry.sequence,
    };

    const expectedHash = computeChainHash(content, previousHash);

    if (expectedHash !== entry.chainHash) {
      return {
        intact: false,
        tamperedId: entry.id,
        tamperedSequence: entry.sequence,
      };
    }

    previousHash = entry.chainHash;
  }

  return { intact: true };
}

const sampleEntries = [
  {
    id: 'entry-1',
    tenantId: 'tenant-1',
    userId: 'user-1',
    action: 'USER_CREATED',
    resourceType: 'user',
    resourceId: 'user-1',
    previousValue: null,
    newValue: { email: 'test@test.com' },
    ipAddress: '127.0.0.1',
    sequence: 1,
  },
  {
    id: 'entry-2',
    tenantId: 'tenant-1',
    userId: 'user-1',
    action: 'USER_UPDATED',
    resourceType: 'user',
    resourceId: 'user-1',
    previousValue: { name: 'Old' },
    newValue: { name: 'New' },
    ipAddress: '127.0.0.1',
    sequence: 2,
  },
  {
    id: 'entry-3',
    tenantId: 'tenant-1',
    userId: 'user-1',
    action: 'API_KEY_CREATED',
    resourceType: 'api_key',
    resourceId: 'key-1',
    previousValue: null,
    newValue: { prefix: 'vz_' },
    ipAddress: '127.0.0.1',
    sequence: 3,
  },
];

describe('Audit Chain Hash', () => {
  it('builds a valid chain from genesis', () => {
    const chain = buildChain(sampleEntries);
    expect(chain).toHaveLength(3);
    chain.forEach((entry) => {
      expect(entry.chainHash).toBeTruthy();
      expect(entry.chainHash).toHaveLength(64); // SHA-256 hex
    });
  });

  it('verifies an intact chain successfully', () => {
    const chain = buildChain(sampleEntries);
    const result = verifyChain(chain);
    expect(result.intact).toBe(true);
    expect(result.tamperedId).toBeUndefined();
  });

  it('detects tampering in first entry', () => {
    const chain = buildChain(sampleEntries);

    // Tamper with first entry
    chain[0] = {
      ...chain[0],
      action: 'TAMPERED_ACTION',
    };

    const result = verifyChain(chain);
    expect(result.intact).toBe(false);
    expect(result.tamperedSequence).toBe(1);
  });

  it('detects tampering in middle entry', () => {
    const chain = buildChain(sampleEntries);

    // Tamper with second entry
    chain[1] = {
      ...chain[1],
      newValue: { name: 'Tampered' },
    };

    const result = verifyChain(chain);
    expect(result.intact).toBe(false);
    expect(result.tamperedSequence).toBe(2);
  });

  it('detects tampering in last entry', () => {
    const chain = buildChain(sampleEntries);

    // Tamper with last entry
    chain[2] = {
      ...chain[2],
      ipAddress: '999.999.999.999',
    };

    const result = verifyChain(chain);
    expect(result.intact).toBe(false);
    expect(result.tamperedSequence).toBe(3);
  });

  it('each entry produces a unique hash', () => {
    const chain = buildChain(sampleEntries);
    const hashes = chain.map((e) => e.chainHash);
    const uniqueHashes = new Set(hashes);
    expect(uniqueHashes.size).toBe(hashes.length);
  });

  it('same content always produces same hash', () => {
    const chain1 = buildChain(sampleEntries);
    const chain2 = buildChain(sampleEntries);

    chain1.forEach((entry, i) => {
      expect(entry.chainHash).toBe(chain2[i].chainHash);
    });
  });

  it('genesis hash is all zeros', () => {
    expect(GENESIS_HASH).toBe(
      '0000000000000000000000000000000000000000000000000000000000000000'
    );
    expect(GENESIS_HASH).toHaveLength(64);
  });

  it('changing only IP address breaks the chain', () => {
    const chain = buildChain(sampleEntries);

    chain[1] = {
      ...chain[1],
      ipAddress: '192.168.1.1',
    };

    const result = verifyChain(chain);
    expect(result.intact).toBe(false);
  });
});