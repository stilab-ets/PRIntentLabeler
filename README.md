# LLM PR Labeler

GitHub App that analyzes Pull Requests and suggests intent labels using a Large Language Model.

Built as part of PFE013 (Projet de fin d'études) at ÉTS Montréal.

## Stack

- TypeScript + Node.js 20+
- Probot (GitHub App framework)
- Octokit (GitHub REST client, via Probot)
- Vitest (testing)

## État actuel

**Itération 2** : intégration LLM via Groq. L'app reçoit les événements PR, filtre/score les fichiers pertinents, envoie un contexte compact au LLM, puis poste un commentaire avec les labels suggérés (nom, confiance, justification).

### Modes d'application des labels

Configurable via la variable d'environnement `LABEL_MODE` :

| `LABEL_MODE`       | Comportement                                                        |
| ------------------ | ------------------------------------------------------------------- |
| `suggest` (défaut) | Publie seulement un commentaire — aucun label appliqué              |
| `auto-high`        | Applique automatiquement les labels au-dessus du seuil de confiance |
| `auto-all`         | Applique tous les labels retenus (plafonnés au max par confiance)   |

Les seuils et le nombre maximum de labels sont centralisés dans `src/utils/constants.ts`.

### Sélection du contexte LLM

Avant l'appel à Groq, chaque fichier reçoit un rôle exclusif (`source`, `test`,
`documentation`, `dependency`, `ci-cd`, etc.) et un score fondé sur son rôle,
son statut, la taille du diff et la disponibilité du patch. Une sélection à
rendement décroissant par rôle et répertoire évite qu'une série de tests,
snapshots ou fixtures masque le fichier source principal. Les signaux de nom
de fichier sont comparés par mots entiers, y compris en camelCase, pour éviter
des faux positifs tels que `author` interprété comme `auth`.

Les patchs sont bornés par un budget global estimé en tokens, puis tronqués en
caractères et en lignes; la description de la PR est également bornée. Les
fichiers, labels et descriptions de labels sont récupérés avec la pagination
Octokit. Dans les dépôts possédant une très grande taxonomie, les labels
d'intention les plus pertinents sont retenus pour éviter de remplir le prompt
avec des labels de taille, d'équipe ou de statut.

Pour inspecter la sélection sans consommer de jetons LLM :

```bash
npm run evaluate:selection -- https://github.com/owner/repo/pull/123
npm run eval:selector -- evaluation/prs-annotees.json --output evaluation/resultats.json
```

L'échantillon public utilisé pour calibrer cette version est documenté dans
[`docs/file-selection-evaluation.md`](docs/file-selection-evaluation.md).

## Installation locale

Prérequis : Node 20+, npm 10+

```bash
npm install
```

Lance le wizard interactif pour créer la GitHub App de développement :

```bash
npm start
```

Au premier lancement, Probot ouvre une page web qui te guide pour créer la GitHub App, générer la clé privée et configurer Smee.io. Le `.env` est généré automatiquement.

## Commandes utiles

| Commande                              | Action                                |
| ------------------------------------- | ------------------------------------- |
| `npm run dev`                         | Démarre en mode watch (TypeScript)    |
| `npm start`                           | Démarre la version compilée           |
| `npm run build`                       | Compile TypeScript vers `lib/`        |
| `npm test`                            | Lance les tests Vitest                |
| `npm run test:coverage`               | Tests avec rapport de couverture      |
| `npm run evaluate:selection -- <URL>` | Inspecte le score sur une PR publique |
| `npm run eval:selector -- <dataset>` | Compare les quatre variantes d'ablation |
| `npm run lint`                        | Vérifie le code avec ESLint           |
| `npm run format`                      | Formate le code avec Prettier         |

## Itérations prévues

- ✅ Itération 1 : Plomberie GitHub
- ✅ Itération 2 : Intégration LLM (Groq) + modes d'application des labels
- ⏳ Itération 3 : Évaluation rigoureuse (100+ PRs)
- ⏳ Itération 4 : `/intent apply`, multi-modèles
- ⏳ Itération 5 : Finalisation, rapport

## Licence

MIT
