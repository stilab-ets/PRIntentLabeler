import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";

// Contrat commun à tous les fournisseurs LLM (Groq aujourd'hui, autres demain).
// Permet d'injecter un provider mocké dans les tests et de comparer des modèles.
export interface LlmProvider {
  classifyPullRequest(
    context: PullRequestLlmContext,
  ): Promise<PullRequestAnalysis>;

  // Vérifie les identifiants sans enregistrer ni exposer la clé.
  checkConnection?(): Promise<void>;
}
