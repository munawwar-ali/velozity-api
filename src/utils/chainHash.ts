import crypto from 'crypto';

function deepSortedStringify(obj: unknown): string {
  if (obj === null || obj === undefined) {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(deepSortedStringify).join(',') + ']';
  }
  if (typeof obj === 'object') {
    const sorted = Object.keys(obj as Record<string, unknown>)
      .sort()
      .map((key) => {
        const val = deepSortedStringify((obj as Record<string, unknown>)[key]);
        return `"${key}":${val}`;
      })
      .join(',');
    return '{' + sorted + '}';
  }
  return JSON.stringify(obj);
}

export function computeChainHash(
  entryContent: object,
  previousHash: string
): string {
  const data = deepSortedStringify(entryContent) + previousHash;
  return crypto.createHash('sha256').update(data).digest('hex');
}

export const GENESIS_HASH = '0000000000000000000000000000000000000000000000000000000000000000';