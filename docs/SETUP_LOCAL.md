# Setup local — étapes manuelles requises

Ces étapes doivent être faites par chaque membre de l'équipe sur sa propre machine.

## 1. Cloner le repo et installer

```bash
git clone https://github.com/<TON_USERNAME>/llm-pr-labeler.git
cd llm-pr-labeler
npm install
```

## 2. Wizard Probot interactif (au premier démarrage)

```bash
npm start
```

Au premier lancement, Probot ouvre `http://localhost:3000` avec un wizard qui :

1. Te guide pour créer la GitHub App dans ton compte GitHub
2. Génère automatiquement la clé privée (`.pem`)
3. Génère le webhook secret
4. Configure Smee.io pour recevoir les webhooks en local
5. Écrit le `.env` automatiquement

**Ne ferme pas la page web tant que le wizard n'a pas fini.**

## 3. Vérifier les permissions de la GitHub App

Va dans **Developer Settings → GitHub Apps → ton app → Permissions** et vérifie :

| Permission    | Niveau         |
| ------------- | -------------- |
| Metadata      | Read           |
| Pull requests | Read           |
| Issues        | Read and write |

**Events à activer** : `Pull request`, `Check run`, `Issue comment` et
`Installation`.

## 4. Configurer PostgreSQL et GitHub OAuth

La configuration multi-LLM nécessite PostgreSQL :

```bash
docker compose up -d postgres
```

Génère ensuite une clé de chiffrement :

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Complète les variables suivantes dans `.env` :

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/pr_intent_labeler
DATABASE_SSL=false
CONFIG_ENCRYPTION_KEY=<résultat de la commande>
GITHUB_CLIENT_ID=<Client ID de la GitHub App>
GITHUB_CLIENT_SECRET=<client secret généré>
PUBLIC_BASE_URL=http://localhost:3000
```

Applique la migration :

```bash
npm run db:migrate
```

Dans les paramètres de la GitHub App :

- **Setup URL** : `http://localhost:3000/setup`
- **Callback URL** : `http://localhost:3000/auth/github/callback`
- **Redirect on update** : activé
- **Request user authorization during installation** : désactivé

Voir [`docs/llm-provider-configuration.md`](llm-provider-configuration.md)
pour le fonctionnement complet.

## 5. Installer l'app sur un repo de test

Depuis la page publique de ton app GitHub, clic **Install** → choisir un repo de test (que tu contrôles, où tu peux créer des PRs librement).

## 6. Tester en local

```bash
npm run dev
```

Ouvre une PR dans ton repo de test. Tu dois voir :

1. Dans les logs : "Processing pull request event"
2. Dans la PR sur GitHub : un commentaire automatique avec le marker `<!-- llm-pr-labeler -->`

Après l'installation, GitHub redirige vers la page permettant de choisir le
fournisseur, le modèle et la clé API.

## 7. Validation end-to-end

Vérifie ces 8 points :

- [ ] `npm run dev` démarre sans erreur
- [ ] `npm run build` compile sans erreur
- [ ] `npm test` passe (tous les tests verts)
- [ ] La GitHub App est installée sur le repo de test
- [ ] Ouvrir une PR sur le repo test → commentaire apparaît automatiquement
- [ ] Pousser un commit sur la PR → commentaire mis à jour, **pas dupliqué**
- [ ] Modifier le titre de la PR → commentaire mis à jour
- [ ] La page `/settings` affiche seulement les installations accessibles
- [ ] Une clé invalide n'écrase pas la configuration existante
- [ ] Une clé valide est affichée uniquement par ses quatre derniers caractères
- [ ] Le `.env` et les `*.pem` ne sont **jamais** commit dans Git
