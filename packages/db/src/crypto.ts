import { createCipheriv, createDecipheriv, randomBytes, scryptSync, createHash } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const TAG_LENGTH = 16;
const SALT_LENGTH = 16;
const MAX_CREDENTIAL_LENGTH = 8192;
const MIN_ENCRYPTION_KEY_LENGTH = 32;
const STATIC_SALT = "wangchao-credential-salt-v1";

/**
 * Maximum allowed length of the encrypted credential string (in UTF-8 bytes).
 *
 * Plaintext is capped at MAX_CREDENTIAL_LENGTH (8192) bytes. Base64 encoding
 * expands by 4/3, so 8192 * 4/3 ≈ 10923 bytes. Adding three metadata segments
 * (salt 16B → 24 chars base64, iv 12B → 16 chars, tag 16B → 24 chars) and
 * three delimiters gives ≈ 10990 bytes. 16384 provides a conservative ceiling
 * well above any legitimate payload while preventing unbounded input from
 * reaching the base64 decoder or KDF.
 */
const MAX_ENCRYPTED_CREDENTIAL_LENGTH = 16384;

const DECRYPTION_FAILED_ERROR = "Credential decryption failed";

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
  const salt = randomBytes(SALT_LENGTH);
  const key = deriveKey(encryptionKey, salt);
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
  // I3: Reject oversized payloads before any base64 decode or KDF.
  if (Buffer.byteLength(encrypted, "utf8") > MAX_ENCRYPTED_CREDENTIAL_LENGTH) {
    throw new Error("Encrypted credential exceeds maximum allowed length");
  }

  const parts = encrypted.split(":");
  let ivPart: string;
  let ciphertextPart: string;
  let tagPart: string;

  if (parts.length === 4) {
    const p0 = parts[0]!;
    const p1 = parts[1]!;
    const p2 = parts[2]!;
    const p3 = parts[3]!;

    const salt = decodeBase64Strict(p0, "salt");
    ivPart = p1;
    ciphertextPart = p2;
    tagPart = p3;

    if (!ivPart || !ciphertextPart || !tagPart) {
      throw new Error("Invalid encrypted credential format: missing components");
    }

    const iv = decodeBase64Strict(ivPart, "iv");
    const ciphertext = decodeBase64Strict(ciphertextPart, "ciphertext");
    const tag = decodeBase64Strict(tagPart, "tag");

    // 4-part format: validate salt, iv, tag lengths.
    if (salt.length !== SALT_LENGTH) {
      throw new Error(`Invalid salt length: expected ${SALT_LENGTH} bytes, got ${salt.length}`);
    }
    if (iv.length !== IV_LENGTH) {
      throw new Error(`Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}`);
    }
    if (tag.length !== TAG_LENGTH) {
      throw new Error(`Invalid tag length: expected ${TAG_LENGTH} bytes, got ${tag.length}`);
    }
    if (ciphertext.length === 0) {
      throw new Error("Invalid ciphertext: must not be empty");
    }

    // I1: Derive key and set up decipher OUTSIDE the catch, so that
    // configuration/programming errors (bad key length, etc.) propagate
    // normally. Only `decipher.final()` is wrapped — after pre-validation,
    // its failure means auth tag verification did not pass.
    const storedSaltResult = tryAuthenticatedDecrypt(encryptionKey, salt, iv, ciphertext, tag);
    if (storedSaltResult.ok) {
      return storedSaltResult.plaintext;
    }

    // Stored salt auth failed; try STATIC_SALT for legacy bug records only.
    // This fallback ONLY applies to old buggy records where the key was
    // derived with STATIC_SALT instead of the stored random salt. New
    // records derive the key with the same random salt, so they succeed on
    // the first attempt. No automatic migration occurs; old records upgrade
    // only when re-saved.
    const staticSaltResult = tryAuthenticatedDecrypt(
      encryptionKey,
      Buffer.from(STATIC_SALT, "utf8"),
      iv,
      ciphertext,
      tag,
    );
    if (staticSaltResult.ok) {
      return staticSaltResult.plaintext;
    }

    // I2: Both salt paths failed authentication. Throw a fixed, stable error
    // that does not leak Node/OpenSSL internals.
    throw new Error(DECRYPTION_FAILED_ERROR);
  }

  if (parts.length === 3) {
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

  const iv = decodeBase64Strict(ivPart, "iv");
  const ciphertext = decodeBase64Strict(ciphertextPart, "ciphertext");
  const tag = decodeBase64Strict(tagPart, "tag");

  // 3-part format: validate iv, tag lengths.
  if (iv.length !== IV_LENGTH) {
    throw new Error(`Invalid IV length: expected ${IV_LENGTH} bytes, got ${iv.length}`);
  }
  if (tag.length !== TAG_LENGTH) {
    throw new Error(`Invalid tag length: expected ${TAG_LENGTH} bytes, got ${tag.length}`);
  }
  if (ciphertext.length === 0) {
    throw new Error("Invalid ciphertext: must not be empty");
  }

  // I1: 3-part legacy format uses STATIC_SALT for key derivation. Use the
  // narrow authenticated decrypt helper; if auth fails, throw the same
  // stable error as the 4-part path.
  const result = tryAuthenticatedDecrypt(
    encryptionKey,
    Buffer.from(STATIC_SALT, "utf8"),
    iv,
    ciphertext,
    tag,
  );
  if (result.ok) {
    return result.plaintext;
  }
  throw new Error(DECRYPTION_FAILED_ERROR);
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

/**
 * Decode a base64 string strictly: the input must be canonical base64 with
 * no invalid characters. Node's Buffer.from(x, 'base64') is lenient and
 * silently ignores garbage characters, so we verify round-trip equality.
 */
function decodeBase64Strict(input: string, componentName: string): Buffer {
  const decoded = Buffer.from(input, "base64");
  // Round-trip check: re-encoding the decoded buffer must produce the exact
  // original string. If it doesn't, the input was not canonical base64.
  if (decoded.toString("base64") !== input) {
    throw new Error(`Invalid ${componentName}: not canonical base64`);
  }
  return decoded;
}

/**
 * I1: Narrow authenticated decrypt helper.
 *
 * Derives the key, creates the decipher, sets the auth tag, and calls
 * `update()` OUTSIDE the try/catch. Only `decipher.final()` is wrapped.
 * After component length/base64 pre-validation, the only reason `final()`
 * can fail is AES-GCM auth tag mismatch — which is exactly the failure
 * we want to catch and report as a discriminated result (not an exception).
 *
 * Configuration errors (bad key length, invalid salt type, etc.) are NOT
 * caught here; they propagate to the caller with their original message.
 */
function tryAuthenticatedDecrypt(
  encryptionKey: string,
  salt: Buffer,
  iv: Buffer,
  ciphertext: Buffer,
  tag: Buffer,
): { ok: true; plaintext: string } | { ok: false } {
  const key = deriveKey(encryptionKey, salt);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);
  const updated = decipher.update(ciphertext);
  try {
    const final = decipher.final();
    return { ok: true, plaintext: Buffer.concat([updated, final]).toString("utf8") };
  } catch {
    return { ok: false };
  }
}
