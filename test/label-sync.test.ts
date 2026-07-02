import { describe, it, expect } from "vitest";
import { computeLabelChanges } from "../src/labels/label-sync.js";

describe("computeLabelChanges", () => {
  const suggested = ["bug", "tests", "feature"];

  it("ajoute les labels cochés absents de la PR", () => {
    const { toAdd, toRemove } = computeLabelChanges(
      suggested,
      ["bug", "tests"],
      [],
    );
    expect(toAdd).toEqual(["bug", "tests"]);
    expect(toRemove).toEqual([]);
  });

  it("retire les labels suggérés décochés mais présents sur la PR", () => {
    const { toAdd, toRemove } = computeLabelChanges(
      suggested,
      ["bug"],
      ["bug", "tests"],
    );
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual(["tests"]);
  });

  it("ne touche pas aux labels hors périmètre suggéré", () => {
    const { toAdd, toRemove } = computeLabelChanges(
      suggested,
      ["bug"],
      ["bug", "wontfix"],
    );
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual([]);
  });

  it("combine ajout et retrait", () => {
    const { toAdd, toRemove } = computeLabelChanges(
      suggested,
      ["feature"],
      ["bug"],
    );
    expect(toAdd).toEqual(["feature"]);
    expect(toRemove).toEqual(["bug"]);
  });

  it("reconnaît un label présent sous sa forme préfixée 🤖 et retourne le nom exact à retirer", () => {
    const { toAdd, toRemove } = computeLabelChanges(
      suggested,
      ["bug"],
      ["🤖 bug", "🤖 tests"],
    );
    expect(toAdd).toEqual([]);
    expect(toRemove).toEqual(["🤖 tests"]);
  });
});
