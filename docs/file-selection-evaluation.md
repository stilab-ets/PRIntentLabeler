# Évaluation de la sélection de fichiers

Ce jeu réduit sert de test manuel rapide avant l'évaluation annotée à grande
échelle prévue à l'itération 3. Il couvre des intentions et des structures de
diff différentes. Les labels indiqués sont ceux observés dans les dépôts
sources; ils ne sont pas copiés dans le prompt envoyé par l'application.

| PR publique                                                                | Intention observée          | Cas utile pour la sélection                                           |
| -------------------------------------------------------------------------- | --------------------------- | --------------------------------------------------------------------- |
| [VS Code #307461](https://github.com/microsoft/vscode/pull/307461)         | Bug                         | Un seul fichier source ciblé                                          |
| [Kubernetes #140407](https://github.com/kubernetes/kubernetes/pull/140407) | Bug et performance          | Code Go accompagné d'un test `_test.go`                               |
| [Vite #22940](https://github.com/vitejs/vite/pull/22940)                   | Documentation               | Plusieurs fichiers de documentation                                   |
| [Vite #21270](https://github.com/vitejs/vite/pull/21270)                   | Documentation               | Documentation générée avec scripts et configuration de soutien        |
| [Vite #18510](https://github.com/vitejs/vite/pull/18510)                   | Fonctionnalité              | Code principal entouré de tests, snapshots, fixtures et documentation |
| [Vite #22677](https://github.com/vitejs/vite/pull/22677)                   | Dépendance                  | Manifeste utile et lockfile ignoré                                    |
| [Node.js #64521](https://github.com/nodejs/node/pull/64521)                | Test / test instable        | Changement limité à une fixture de test                               |
| [Kubernetes #139018](https://github.com/kubernetes/kubernetes/pull/139018) | Nettoyage / refactorisation | Changement transversal composé uniquement de fichiers de test         |

## Défaut corrigé

Avec l'ancien score, la PR Vite #18510 sélectionnait quatre fichiers de test
avant `packages/vite/src/node/plugins/importMetaGlob.ts`. Un fichier situé sous
`src/` et reconnu comme test cumulait les points des deux catégories.

La version actuelle attribue un rôle exclusif et sélectionne d'abord le fichier
source principal, puis des preuves complémentaires de rôles différents. Sur ce
cas, le contexte contient le code principal, la déclaration de type, la
documentation et des tests représentatifs, sans sélectionner le snapshot.

Le classement utilise aussi des mots entiers extraits des chemins et des noms
camelCase. Ainsi, `authService.ts` conserve le signal de sécurité, mais
`author.ts` ne le reçoit pas. Les égalités de score sont départagées par nom de
fichier et le volume total des patches est vérifié avec une estimation explicite
du nombre de tokens.

## Commande de reproduction

```bash
npm run evaluate:selection -- \
  https://github.com/microsoft/vscode/pull/307461 \
  https://github.com/kubernetes/kubernetes/pull/140407 \
  https://github.com/vitejs/vite/pull/22940 \
  https://github.com/vitejs/vite/pull/21270 \
  https://github.com/vitejs/vite/pull/18510 \
  https://github.com/vitejs/vite/pull/22677 \
  https://github.com/nodejs/node/pull/64521 \
  https://github.com/kubernetes/kubernetes/pull/139018
```

`GITHUB_TOKEN` est optionnel pour ces dépôts publics, mais recommandé pour une
évaluation plus large afin d'éviter la limite anonyme de l'API GitHub.

Cette vérification mesure la qualité du contexte sélectionné, pas encore la
précision finale du modèle. La précision des labels devra être mesurée sur un
jeu annoté avec exact match, précision, rappel et F1.

## Harness d'ablation annoté

Le harness compare les variantes suivantes avec le même catalogue de labels,
le même modèle, le même system prompt et les mêmes paramètres Groq :

- A : titre seulement;
- B : titre et résumé des rôles;
- C : titre, rôles et diffs sélectionnés par le score;
- D : titre, rôles et diffs admissibles choisis avec une seed fixe.

Le fichier `evaluation/dataset.example.json` décrit le format d'entrée. Une
évaluation réelle nécessite un fichier contenant des PR annotées et la variable
`GROQ_API_KEY` :

```bash
npm run eval:selector -- evaluation/prs-annotees.json \
  --output evaluation/resultats.json \
  --seed 20260726
```

La sortie JSON contient les résultats par PR et par variante, les fichiers
sélectionnés, les jetons estimés et les jetons réels lorsque Groq fournit
`usage`. Elle calcule l'exact-set accuracy, la précision, le rappel, le F1 et le
Jaccard. Si aucun dataset n'est fourni, la commande s'arrête en indiquant que les
données annotées manquent; elle ne génère aucune annotation ni aucun résultat.
