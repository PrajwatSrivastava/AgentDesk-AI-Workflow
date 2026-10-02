import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "./env";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;
const FORMAT = "v3";

/** Both fields are bound into the ciphertext. */
export interface SecretOwner {
  userId: string;
  app: string;
}

export function keyFromHex(hex: string): Buffer {
  const material = Buffer.from(hex, "hex");
  if (material.length !== 32) {
    throw new Error(
      "ENCRYPTION_KEY must be 64 hex characters (32 bytes). Generate one with: npm run keygen",
    );
  }
  return material;
}

// GCM additional data. A secret copied to another user's or app's row won't decrypt.
function context({ userId, app }: SecretOwner): Buffer {
  return Buffer.from(`connection:${userId}:${app}`, "utf8");
}

/** Returns `v3.iv.tag.ciphertext`, all base64url. */
export function encryptSecret(
  owner: SecretOwner,
  plaintext: string,
  key = keyFromHex(env.encryptionKey),
): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  cipher.setAAD(context(owner));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const parts = [iv, cipher.getAuthTag(), ciphertext].map((part) => part.toString("base64url"));
  return [FORMAT, ...parts].join(".");
}

export function decryptSecret(
  owner: SecretOwner,
  payload: string,
  key = keyFromHex(env.encryptionKey),
): string {
  const [format, ivPart, tagPart, dataPart] = payload.split(".");
  if (format !== FORMAT || !ivPart || !tagPart || !dataPart) {
    throw new Error("Stored secret is in an older format; run the multi-user migration");
  }

  // Pin the tag length, otherwise GCM accepts truncated tags and forgery gets easier.
  const tag = Buffer.from(tagPart, "base64url");
  if (tag.length !== TAG_BYTES) throw new Error("Stored secret has a malformed auth tag");
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivPart, "base64url"), {
    authTagLength: TAG_BYTES,
  });
  decipher.setAAD(context(owner));
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(Buffer.from(dataPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 8) return "••••••••";
  return `${plaintext.slice(0, 4)}••••${plaintext.slice(-4)}`;
}

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}
