# Configuration multi-LLM

## Objectif

Chaque installation de PRIntentLabeler peut choisir son fournisseur, son
modèle et sa propre clé API. La configuration est utilisée pour tous les dépôts
accessibles à cette installation GitHub.

Fournisseurs pris en charge :

| Fournisseur   | API utilisée                       | Modèle proposé par défaut   |
| ------------- | ---------------------------------- | --------------------------- |
| Groq          | Chat Completions compatible OpenAI | `llama-3.1-8b-instant`      |
| OpenAI        | Chat Completions                   | `gpt-5-mini`                |
| Anthropic     | Messages API                       | `claude-haiku-4-5-20251001` |
| Google Gemini | `generateContent`                  | `gemini-2.5-flash`          |
| xAI           | Chat Completions compatible OpenAI | `grok-4.5`                  |
| Perplexity    | Sonar API                          | `sonar`                     |
| Personnalisé  | Chat Completions compatible OpenAI | À saisir                    |

Le modèle reste modifiable. Les valeurs proposées dans l'interface sont des
points de départ et non une liste fermée.

## Parcours de configuration

1. L'utilisateur installe la GitHub App.
2. GitHub redirige son navigateur vers `/setup?installation_id=...`.
3. Le backend démarre le flux OAuth GitHub avec un paramètre `state` à usage
   unique.
4. Après le callback, le backend vérifie que l'installation demandée apparaît
   dans les installations accessibles à l'utilisateur.
5. L'utilisateur teste et enregistre le fournisseur, le modèle et la clé.
6. Lors d'un webhook de Pull Request, `installation.id` permet de charger la
   configuration correspondante.

Le jeton utilisateur GitHub n'est pas enregistré. Une session aléatoire et
expirable est créée après la vérification OAuth.

## Paramètres de la GitHub App

Dans **Settings > Developer settings > GitHub Apps > PRIntentLabeler** :

- définir **Setup URL** à `https://votre-domaine/setup`;
- activer **Redirect on update**;
- ajouter `https://votre-domaine/auth/github/callback` aux callback URLs;
- générer un client secret et le placer dans `GITHUB_CLIENT_SECRET`;
- ne pas activer **Request user authorization during installation**, car
  `/setup` déclenche explicitement le flux OAuth après avoir reçu
  `installation_id`;
- conserver l'URL de webhook actuelle.

`app.yml` contient les valeurs locales pour les nouvelles GitHub Apps, mais ne
modifie pas automatiquement une GitHub App déjà enregistrée.

## Base de données locale

Avec Docker :

```bash
docker compose up -d postgres
```

Configurer ensuite :

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pr_intent_labeler
DATABASE_SSL=false
```

Générer une clé de chiffrement indépendante des clés LLM :

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Placer le résultat dans :

```env
CONFIG_ENCRYPTION_KEY=
```

Appliquer la migration :

```bash
npm run db:migrate
```

## Variables requises

```env
DATABASE_URL=
DATABASE_SSL=false
CONFIG_ENCRYPTION_KEY=
GITHUB_CLIENT_ID=
GITHUB_CLIENT_SECRET=
PUBLIC_BASE_URL=http://localhost:3000
```

`PUBLIC_BASE_URL` doit correspondre exactement au domaine utilisé dans les
Setup et Callback URLs de la GitHub App.

`GROQ_API_KEY` et `GROQ_MODEL` restent facultatifs. Ils servent de repli pour
les installations sans configuration enregistrée.

## Stockage et rotation

Les clés API sont chiffrées avec AES-256-GCM avant leur insertion dans
PostgreSQL. La clé maîtresse de chiffrement reste dans l'environnement du
serveur et n'est jamais enregistrée dans la base.

L'interface ne réaffiche que les quatre derniers caractères de la clé. Lors
d'un remplacement :

1. la nouvelle clé est testée;
2. si le test réussit, elle est chiffrée et remplace l'ancienne;
3. si le test échoue, l'ancienne configuration reste inchangée.

Les créations, modifications et suppressions sont inscrites dans
`llm_configuration_audits`, sans aucune clé API.

## Suppression

L'utilisateur peut supprimer sa configuration depuis la page de paramètres.
La configuration est également supprimée à la réception de l'événement
`installation.deleted`.

## Références des fournisseurs

- [OpenAI Chat Completions](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)
- [Anthropic Messages API](https://platform.claude.com/docs/en/get-started)
- [Gemini generateContent](https://ai.google.dev/api/generate-content)
- [xAI Chat Completions](https://docs.x.ai/developers/rest-api-reference/inference/chat)
- [Perplexity Sonar API](https://docs.perplexity.ai/api-reference/sonar-post)
- [Groq Chat Completions](https://console.groq.com/docs/text-chat)
