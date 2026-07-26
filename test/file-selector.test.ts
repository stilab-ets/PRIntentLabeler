import { describe, it, expect } from "vitest";
import {
  classifyFileRole,
  determineContentPolicy,
  inferPreferredFileRoles,
  shouldIgnoreFile,
  scoreFile,
  rankFilesByImportance,
  selectRepresentativeFiles,
  tokenizeText,
} from "../src/llm/file-selector.js";
import type { PullRequestFileData } from "../src/domain/pull-request-data.js";

function file(
  filename: string,
  overrides: Partial<PullRequestFileData> = {},
): PullRequestFileData {
  return {
    filename,
    status: "modified",
    additions: 5,
    deletions: 0,
    changes: 5,
    ...overrides,
  };
}

describe("tokenizeText", () => {
  it("produit les mêmes tokens pour camelCase, snake_case et kebab-case", () => {
    expect(tokenizeText("userService")).toEqual(new Set(["user", "service"]));
    expect(tokenizeText("user_service")).toEqual(new Set(["user", "service"]));
    expect(tokenizeText("user-service")).toEqual(new Set(["user", "service"]));
  });

  it("enlève les accents", () => {
    expect(tokenizeText("Sécurité")).toEqual(new Set(["securite"]));
  });

  it("ignore les tokens numériques et trop courts", () => {
    expect(tokenizeText("v2 id fix 123")).toEqual(new Set());
  });

  it("ignore les mots-outils génériques", () => {
    expect(tokenizeText("fix the bug with tests")).toEqual(new Set());
  });
});

describe("shouldIgnoreFile / classifyFileRole", () => {
  it("classe un lockfile comme dependency, pas comme generated", () => {
    expect(shouldIgnoreFile("package-lock.json")).toBe(false);
    expect(classifyFileRole("package-lock.json")).toBe("dependency");
  });

  it("classe un manifeste de dépendances comme dependency", () => {
    expect(classifyFileRole("package.json")).toBe("dependency");
    expect(classifyFileRole("pom.xml")).toBe("dependency");
  });

  it("ignore les fichiers dans dist/", () => {
    expect(shouldIgnoreFile("dist/bundle.js")).toBe(true);
    expect(classifyFileRole("dist/bundle.js")).toBe("generated");
  });

  it("ne confond pas un répertoire source build avec un artefact généré", () => {
    expect(shouldIgnoreFile("src/build/create-bundle.ts")).toBe(false);
  });

  it("ignore les images", () => {
    expect(shouldIgnoreFile("image.png")).toBe(true);
  });

  it("ignore les fichiers minifiés", () => {
    expect(shouldIgnoreFile("file.min.js")).toBe(true);
  });

  it("ignore les source maps", () => {
    expect(shouldIgnoreFile("file.map")).toBe(true);
  });

  it("classe les sources générées (.generated., .pb.go, .g.cs, generated/) comme generated", () => {
    expect(classifyFileRole("src/generated/api.pb.go")).toBe("generated");
    expect(classifyFileRole("src/models/user.generated.ts")).toBe("generated");
    expect(classifyFileRole("src/Client.g.cs")).toBe("generated");
    expect(classifyFileRole("src/__generated__/schema.ts")).toBe("generated");
  });

  it("ne pas ignorer le code source", () => {
    expect(shouldIgnoreFile("src/auth/login.ts")).toBe(false);
  });

  it("ne pas ignorer les fichiers de test", () => {
    expect(shouldIgnoreFile("tests/login.spec.ts")).toBe(false);
  });

  it("ne pas ignorer le README", () => {
    expect(shouldIgnoreFile("README.md")).toBe(false);
  });

  it("conserve les SVG textuels comme preuve visuelle potentielle", () => {
    expect(shouldIgnoreFile("src/icons/new-action.svg")).toBe(false);
    expect(classifyFileRole("src/icons/new-action.svg")).toBe("asset");
  });
});

describe("determineContentPolicy", () => {
  it("un manifeste de dépendances peut envoyer son patch", () => {
    expect(determineContentPolicy("package.json", "dependency")).toBe(
      "include-patch",
    );
  });

  it("un lockfile ne peut jamais envoyer son patch", () => {
    expect(determineContentPolicy("package-lock.json", "dependency")).toBe(
      "summary-only",
    );
    expect(determineContentPolicy("yarn.lock", "dependency")).toBe(
      "summary-only",
    );
  });

  it("un snapshot ne peut jamais envoyer son patch", () => {
    expect(
      determineContentPolicy("src/__snapshots__/a.snap", "test"),
    ).toBe("summary-only");
    expect(determineContentPolicy("feature.snap", "test")).toBe(
      "summary-only",
    );
  });

  it("un fichier de test normal peut envoyer son patch", () => {
    expect(determineContentPolicy("src/a.test.ts", "test")).toBe(
      "include-patch",
    );
  });

  it("un fichier généré ne peut jamais envoyer son patch", () => {
    expect(
      determineContentPolicy("src/generated/api.pb.go", "generated"),
    ).toBe("summary-only");
  });
});

describe("scoreFile / rankFilesByImportance", () => {
  it("score un fichier source auth plus haut qu'un README normal", () => {
    const source = scoreFile(file("src/auth/login.ts"));
    const readme = scoreFile(file("README.md"));
    expect(source).toBeGreaterThan(readme);
  });

  it("n'accorde jamais le bonus sécurité sans confirmation de la PR (faux signal)", () => {
    const author = rankFilesByImportance([file("src/author.ts")])[0];
    const feedback = rankFilesByImportance([file("src/feedback.ts")])[0];
    const inventory = rankFilesByImportance([file("src/inventory.ts")])[0];
    const cache = rankFilesByImportance([file("src/cacheManager.ts")])[0];

    expect(author.reasons).not.toContain("security signal");
    expect(feedback.role).toBe("source");
    expect(inventory.role).toBe("source");
    expect(cache.reasons).not.toContain("performance signal");
  });

  it("accorde le bonus sécurité seulement si le chemin ET la PR en parlent", () => {
    const withoutContext = rankFilesByImportance([
      file("src/authService.ts"),
    ])[0];
    const withContext = rankFilesByImportance(
      [file("src/authService.ts")],
      { title: "fix jwt timeout in login" },
    )[0];

    expect(withoutContext.reasons).not.toContain("security signal");
    expect(withContext.reasons).toContain("security signal");
  });

  it("accorde le bonus performance seulement si le chemin ET la PR en parlent", () => {
    const withContext = rankFilesByImportance(
      [file("src/cacheManager.ts")],
      { title: "improve cache performance" },
    )[0];
    expect(withContext.reasons).toContain("performance signal");
  });

  it("donne un score pertinent à un workflow CI/CD", () => {
    const ranked = rankFilesByImportance([file(".github/workflows/ci.yml")]);
    expect(ranked[0].score).toBeGreaterThan(0);
    expect(ranked[0].role).toBe("ci-cd");
    expect(ranked[0].reasons).toContain("ci-cd role");
  });

  it("un lockfile a le rôle dependency et la politique summary-only, jamais un score négatif au seul motif d'être un lockfile", () => {
    const ranked = rankFilesByImportance([file("package-lock.json")]);
    expect(ranked[0].role).toBe("dependency");
    expect(ranked[0].contentPolicy).toBe("summary-only");
    expect(ranked[0].score).toBeGreaterThan(0);
  });

  it("un fichier généré/binaire a un score bas et n'est jamais sélectionnable", () => {
    const ranked = rankFilesByImportance([file("dist/bundle.js")]);
    expect(ranked[0].role).toBe("generated");
    expect(ranked[0].contentPolicy).toBe("summary-only");
  });

  it("trie les fichiers par score décroissant", () => {
    const ranked = rankFilesByImportance([
      file("README.md"),
      file("src/auth/login.ts"),
      file("dist/bundle.js"),
    ]);
    const scores = ranked.map((r) => r.score);
    const sorted = [...scores].sort((a, b) => b - a);
    expect(scores).toEqual(sorted);
    expect(ranked[0].file.filename).toBe("src/auth/login.ts");
  });

  it("utilise le nom comme départage déterministe à score égal", () => {
    const ranked = rankFilesByImportance([file("src/b.ts"), file("src/a.ts")]);

    expect(ranked.map((entry) => entry.file.filename)).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });

  it("attribue un rôle test exclusif même lorsque le test est sous src/", () => {
    const ranked = rankFilesByImportance([
      file("src/auth/login.ts", { changes: 50, patch: "+code" }),
      file("src/auth/login.test.ts", { changes: 50, patch: "+test" }),
    ]);

    expect(ranked[0].role).toBe("source");
    expect(ranked[1].role).toBe("test");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
  });

  it("reconnaît les conventions de tests Go et Python", () => {
    expect(classifyFileRole("pkg/events/broadcaster_test.go")).toBe("test");
    expect(classifyFileRole("module/test_parser.py")).toBe("test");
  });

  it("booste un fichier dont le chemin matche le titre de la PR, plus que la description seule", () => {
    const without = scoreFile(file("src/billing/invoice.ts"));
    const withTitle = scoreFile(file("src/billing/invoice.ts"), {
      title: "fix invoice rounding",
    });
    const withBody = scoreFile(file("src/billing/invoice.ts"), {
      body: "this changes invoice rounding",
    });
    expect(withTitle).toBeGreaterThan(without);
    expect(withBody).toBeGreaterThan(without);
    expect(withTitle).toBeGreaterThan(withBody);
  });

  it("ne cumule jamais le bonus titre et le bonus description pour le même fichier", () => {
    const withBoth = scoreFile(file("src/billing/invoice.ts"), {
      title: "fix invoice rounding",
      body: "invoice invoice invoice",
    });
    const withTitleOnly = scoreFile(file("src/billing/invoice.ts"), {
      title: "fix invoice rounding",
    });
    expect(withBoth).toBe(withTitleOnly);
  });

  it("le statut modified ne donne aucun bonus, added et removed donnent +1", () => {
    const modified = scoreFile(file("src/a.ts", { status: "modified" }));
    const added = scoreFile(file("src/a.ts", { status: "added" }));
    const removed = scoreFile(file("src/a.ts", { status: "removed" }));
    const renamed = scoreFile(file("src/a.ts", { status: "renamed" }));

    expect(added).toBe(modified + 1);
    expect(removed).toBe(modified + 1);
    expect(renamed).toBe(modified);
  });

  it("déduit le rôle préféré seulement des scopes Conventional Commits explicites", () => {
    expect(inferPreferredFileRoles("docs(api): clarify hooks")).toEqual([
      "documentation",
    ]);
    expect(inferPreferredFileRoles("chore(deps): bump vite")).toEqual([
      "dependency",
    ]);
    expect(inferPreferredFileRoles("test: stabilize fixture")).toEqual([
      "test",
    ]);
    expect(inferPreferredFileRoles("ci: cache node_modules")).toEqual([
      "ci-cd",
    ]);
  });

  it("ne présume plus un rôle préféré pour feat/fix/refactor/perf sans scope explicite", () => {
    expect(inferPreferredFileRoles("feat(docker): add image target")).toEqual(
      [],
    );
    expect(inferPreferredFileRoles("fix: correct rounding")).toEqual([]);
    expect(inferPreferredFileRoles("perf: speed up parsing")).toEqual([]);
  });

  it("utilise le titre comme signal renforçant le rôle préféré explicite", () => {
    const ranked = rankFilesByImportance(
      [
        file("src/generator.ts", { changes: 10, patch: "+source" }),
        file("docs/guide.md", { changes: 10, patch: "+docs" }),
      ],
      { title: "docs: regenerate guide" },
    );

    const selected = selectRepresentativeFiles(
      ranked,
      2,
      inferPreferredFileRoles("docs: regenerate guide"),
    );
    expect(selected[0].role).toBe("documentation");
    expect(selected[1].role).toBe("source");
  });

  it("diversifie la sélection au lieu de retenir uniquement des tests", () => {
    const ranked = rankFilesByImportance([
      file("src/feature.ts", { changes: 80, patch: "+source" }),
      file("src/feature.test.ts", { changes: 80, patch: "+test 1" }),
      file("src/feature-edge.test.ts", { changes: 80, patch: "+test 2" }),
      file("src/__snapshots__/feature.snap", {
        changes: 80,
        patch: "+snapshot",
      }),
      file("docs/feature.md", { changes: 30, patch: "+docs" }),
    ]);

    const selected = selectRepresentativeFiles(ranked, 3);
    expect(selected[0].file.filename).toBe("src/feature.ts");
    expect(selected.map((entry) => entry.role)).toContain("documentation");
    expect(selected.filter((entry) => entry.role === "test")).toHaveLength(1);
    // Le snapshot ne doit jamais consommer une place, quel que soit son score.
    expect(selected.map((entry) => entry.file.filename)).not.toContain(
      "src/__snapshots__/feature.snap",
    );
  });

  it("un package.json et un package-lock.json ont le même rôle mais pas la même politique", () => {
    const ranked = rankFilesByImportance([
      file("package.json", { patch: "+dep" }),
      file("package-lock.json", { patch: "+huge lockfile diff", changes: 500 }),
    ]);

    const manifest = ranked.find((r) => r.file.filename === "package.json");
    const lockfile = ranked.find(
      (r) => r.file.filename === "package-lock.json",
    );
    expect(manifest?.role).toBe("dependency");
    expect(lockfile?.role).toBe("dependency");
    expect(manifest?.contentPolicy).toBe("include-patch");
    expect(lockfile?.contentPolicy).toBe("summary-only");

    const selected = selectRepresentativeFiles(ranked, 6);
    expect(selected.map((entry) => entry.file.filename)).toContain(
      "package.json",
    );
    expect(selected.map((entry) => entry.file.filename)).not.toContain(
      "package-lock.json",
    );
  });

  it("un fichier source sans patch disponible n'est jamais sélectionné", () => {
    const ranked = rankFilesByImportance([
      file("src/no-diff.ts"),
      file("src/with-diff.ts", { patch: "+code", changes: 10 }),
    ]);

    const selected = selectRepresentativeFiles(ranked, 5);
    expect(selected.map((entry) => entry.file.filename)).toEqual([
      "src/with-diff.ts",
    ]);
  });

  it("une PR ne contenant qu'un package-lock.json reste reconnue comme un signal dependency", () => {
    const ranked = rankFilesByImportance([
      file("package-lock.json", { patch: "+huge lockfile diff", changes: 500 }),
    ]);
    expect(ranked[0].role).toBe("dependency");
    const selected = selectRepresentativeFiles(ranked, 6);
    expect(selected).toHaveLength(0);
  });
});
