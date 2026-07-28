import { describe, expect, it } from "vitest";
import {
  ApiKeyCipher,
  getApiKeySuffix,
} from "../src/security/api-key-cipher.js";

const ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");

describe("ApiKeyCipher", () => {
  it("chiffre puis déchiffre une clé sans la conserver en clair", () => {
    const cipher = new ApiKeyCipher(ENCRYPTION_KEY);
    const encrypted = cipher.encrypt("sk-test-secret-value");

    expect(encrypted.ciphertext).not.toContain("sk-test-secret-value");
    expect(cipher.decrypt(encrypted)).toBe("sk-test-secret-value");
  });

  it("produit un IV différent pour deux chiffrements identiques", () => {
    const cipher = new ApiKeyCipher(ENCRYPTION_KEY);
    const first = cipher.encrypt("same-key");
    const second = cipher.encrypt("same-key");

    expect(first.iv).not.toBe(second.iv);
    expect(first.ciphertext).not.toBe(second.ciphertext);
  });

  it("refuse une clé maîtresse de longueur invalide", () => {
    expect(() => new ApiKeyCipher(Buffer.alloc(16).toString("base64"))).toThrow(
      "32 octets",
    );
  });

  it("refuse une valeur chiffrée altérée", () => {
    const cipher = new ApiKeyCipher(ENCRYPTION_KEY);
    const encrypted = cipher.encrypt("secret");

    expect(() =>
      cipher.decrypt({
        ...encrypted,
        authTag: Buffer.alloc(16).toString("base64"),
      }),
    ).toThrow("Impossible de déchiffrer");
  });

  it("retient seulement les quatre derniers caractères pour l’affichage", () => {
    expect(getApiKeySuffix("sk-example-1234")).toBe("1234");
  });
});
