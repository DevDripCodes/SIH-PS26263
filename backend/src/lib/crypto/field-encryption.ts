import { createCipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";

// AES-256-GCM field encryption for the BYTEA *_enc columns in core.student_foreign_nri_profiles.
// The database never sees the key. Ciphertext layout: version(1) | iv(12) | tag(16) | ciphertext.

const KEY_VERSION = 1;

export class FieldEncryptionConfigError extends Error {}

interface Keys {
  encryption: Buffer;
  fingerprint: Buffer;
}

let cached: Keys | null = null;

function keys(): Keys {
  if (cached) return cached;
  const raw = process.env.FIELD_ENCRYPTION_KEY?.trim();
  const master = raw ? Buffer.from(raw, "base64") : Buffer.alloc(0);
  if (master.length !== 32) {
    throw new FieldEncryptionConfigError(
      "FIELD_ENCRYPTION_KEY must be a base64-encoded 32-byte key (generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64'))\").",
    );
  }
  // Separate subkeys so the fingerprint HMAC key is never the encryption key.
  cached = {
    encryption: Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "apaar/field-encryption/v1", 32)),
    fingerprint: Buffer.from(hkdfSync("sha256", master, Buffer.alloc(0), "apaar/field-fingerprint/v1", 32)),
  };
  return cached;
}

export const ENCRYPTION_KEY_VERSION = KEY_VERSION;

export function encryptField(plaintext: string): Buffer {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keys().encryption, iv);
  const body = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return Buffer.concat([Buffer.from([KEY_VERSION]), iv, cipher.getAuthTag(), body]);
}

/** Deterministic 32-byte HMAC so duplicates can be found without decrypting. */
export function fingerprint(value: string): Buffer {
  return createHmac("sha256", keys().fingerprint).update(value).digest();
}
