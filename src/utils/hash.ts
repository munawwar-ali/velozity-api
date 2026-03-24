import argon2 from 'argon2';
import crypto from 'crypto';

export async function hashApiKey(rawKey: string): Promise<string> {
  return argon2.hash(rawKey);
}

export async function verifyApiKey(rawKey: string, hash: string): Promise<boolean> {
  return argon2.verify(hash, rawKey);
}

export function generateApiKey(): { raw: string; prefix: string } {
  const prefix = 'vz_';
  const raw = prefix + crypto.randomBytes(32).toString('hex');
  return { raw, prefix };
}