import { describe, it, expect } from "vitest";
import {
  isAiLabelName,
  toAiLabelName,
  stripAiLabelName,
} from "../src/labels/ai-label-name.js";

describe("ai-label-name", () => {
  it("préfixe un nom brut", () => {
    expect(toAiLabelName("bug")).toBe("🤖 bug");
  });

  it("ne double pas le préfixe si déjà présent", () => {
    expect(toAiLabelName("🤖 bug")).toBe("🤖 bug");
  });

  it("détecte un nom déjà préfixé", () => {
    expect(isAiLabelName("🤖 bug")).toBe(true);
    expect(isAiLabelName("bug")).toBe(false);
  });

  it("retire le préfixe d'un nom préfixé", () => {
    expect(stripAiLabelName("🤖 bug")).toBe("bug");
  });

  it("laisse un nom brut inchangé", () => {
    expect(stripAiLabelName("bug")).toBe("bug");
  });
});
