import type { WebSession } from "../auth/web-auth.js";
import type { LlmConfigurationSummary } from "../configuration/llm-configuration.js";
import {
  LLM_PROVIDER_DEFINITIONS,
  LLM_PROVIDER_NAMES,
} from "../llm/provider-configuration.js";
import { escapeHtml, renderPage } from "./html.js";

type SettingsPageOptions = {
  installationId: number;
  session: WebSession;
  configuration: LlmConfigurationSummary | null;
  notice?: string;
  error?: string;
};

function providerOptions(selected: string): string {
  return LLM_PROVIDER_NAMES.map((name) => {
    const definition = LLM_PROVIDER_DEFINITIONS[name];
    return `<option value="${name}"${selected === name ? " selected" : ""}>${escapeHtml(definition.displayName)}</option>`;
  }).join("");
}

function modelSuggestions(): string {
  const models = new Set(
    LLM_PROVIDER_NAMES.flatMap(
      (name) => LLM_PROVIDER_DEFINITIONS[name].suggestedModels,
    ),
  );
  return [...models]
    .map((model) => `<option value="${escapeHtml(model)}"></option>`)
    .join("");
}

export function renderSettingsPage(options: SettingsPageOptions): string {
  const selectedProvider = options.configuration?.provider ?? "groq";
  const selectedDefinition = LLM_PROVIDER_DEFINITIONS[selectedProvider];
  const model = options.configuration?.model ?? selectedDefinition.defaultModel;
  const baseUrl = options.configuration?.baseUrl ?? "";

  const message = options.error
    ? `<div class="notice error">${escapeHtml(options.error)}</div>`
    : options.notice
      ? `<div class="notice success">${escapeHtml(options.notice)}</div>`
      : "";

  const configured = options.configuration
    ? `<section class="card">
        <h2>Configuration actuelle</h2>
        <p>
          ${escapeHtml(selectedDefinition.displayName)} —
          <code>${escapeHtml(options.configuration.model)}</code> —
          clé terminant par <code>${escapeHtml(options.configuration.keyLastFour)}</code>
        </p>
        <p class="muted">
          Dernière modification :
          ${escapeHtml(options.configuration.updatedAt.toLocaleString("fr-CA"))}
        </p>
      </section>`
    : "";

  return renderPage(
    "Configuration LLM",
    `<section class="card">
      <h1>Configuration de PRIntentLabeler</h1>
      <p>
        Installation GitHub <code>#${options.installationId}</code> —
        connecté en tant que <strong>${escapeHtml(options.session.githubLogin)}</strong>
      </p>
      ${message}
      <div class="notice">
        Le contenu des Pull Requests sélectionné par l’application sera envoyé
        au fournisseur choisi avec cette clé API.
      </div>

      <form id="llm-settings-form"
            method="post"
            action="/settings/${options.installationId}/save"
            data-test-url="/api/installations/${options.installationId}/llm/test">
        <input type="hidden" name="_csrf" value="${escapeHtml(options.session.csrfToken)}">

        <label for="provider">Fournisseur</label>
        <select id="provider" name="provider" required>
          ${providerOptions(selectedProvider)}
        </select>

        <label for="model">Modèle</label>
        <input id="model" name="model" list="known-models"
               value="${escapeHtml(model)}" maxlength="160" required>
        <datalist id="known-models">${modelSuggestions()}</datalist>
        <small>Un modèle suggéré peut être sélectionné ou un identifiant exact peut être saisi.</small>

        <label for="apiKey">
          ${options.configuration ? "Nouvelle clé API" : "Clé API"}
        </label>
        <input id="apiKey" name="apiKey" type="password"
               autocomplete="new-password" maxlength="4096"
               ${options.configuration ? "" : "required"}>
        <small>
          ${
            options.configuration
              ? "Laisser vide pour conserver la clé actuelle. La clé enregistrée ne peut pas être réaffichée."
              : "La clé sera testée, puis chiffrée avant son enregistrement."
          }
        </small>

        <label for="baseUrl">URL de base personnalisée</label>
        <input id="baseUrl" name="baseUrl" type="url"
               value="${escapeHtml(baseUrl)}" maxlength="2048"
               placeholder="https://llm.exemple.ca/v1">
        <small>Requise seulement pour une API compatible OpenAI personnalisée.</small>

        <div id="connection-result" aria-live="polite"></div>
        <div class="actions">
          <button type="button" class="secondary" id="test-connection">
            Tester la connexion
          </button>
          <button type="submit">Enregistrer</button>
          <a class="button secondary" href="/settings">Changer d’installation</a>
        </div>
      </form>
    </section>

    ${configured}

    ${
      options.configuration
        ? `<section class="card">
            <h2>Supprimer la configuration</h2>
            <p>L’analyse LLM utilisera ensuite la configuration Groq du serveur, si elle existe.</p>
            <form method="post" action="/settings/${options.installationId}/delete">
              <input type="hidden" name="_csrf" value="${escapeHtml(options.session.csrfToken)}">
              <button class="danger" type="submit">Supprimer la clé et la configuration</button>
            </form>
          </section>`
        : ""
    }

    <script src="/assets/settings.js" defer></script>`,
  );
}

export function renderInstallationsPage(
  session: WebSession,
  notice?: string,
): string {
  const installations =
    session.installationIds.length > 0
      ? `<ul class="installations">${session.installationIds
          .map(
            (id) =>
              `<li><a class="button secondary" href="/settings/${id}">Installation GitHub #${id}</a></li>`,
          )
          .join("")}</ul>`
      : `<div class="notice error">Aucune installation accessible n’a été trouvée pour ce compte.</div>`;

  return renderPage(
    "Installations",
    `<section class="card">
      <h1>Installations PRIntentLabeler</h1>
      <p>Connecté en tant que <strong>${escapeHtml(session.githubLogin)}</strong>.</p>
      ${notice ? `<div class="notice success">${escapeHtml(notice)}</div>` : ""}
      ${installations}
      <form method="post" action="/auth/logout">
        <input type="hidden" name="_csrf" value="${escapeHtml(session.csrfToken)}">
        <button type="submit" class="secondary">Se déconnecter</button>
      </form>
    </section>`,
  );
}

export function renderSettingsClientScript(): string {
  const defaults = Object.fromEntries(
    LLM_PROVIDER_NAMES.map((name) => [
      name,
      {
        model: LLM_PROVIDER_DEFINITIONS[name].defaultModel,
        baseUrl: LLM_PROVIDER_DEFINITIONS[name].defaultBaseUrl ?? "",
      },
    ]),
  );

  return `"use strict";
const defaults = ${JSON.stringify(defaults)};
const form = document.getElementById("llm-settings-form");
if (form) {
  const provider = document.getElementById("provider");
  const model = document.getElementById("model");
  const baseUrl = document.getElementById("baseUrl");
  const testButton = document.getElementById("test-connection");
  const result = document.getElementById("connection-result");
  let previousProvider = provider.value;

  provider.addEventListener("change", () => {
    const previousDefault = defaults[previousProvider]?.model || "";
    if (!model.value || model.value === previousDefault) {
      model.value = defaults[provider.value]?.model || "";
    }
    if (provider.value === "custom" && !baseUrl.value) {
      baseUrl.focus();
    }
    previousProvider = provider.value;
  });

  testButton.addEventListener("click", async () => {
    result.className = "notice";
    result.textContent = "Test de la connexion en cours…";
    testButton.disabled = true;
    try {
      const response = await fetch(form.dataset.testUrl, {
        method: "POST",
        body: new FormData(form),
        headers: { Accept: "application/json" }
      });
      const payload = await response.json();
      result.className = response.ok ? "notice success" : "notice error";
      result.textContent = payload.message || "Réponse inattendue du serveur.";
    } catch {
      result.className = "notice error";
      result.textContent = "Le serveur de configuration est inaccessible.";
    } finally {
      testButton.disabled = false;
    }
  });
}`;
}
