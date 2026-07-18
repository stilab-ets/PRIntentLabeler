import Groq from "groq-sdk";
import type { PullRequestLlmContext } from "../domain/pull-request-data.js";
import type { LabelSuggestion } from "../domain/label-suggestion.js";
import type { PullRequestAnalysis } from "../domain/llm-analysis.js";
import type { LlmProvider } from "./llm-provider.js";
import {
  buildClassificationPrompt,
  buildClassificationSystemPrompt,
} from "./prompt-builder.js";

export class GroqProvider implements LlmProvider {
  private client: Groq;
  private model: string;

  constructor(apiKey: string, model = "llama-3.1-8b-instant") {
    this.client = new Groq({ apiKey });
    this.model = model;
  }

  async classifyPullRequest(
    context: PullRequestLlmContext,
  ): Promise<PullRequestAnalysis> {
    const systemPrompt = buildClassificationSystemPrompt();
    const prompt = buildClassificationPrompt(context);

    let response;
    try {
      response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: prompt },
        ],
        temperature: 0.1,
        max_tokens: 512,
        response_format: { type: "json_object" },
      });
    } catch (err: unknown) {
      const status = (err as { status?: number }).status;
      if (status === 413 || status === 429) {
        throw new Error(
          `Groq a rejeté la requête (${status}) : prompt trop volumineux ou limite TPM atteinte. ` +
            "Réduisez MAX_FILES_FOR_LLM / MAX_PATCH_LINES_PER_FILE dans src/utils/constants.ts.",
        );
      }
      throw err;
    }

    const content = response.choices[0]?.message?.content ?? "{}";

    let parsed: { suggestions?: unknown; summary?: unknown };
    try {
      parsed = JSON.parse(content);
    } catch {
      return { suggestions: [], summary: "" };
    }

    return {
      suggestions: normalizeSuggestions(parsed.suggestions),
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
    };
  }
}

function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

// Valide et normalise les suggestions brutes du LLM : ignore les entrées
// sans nom et borne la confiance dans [0, 1].
function normalizeSuggestions(raw: unknown): LabelSuggestion[] {
  if (!Array.isArray(raw)) return [];

  return raw
    .map((entry): LabelSuggestion => {
      const s = (entry ?? {}) as Record<string, unknown>;
      return {
        name: typeof s.name === "string" ? s.name.trim() : "",
        confidence:
          typeof s.confidence === "number" ? clamp01(s.confidence) : 0,
        reason: typeof s.reason === "string" ? s.reason : "",
      };
    })
    .filter((s) => s.name.length > 0);
}
