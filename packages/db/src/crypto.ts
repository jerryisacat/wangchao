import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const MAX_CREDENTIAL_LENGTH = 8192;
const MIN_ENCRYPTION_KEY_LENGTH = 32;
const STATIC_SALT = "wangchao-credential-salt-v1";

export interface EncryptedCredential {
  salt: string;
  iv: string;
  ciphertext: string;
  tag: string;
}

export function encryptCredential(plaintext: string, encryptionKey: string): string {
  if (Buffer.byteLength(plaintext, "utf8") > MAX_CREDENTIAL_LENGTH) {
    throw new Error("Credential exceeds maximum allowed length");
  }
  const key = deriveKey(encryptionKey);
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    salt.toString("base64"),
    iv.toString("base64"),
    encrypted.toString("base64"),
    tag.toString("base64"),
  ].join(":");
}

export function decryptCredential(encrypted: string, encryptionKey: string): string {
  const parts = encrypted.split(":");
  let salt: Buffer | null = null;
  let ivPart: string;
  let ciphertextPart: string;
  let tagPart: string;

  if (parts.length === 4) {
    const p0 = parts[0]!;
    const p1 = parts[1]!;
    const p2 = parts[2]!;
    const p3 = parts[3]!;
    salt = Buffer.from(p0, "base64");
    ivPart = p1;
    ciphertextPart = p2;
    tagPart = p3;
  } else if (parts.length === 3) {
    const p0 = parts[0]!;
    const p1 = parts[1]!;
    const p2 = parts[2]!;
    ivPart = p0;
    ciphertextPart = p1;
    tagPart = p2;
  } else {
    throw new Error("Invalid encrypted credential format: expected salt:iv:ciphertext:tag or iv:ciphertext:tag");
  }

  if (!ivPart || !ciphertextPart || !tagPart) {
    throw new Error("Invalid encrypted credential format: missing components");
  }

  const key = deriveKey(encryptionKey, salt);
  const iv = Buffer.from(ivPart, "base64");
  const ciphertext = Buffer.from(ciphertextPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

export function maskKeyHint(plaintext: string): string {
  if (plaintext.length < 12) {
    return "***";
  }
  const prefix = plaintext.slice(0, 3);
  const suffix = plaintext.slice(-3);
  return `${prefix}...${suffix}`;
}

export function validateApiKeyFormat(apiKey: string): { valid: boolean; reason?: string } {
  if (apiKey.length < 16) return { valid: false, reason: "API key too short" };
  if (apiKey.length > 2048) return { valid: false, reason: "API key too long" };
  if (apiKey.includes(" ") || apiKey.includes("\n")) return { valid: false, reason: "API key contains whitespace" };
  return { valid: true };
}

export function fingerprintKey(key: string): string {
  return createHash("sha256").update(key).digest("hex").slice(0, 8);
}

export function cryptoSmokeTest(): void {
  const testKey = "a".repeat(MIN_ENCRYPTION_KEY_LENGTH);
  const testPlaintext = "wangchao-smoke-test-plaintext";
  const encrypted = encryptCredential(testPlaintext, testKey);
  const decrypted = decryptCredential(encrypted, testKey);
  if (decrypted !== testPlaintext) {
    throw new Error("Crypto smoke test failed: decrypted text does not match original");
  }
}

function deriveKey(encryptionKey: string, salt?: Buffer | null): Buffer {
  if (Buffer.byteLength(encryptionKey, "utf8") < MIN_ENCRYPTION_KEY_LENGTH) {
    throw new Error("Encryption key is too short");
  }
  const effectiveSalt = salt ?? STATIC_SALT;
  return scryptSync(encryptionKey, effectiveSalt, KEY_LENGTH);
}
