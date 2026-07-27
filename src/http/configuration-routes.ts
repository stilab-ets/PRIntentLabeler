import { timingSafeEqual } from "node:crypto";
import express, {
  type NextFunction,
  type Request,
  type Response,
  type Router,
} from "express";
import type { WebSession } from "../auth/web-auth.js";
import { getGitHubOAuthService } from "../auth/runtime.js";
import type { TestLlmConfigurationInput } from "../configuration/llm-configuration.js";
import { getLlmConfigurationService } from "../configuration/runtime.js";
import { isLlmProviderName } from "../llm/provider-configuration.js";
import { renderErrorPage } from "./html.js";
import {
  renderInstallationsPage,
  renderSettingsClientScript,
  renderSettingsPage,
} from "./settings-page.js";

const SESSION_COOKIE = "pril_session";

function parsePositiveInteger(value: unknown): number | null {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : null;
}

function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;

  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

function setSessionCookie(res: Response, value: string): void {
  const secure =
    process.env.NODE_ENV === "production" ||
    process.env.PUBLIC_BASE_URL?.startsWith("https://");
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800${secure ? "; Secure" : ""}`,
  );
}

function clearSessionCookie(res: Response): void {
  res.setHeader(
    "Set-Cookie",
    `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

function csrfMatches(session: WebSession, value: unknown): boolean {
  if (typeof value !== "string") return false;
  const expected = Buffer.from(session.csrfToken);
  const received = Buffer.from(value);
  return (
    expected.length === received.length && timingSafeEqual(expected, received)
  );
}

function configurationInput(
  installationId: number,
  body: Record<string, unknown>,
): TestLlmConfigurationInput {
  if (!isLlmProviderName(body.provider)) {
    throw new Error("Le fournisseur sélectionné est invalide.");
  }

  const model = typeof body.model === "string" ? body.model.trim() : "";
  const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
  const baseUrl = typeof body.baseUrl === "string" ? body.baseUrl.trim() : "";

  if (model.length > 160) throw new Error("Le nom du modèle est trop long.");
  if (apiKey.length > 4096) throw new Error("La clé API est trop longue.");
  if (baseUrl.length > 2048) throw new Error("L’URL de base est trop longue.");

  return {
    installationId,
    provider: body.provider,
    model,
    apiKey: apiKey || undefined,
    baseUrl: baseUrl || undefined,
  };
}

function securityHeaders(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  );
  next();
}

export function registerConfigurationRoutes(router: Router): void {
  router.use(securityHeaders);
  router.use(express.urlencoded({ extended: false, limit: "16kb" }));

  router.get("/assets/settings.js", (_req, res) => {
    res.type("application/javascript").send(renderSettingsClientScript());
  });

  router.get("/setup", async (req, res) => {
    const installationId = parsePositiveInteger(req.query.installation_id);
    if (!installationId) {
      res
        .status(400)
        .send(renderErrorPage("Le paramètre installation_id est requis."));
      return;
    }

    const oauth = getGitHubOAuthService();
    if (!oauth) {
      res
        .status(503)
        .send(
          renderErrorPage(
            "La base de données ou GitHub OAuth n’est pas configuré sur le serveur.",
            503,
          ),
        );
      return;
    }

    try {
      res.redirect(await oauth.createAuthorizationUrl(installationId));
    } catch (error) {
      res
        .status(500)
        .send(
          renderErrorPage(
            error instanceof Error ? error.message : "Erreur OAuth.",
            500,
          ),
        );
    }
  });

  router.get("/auth/github", async (req, res) => {
    const installationId = req.query.installation_id
      ? parsePositiveInteger(req.query.installation_id)
      : undefined;
    const oauth = getGitHubOAuthService();
    if (!oauth) {
      res
        .status(503)
        .send(renderErrorPage("GitHub OAuth n’est pas configuré.", 503));
      return;
    }

    try {
      res.redirect(
        await oauth.createAuthorizationUrl(installationId ?? undefined),
      );
    } catch (error) {
      res
        .status(500)
        .send(
          renderErrorPage(
            error instanceof Error ? error.message : "Erreur OAuth.",
            500,
          ),
        );
    }
  });

  router.get("/auth/github/callback", async (req, res) => {
    const code = typeof req.query.code === "string" ? req.query.code : "";
    const state = typeof req.query.state === "string" ? req.query.state : "";
    const oauth = getGitHubOAuthService();

    if (!oauth || !code || !state) {
      res
        .status(400)
        .send(renderErrorPage("La réponse OAuth GitHub est incomplète."));
      return;
    }

    try {
      const result = await oauth.completeAuthorization(code, state);
      setSessionCookie(res, result.sessionToken);
      res.redirect(
        result.requestedInstallationId
          ? `/settings/${result.requestedInstallationId}`
          : "/settings",
      );
    } catch (error) {
      res
        .status(403)
        .send(
          renderErrorPage(
            error instanceof Error
              ? error.message
              : "Autorisation GitHub refusée.",
            403,
          ),
        );
    }
  });

  router.get("/settings", async (req, res) => {
    const oauth = getGitHubOAuthService();
    const token = readCookie(req, SESSION_COOKIE);
    const session = oauth && token ? await oauth.getSession(token) : null;
    if (!session) {
      res.redirect("/auth/github");
      return;
    }

    const notice =
      req.query.deleted === "1"
        ? "La configuration a été supprimée."
        : undefined;
    res.send(renderInstallationsPage(session, notice));
  });

  router.get("/settings/:installationId", async (req, res) => {
    const oauth = getGitHubOAuthService();
    const configurationService = getLlmConfigurationService();
    const token = readCookie(req, SESSION_COOKIE);
    const session = oauth && token ? await oauth.getSession(token) : null;
    const installationId = parsePositiveInteger(req.params.installationId);

    if (!session) {
      const target = installationId ? `?installation_id=${installationId}` : "";
      res.redirect(`/auth/github${target}`);
      return;
    }
    if (!installationId || !session.installationIds.includes(installationId)) {
      res
        .status(403)
        .send(
          renderErrorPage(
            "Cette installation n’est pas accessible à l’utilisateur connecté.",
            403,
          ),
        );
      return;
    }
    if (!configurationService) {
      res
        .status(503)
        .send(
          renderErrorPage(
            "La persistance des configurations n’est pas activée.",
            503,
          ),
        );
      return;
    }

    try {
      const configuration =
        await configurationService.getSummary(installationId);
      res.send(
        renderSettingsPage({
          installationId,
          session,
          configuration,
          notice:
            req.query.saved === "1"
              ? "La configuration a été testée et enregistrée."
              : undefined,
        }),
      );
    } catch (error) {
      res
        .status(500)
        .send(
          renderErrorPage(
            error instanceof Error
              ? error.message
              : "Impossible de charger la configuration.",
            500,
          ),
        );
    }
  });

  router.post(
    "/api/installations/:installationId/llm/test",
    async (req, res) => {
      const oauth = getGitHubOAuthService();
      const configurationService = getLlmConfigurationService();
      const token = readCookie(req, SESSION_COOKIE);
      const session = oauth && token ? await oauth.getSession(token) : null;
      const installationId = parsePositiveInteger(req.params.installationId);
      const body = (req.body ?? {}) as Record<string, unknown>;

      if (
        !session ||
        !installationId ||
        !session.installationIds.includes(installationId) ||
        !csrfMatches(session, body._csrf)
      ) {
        res.status(403).json({ message: "Autorisation invalide ou expirée." });
        return;
      }
      if (!configurationService) {
        res.status(503).json({ message: "Configuration serveur incomplète." });
        return;
      }

      try {
        await configurationService.test(
          configurationInput(installationId, body),
        );
        res.json({ message: "Connexion au fournisseur réussie." });
      } catch (error) {
        res.status(400).json({
          message:
            error instanceof Error
              ? error.message
              : "Le test de connexion a échoué.",
        });
      }
    },
  );

  router.post("/settings/:installationId/save", async (req, res) => {
    const oauth = getGitHubOAuthService();
    const configurationService = getLlmConfigurationService();
    const token = readCookie(req, SESSION_COOKIE);
    const session = oauth && token ? await oauth.getSession(token) : null;
    const installationId = parsePositiveInteger(req.params.installationId);
    const body = req.body as Record<string, unknown>;

    if (
      !session ||
      !installationId ||
      !session.installationIds.includes(installationId) ||
      !csrfMatches(session, body._csrf)
    ) {
      res
        .status(403)
        .send(renderErrorPage("Autorisation invalide ou expirée.", 403));
      return;
    }
    if (!configurationService) {
      res
        .status(503)
        .send(renderErrorPage("Configuration serveur incomplète.", 503));
      return;
    }

    try {
      const input = configurationInput(installationId, body);
      await configurationService.save({
        ...input,
        githubUserId: session.githubUserId,
      });
      res.redirect(`/settings/${installationId}?saved=1`);
    } catch (error) {
      const configuration =
        await configurationService.getSummary(installationId);
      res.status(400).send(
        renderSettingsPage({
          installationId,
          session,
          configuration,
          error:
            error instanceof Error
              ? error.message
              : "La configuration n’a pas été enregistrée.",
        }),
      );
    }
  });

  router.post("/settings/:installationId/delete", async (req, res) => {
    const oauth = getGitHubOAuthService();
    const configurationService = getLlmConfigurationService();
    const token = readCookie(req, SESSION_COOKIE);
    const session = oauth && token ? await oauth.getSession(token) : null;
    const installationId = parsePositiveInteger(req.params.installationId);
    const body = req.body as Record<string, unknown>;

    if (
      !session ||
      !installationId ||
      !session.installationIds.includes(installationId) ||
      !csrfMatches(session, body._csrf)
    ) {
      res
        .status(403)
        .send(renderErrorPage("Autorisation invalide ou expirée.", 403));
      return;
    }
    if (!configurationService) {
      res
        .status(503)
        .send(renderErrorPage("Configuration serveur incomplète.", 503));
      return;
    }

    await configurationService.delete(installationId, session.githubUserId);
    res.redirect("/settings?deleted=1");
  });

  router.post("/auth/logout", async (req, res) => {
    const oauth = getGitHubOAuthService();
    const token = readCookie(req, SESSION_COOKIE);
    const session = oauth && token ? await oauth.getSession(token) : null;
    const body = req.body as Record<string, unknown>;

    if (oauth && token && session && csrfMatches(session, body._csrf)) {
      await oauth.deleteSession(token);
    }
    clearSessionCookie(res);
    res.redirect("/auth/github");
  });
}
