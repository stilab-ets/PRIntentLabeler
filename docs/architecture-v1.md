# Architecture — Version 1

## Objectif du projet

Développer une GitHub App qui analyse automatiquement les Pull Requests à leur création ou mise à jour, et suggère des étiquettes correspondant à leur intention via un Large Language Model.

## Vision long terme

```
GitHub Pull Request
  ↓ webhook
GitHub App (TypeScript / Probot)
  ↓
PR Data Extractor
  ↓
LLM Classifier (prompt engineering, sortie JSON validée)
  ↓
Label Policy (filtrage, déduplication)
  ↓
GitHub Comment (avec marker pour upsert)
  ↓
Commande /intent apply → application des labels GitHub natifs
```

## État au moment de cette version (Itération 2)

L'application reçoit les événements GitHub, **filtre et score les fichiers** de la PR, envoie un contexte compact à un LLM (**Groq**), puis publie un commentaire avec les labels suggérés (nom, confiance, justification). Selon `LABEL_MODE`, elle peut aussi **appliquer** les labels automatiquement.

### Modes d'application des labels (`LABEL_MODE`)

| Mode | Comportement |
|---|---|
| `suggest` (défaut) | Commentaire seulement, aucun label appliqué |
| `auto-high` | Applique les labels ≥ `AUTO_APPLY_CONFIDENCE_THRESHOLD` |
| `auto-all` | Applique tous les labels retenus, plafonnés à `MAX_LABELS_TO_APPLY` (triés par confiance) |

Constantes pilotables dans `src/utils/constants.ts`.

## Modules

| Module | Rôle | Statut |
|---|---|---|
| `src/index.ts` | Point d'entrée Probot, écoute les événements PR | ✅ |
| `src/handlers/` | Orchestration de la réception webhook | ✅ |
| `src/github/` | Lecture PR + upsert commentaire via Octokit | ✅ |
| `src/comments/` | Construction du commentaire Markdown | ✅ |
| `src/domain/` | Types internes découplés du payload GitHub brut | ✅ |
| `src/labels/` | Filtrage des suggestions, modes et application des labels | ✅ |
| `src/llm/` | Interface `LlmProvider`, provider Groq, scoring fichiers, prompt | ✅ |

## Décisions techniques clés

### Pourquoi TypeScript + Probot

Le doc PFE recommande Python, mais nous avons choisi TypeScript avec Probot, le framework officiel GitHub pour développer des GitHub Apps. Probot gère automatiquement :

- Authentification par JSON Web Token
- Génération des installation tokens
- Validation cryptographique des signatures de webhooks
- Instanciation d'Octokit authentifié

Cela nous économise plusieurs semaines de plomberie d'intégration GitHub.

### Commentaire et GitHub Check Run

Le commentaire contient le diagnostic détaillé, les fichiers représentatifs et
les cases permettant de gérer les labels suggérés. Une Check Run complète ce
commentaire avec les actions `Suggest only`, `Auto-apply high` et
`Auto-apply all`. Les actions sont refusées lorsque le SHA analysé ne correspond
plus au dernier commit de la PR. L'état invisible du commentaire est signé avec
un HMAC dérivé de `COMMENT_STATE_SECRET` ou, par défaut, du
`WEBHOOK_SECRET`; une modification du bloc stocké invalide l'action.

### Pourquoi un marker HTML invisible

Le commentaire de l'app contient `<!-- llm-pr-labeler -->` comme marqueur HTML. Cela permet à l'app de retrouver son propre commentaire et de le mettre à jour (upsert) plutôt que d'en créer un nouveau à chaque événement. Sans ce marqueur, l'app polluerait la PR avec un commentaire par push.

### Pourquoi des types domaine internes

Les fichiers de `src/domain/` définissent des types internes (`PullRequestData`, `LabelSuggestion`) découplés du payload GitHub brut. Cela permet :

- De tester le code sans dépendre du format Octokit
- De basculer vers un autre fournisseur Git (théorique) sans réécrire la logique
- De typer strictement ce qui est passé au LLM en itération 2

## Roadmap des itérations

| Itération | Objectif | Coïncidence calendrier ÉTS |
|---|---|---|
| 0 | Cadrage, squelette technique, docs | Semaines 1-2 |
| 1 | Plomberie GitHub fonctionnelle, sans LLM | Semaines 3-5 |
| 2 | Intégration LLM (Groq), sortie JSON validée | Semaines 6-8 (rapport d'étape) |
| 3 | Évaluation rigoureuse sur 100+ PRs | Semaines 9-11 |
| 4 | `/intent apply`, comparaison multi-modèles | Semaines 12-13 |
| 5 | Finalisation, rapport, présentation | Semaines 14-15 |

## Sécurité

- Aucune donnée de PR n'est stockée durablement (pas de BD pour le moment)
- Les secrets (`*.pem`, `.env`) sont exclus de Git via `.gitignore`
- Les permissions GitHub App suivent le principe de moindre privilège :
  - `Metadata: Read`
  - `Pull requests: Read`
  - `Issues: Read and write` (pour les commentaires)
- La validation des signatures webhooks est gérée automatiquement par Probot
