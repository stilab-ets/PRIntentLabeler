# LLM PR Labeler

GitHub App qui analyse les Pull Requests et propose des labels d'intention à
l'aide d'un grand modèle de langage (LLM).

Projet réalisé dans le cadre du PFE013 (Projet de fin d'études) à l'ÉTS
Montréal.

## Fonctionnement

Lorsqu'une Pull Request est ouverte, modifiée ou synchronisée, l'application :

1. récupère les fichiers modifiés et les labels disponibles;
2. filtre et classe les fichiers selon leur pertinence;
3. construit un contexte compact respectant un budget de jetons;
4. analyse la PR avec le fournisseur LLM configuré pour l'installation;
5. publie ou met à jour un commentaire avec les labels proposés, leur niveau
   de confiance et une justification;
6. applique éventuellement les labels selon le mode configuré.

## Stack

- TypeScript et Node.js 20+
- Probot
- Octokit, par l'intermédiaire de Probot
- PostgreSQL
- Vitest
- Docker Compose pour la base de données locale

## Fonctionnalités principales

- sélection et scoring des fichiers pertinents;
- contexte LLM borné en taille et estimé en jetons;
- pagination des fichiers et des labels GitHub;
- prise en charge de plusieurs fournisseurs LLM;
- configuration distincte pour chaque installation GitHub;
- test de la connexion avant l'enregistrement;
- chiffrement des clés API avec AES-256-GCM;
- modification, rotation et suppression d'une configuration;
- commentaire de PR mis à jour sans duplication;
- modes manuel et automatique d'application des labels.

## Fournisseurs LLM

Chaque installation GitHub peut choisir son fournisseur, son modèle et sa
propre clé API.

| Fournisseur           | Exemple de modèle           |
| --------------------- | --------------------------- |
| Groq                  | `llama-3.1-8b-instant`      |
| OpenAI                | `gpt-5-mini`                |
| Anthropic             | `claude-haiku-4-5-20251001` |
| Google Gemini         | `gemini-3.1-flash-lite`     |
| xAI                   | `grok-4.5`                  |
| Perplexity            | `sonar`                     |
| API compatible OpenAI | modèle et URL personnalisés |

Les modèles disponibles et leur tarification évoluent. L'identifiant du modèle
peut être saisi manuellement dans l'interface. Gemini et Groq proposent
notamment des paliers gratuits avec des quotas limités.

Si aucune configuration n'est enregistrée pour une installation,
`GROQ_API_KEY` et `GROQ_MODEL` peuvent servir de configuration de repli du
serveur.

Le fonctionnement détaillé est documenté dans
[`docs/llm-provider-configuration.md`](docs/llm-provider-configuration.md).

## Modes d'application des labels

Le comportement est défini par la variable `LABEL_MODE`.

| Valeur      | Comportement                                                 |
| ----------- | ------------------------------------------------------------ |
| `suggest`   | Publie seulement un commentaire. Aucun label n'est appliqué. |
| `auto-high` | Applique les labels qui dépassent le seuil de confiance.     |
| `auto-all`  | Applique tous les labels retenus, dans la limite configurée. |

Le mode par défaut est `suggest`. Les seuils et le nombre maximal de labels
sont centralisés dans `src/utils/constants.ts`.

## Sélection du contexte LLM

Chaque fichier reçoit un rôle exclusif (`source`, `test`, `documentation`,
`dependency`, `ci-cd`, etc.) et un score fondé notamment sur son rôle, son
statut, la taille du diff et la disponibilité du patch.

Une sélection à rendement décroissant par rôle et par répertoire empêche une
série de tests, de snapshots ou de fixtures de masquer le fichier source
principal. Les patchs et la description de la PR sont ensuite tronqués selon
un budget global.

La sélection d'une PR publique peut être inspectée sans appeler un LLM :

```bash
npm run evaluate:selection -- https://github.com/owner/repo/pull/123
npm run eval:selector -- evaluation/prs-annotees.json --output evaluation/resultats.json
```

La méthode d'évaluation est décrite dans
[`docs/file-selection-evaluation.md`](docs/file-selection-evaluation.md).

## Installation locale

### 1. Prérequis

- Git;
- Node.js 20 ou une version plus récente;
- npm 10 ou une version plus récente;
- Docker Desktop, avec le moteur Docker démarré;
- un compte GitHub autorisé à créer une GitHub App;
- une clé API provenant d'au moins un fournisseur LLM.

Vérifier les installations :

```bash
node --version
npm --version
docker --version
docker compose version
```

### 2. Cloner le dépôt

```bash
git clone https://github.com/stilab-ets/PRIntentLabeler.git
cd PRIntentLabeler
npm install
```

### 3. Créer la GitHub App de développement

Compiler puis démarrer Probot :

```bash
npm run build
npm start
```

Au premier démarrage, le wizard Probot ouvre une page dans le navigateur. Il
permet de créer la GitHub App, de générer sa clé privée, de configurer le secret
de webhook et de créer un canal Smee.io.

Le fichier `app.yml` décrit les événements et permissions nécessaires :

| Élément       | Valeur                                                       |
| ------------- | ------------------------------------------------------------ |
| Événements    | `Pull request`, `Check run`, `Issue comment`, `Installation` |
| Metadata      | Read                                                         |
| Pull requests | Read                                                         |
| Issues        | Read and write                                               |
| Checks        | Read and write                                               |

Une modification de `app.yml` ne met pas automatiquement à jour une GitHub App
existante. Dans ce cas, modifier les permissions depuis les paramètres GitHub
de l'application, puis accepter les nouvelles permissions sur l'installation.

### 4. Configurer les variables d'environnement

Si le wizard n'a pas créé le fichier `.env`, copier l'exemple :

```bash
cp .env.example .env
```

Variables utilisées :

```env
# GitHub App et webhooks
APP_ID=
WEBHOOK_SECRET=
PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
WEBHOOK_PROXY_URL=https://smee.io/votre-canal

# PostgreSQL
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pr_intent_labeler
DATABASE_SSL=false

# Chiffrement des clés API enregistrées
CONFIG_ENCRYPTION_KEY=

# OAuth GitHub pour l'interface de configuration
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
PUBLIC_BASE_URL=http://localhost:3000

# Repli Groq facultatif
GROQ_API_KEY=
GROQ_MODEL=llama-3.1-8b-instant

# Application
LABEL_MODE=suggest
LOG_LEVEL=debug
NODE_ENV=development
```

Ne jamais committer `.env`, une clé privée `*.pem` ou une clé API.

### 5. Générer la clé de chiffrement

La clé doit contenir exactement 32 octets encodés en base64. Elle est
indépendante des clés API des fournisseurs.

Avec Node.js :

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Sous PowerShell :

```powershell
$bytes = New-Object byte[] 32
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
[Convert]::ToBase64String($bytes)
```

Copier le résultat dans `CONFIG_ENCRYPTION_KEY`. Conserver cette valeur :
la remplacer rendrait les clés API déjà enregistrées impossibles à déchiffrer.

### 6. Démarrer PostgreSQL

```bash
docker compose up -d postgres
docker compose ps
```

Le conteneur doit apparaître avec l'état `healthy`.

Appliquer ensuite la migration :

```bash
npm run db:migrate
```

Si le port `5432` est déjà utilisé par un PostgreSQL installé sur Windows,
arrêter temporairement ce service ou modifier le port exposé dans `compose.yml`
et dans `DATABASE_URL`.

### 7. Configurer OAuth dans la GitHub App

Dans **GitHub → Settings → Developer settings → GitHub Apps → votre app** :

- **Setup URL** : `http://localhost:3000/setup`;
- **Callback URL** : `http://localhost:3000/auth/github/callback`;
- **Redirect on update** : activé;
- **Request user authorization during installation** : désactivé;
- générer un client secret et le placer dans `GITHUB_CLIENT_SECRET`;
- placer le Client ID dans `GITHUB_CLIENT_ID`.

L'URL utilisée dans GitHub doit correspondre à `PUBLIC_BASE_URL`.

### 8. Démarrer l'application

```bash
npm run dev
```

Le terminal doit notamment indiquer :

```text
LLM PR Labeler app loaded
Connected to https://smee.io/...
Listening on http://localhost:3000
```

Ouvrir ensuite :

```text
http://localhost:3000/settings
```

Se connecter avec GitHub, sélectionner l'installation, puis :

1. choisir le fournisseur;
2. saisir l'identifiant du modèle;
3. saisir la clé API;
4. utiliser **Tester la connexion**;
5. utiliser **Enregistrer** si le test réussit.

La clé est chiffrée avant son enregistrement. Elle n'est ensuite représentée
que par ses quatre derniers caractères.

### 9. Tester avec une Pull Request

1. Installer la GitHub App sur un dépôt de test.
2. Créer une branche et modifier un ou plusieurs fichiers.
3. Ouvrir une Pull Request.
4. Vérifier les logs du serveur.
5. Vérifier que le commentaire d'analyse apparaît sur la PR.
6. Pousser un nouveau commit et confirmer que le commentaire existant est mis
   à jour au lieu d'être dupliqué.

En mode `suggest`, aucun label n'est appliqué automatiquement.

## Validation avant une Pull Request

```bash
npm run build
npm run lint
npm test
```

La migration peut également être rejouée sans supprimer les données :

```bash
npm run db:migrate
```

Checklist de validation :

- [ ] PostgreSQL est démarré et sain;
- [ ] la migration est appliquée;
- [ ] l'application reçoit les webhooks;
- [ ] `/settings` affiche uniquement les installations accessibles;
- [ ] une clé valide peut être testée et enregistrée;
- [ ] une clé invalide ne remplace pas la configuration existante;
- [ ] les secrets ne sont ni affichés ni commit;
- [ ] une PR déclenche une analyse;
- [ ] un nouveau commit met à jour le commentaire existant;
- [ ] le build, le lint et les tests réussissent.

## Dépannage

### `DATABASE_URL est requis`

Vérifier que `DATABASE_URL` est présent dans `.env` et que le script charge bien
ce fichier avant la migration.

### `password authentication failed for user "postgres"`

Un autre serveur PostgreSQL utilise probablement le port `5432`. Vérifier les
services PostgreSQL locaux et les ports Docker, puis s'assurer que
`DATABASE_URL` cible le bon serveur.

### `ECONNREFUSED` sur PostgreSQL

Vérifier que Docker Desktop est démarré :

```bash
docker compose ps
```

### Erreur `401` ou `403` du fournisseur

Vérifier la clé API, les permissions du projet et l'identifiant du modèle.

### Erreur `404` du fournisseur

Le modèle demandé peut avoir été retiré ou ne pas être disponible pour le
compte. Choisir un identifiant actuellement proposé par le fournisseur.

### Erreur `429` du fournisseur

Le quota gratuit, la limite de requêtes ou le crédit disponible a été atteint.
Attendre la réinitialisation du quota, choisir un autre modèle ou configurer la
facturation directement chez le fournisseur.

## Commandes utiles

| Commande                               | Action                                        |
| -------------------------------------- | ---------------------------------------------- |
| `npm run dev`                          | Démarre l'application en mode watch            |
| `npm run build`                        | Compile TypeScript vers `lib/`                 |
| `npm start`                            | Démarre la version compilée                    |
| `npm test`                             | Exécute les tests Vitest                       |
| `npm run test:watch`                   | Exécute Vitest en mode watch                   |
| `npm run test:coverage`                | Génère le rapport de couverture                |
| `npm run evaluate:selection -- <URL>`  | Inspecte le scoring d'une PR publique          |
| `npm run eval:selector -- <dataset>`   | Compare les quatre variantes d'ablation        |
| `npm run db:migrate`                   | Applique la migration PostgreSQL               |
| `npm run lint`                         | Vérifie le code avec ESLint                    |
| `npm run format`                       | Formate le code avec Prettier                  |
| `npm run format:check`                 | Vérifie le formatage sans modifier les fichiers |
| `docker compose up -d postgres`        | Démarre PostgreSQL                             |
| `docker compose down`                  | Arrête PostgreSQL sans supprimer les données   |

## État des itérations

- ✅ Itération 1 : intégration GitHub et gestion des webhooks
- ✅ Itération 2 : intégration Groq et modes d'application des labels
- ✅ Amélioration de la sélection et du scoring des fichiers
- 🚧 Configuration multi-fournisseurs par installation
- ⏳ Évaluation à grande échelle sur un corpus de Pull Requests
- ⏳ Finalisation, documentation et rapport

## Documentation

- [Configuration locale détaillée](docs/SETUP_LOCAL.md)
- [Configuration multi-LLM](docs/llm-provider-configuration.md)
- [Évaluation de la sélection des fichiers](docs/file-selection-evaluation.md)
- [Architecture](docs/architecture-v1.md)
- [Taxonomie des labels](docs/labels-taxonomy-v1.md)

## Licence

MIT
