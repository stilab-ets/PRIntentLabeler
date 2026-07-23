import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type EncryptedApiKey = {
  ciphertext: string;
  iv: string;
  authTag: string;
};

export class ApiKeyCipher {
  private readonly key: Buffer;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key.trim(), "base64");
    if (this.key.length !== 32) {
      throw new Error(
        "CONFIG_ENCRYPTION_KEY doit contenir exactement 32 octets encodés en base64.",
      );
    }
  }

  encrypt(value: string): EncryptedApiKey {
    if (!value.trim()) throw new Error("La clé API ne peut pas être vide.");

    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);

    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
    };
  }

  decrypt(encrypted: EncryptedApiKey): string {
    try {
      const decipher = createDecipheriv(
        "aes-256-gcm",
        this.key,
        Buffer.from(encrypted.iv, "base64"),
      );
      decipher.setAuthTag(Buffer.from(encrypted.authTag, "base64"));
      return Buffer.concat([
        decipher.update(Buffer.from(encrypted.ciphertext, "base64")),
        decipher.final(),
      ]).toString("utf8");
    } catch {
      throw new Error("Impossible de déchiffrer la clé API enregistrée.");
    }
  }
}

export function getApiKeySuffix(apiKey: string): string {
  return apiKey.trim().slice(-4);
}
