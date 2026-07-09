import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

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

function deriveKey(encryptionKey: string): Buffer {
  if (encryptionKey.length === KEY_LENGTH) {
    return Buffer.from(encryptionKey, "utf8");
  }
  const buf = Buffer.from(encryptionKey, "hex");
  if (buf.length === KEY_LENGTH) {
    return buf;
  }
  throw new Error(
    `ENCRYPTION_KEY must be ${KEY_LENGTH} bytes as UTF-8 string or ${KEY_LENGTH * 2} hex characters. Received ${encryptionKey.length} characters.`,
  );
}
