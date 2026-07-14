import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;

export interface EncryptedCredential {
  iv: string;
  ciphertext: string;
  tag: string;
}

export function encryptCredential(plaintext: string, encryptionKey: string): string {
  const key = deriveKey(encryptionKey);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [iv.toString("base64"), encrypted.toString("base64"), tag.toString("base64")].join(":");
}

export function decryptCredential(encrypted: string, encryptionKey: string): string {
  const key = deriveKey(encryptionKey);
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted credential format: expected iv:ciphertext:tag");
  }
  const [ivPart, ciphertextPart, tagPart] = parts;
  if (!ivPart || !ciphertextPart || !tagPart) {
    throw new Error("Invalid encrypted credential format: expected iv:ciphertext:tag");
  }
  const iv = Buffer.from(ivPart, "base64");
  const ciphertext = Buffer.from(ciphertextPart, "base64");
  const tag = Buffer.from(tagPart, "base64");
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

export function maskKeyHint(plaintext: string): string {
  if (plaintext.length <= 8) {
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

export function fingerprintKey(apiKey: string): string {
  return createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
}

function deriveKey(encryptionKey: string): Buffer {
  return scryptSync(encryptionKey, "wangchao-credential-salt-v1", 32);
}
