import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";
import type { LlmTokenBudget } from "./model-budget.js";

// Contrat commun à tous les fournisseurs LLM (Groq aujourd'hui, autres demain).
// Permet d'injecter un provider mocké dans les tests et de comparer des modèles.
export interface LlmProvider {
  classifyPullRequest(
    context: PullRequestLlmContext,
  ): Promise<PullRequestAnalysis>;

  // Vérifie les identifiants sans enregistrer ni exposer la clé.
  checkConnection?(): Promise<void>;

  // Budget de jetons du modèle réellement configuré : c'est lui qui détermine
  // combien de fichiers et de diffs le contexte peut contenir. Optionnel pour
  // qu'un provider mocké reste utilisable sans le déclarer.
  readonly tokenBudget?: LlmTokenBudget;
}
