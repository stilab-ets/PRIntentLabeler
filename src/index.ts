import type { ApplicationFunctionOptions, Probot } from "probot";
import { handlePullRequestEvent } from "./handlers/pull-request-handler.js";
import { handleCheckRunRequestedAction } from "./handlers/check-run-handler.js";
import { handleIssueCommentEdited } from "./handlers/comment-handler.js";
import { registerConfigurationRoutes } from "./http/configuration-routes.js";
import { getLlmConfigurationService } from "./configuration/runtime.js";

export default (app: Probot, options: ApplicationFunctionOptions) => {
  if (options.getRouter) {
    registerConfigurationRoutes(options.getRouter("/"));
  }

  app.on(
    ["pull_request.opened", "pull_request.synchronize", "pull_request.edited"],
    async (context) => {
      await handlePullRequestEvent(context);
    },
  );

  app.on("check_run.requested_action", async (context) => {
    await handleCheckRunRequestedAction(context);
  });

  app.on("issue_comment.edited", async (context) => {
    await handleIssueCommentEdited(context);
  });

  app.on("installation.deleted", async (context) => {
    const configurationService = getLlmConfigurationService();
    if (!configurationService) return;

    try {
      await configurationService.delete(context.payload.installation.id);
      context.log.info(
        { installationId: context.payload.installation.id },
        "Deleted LLM configuration for uninstalled app",
      );
    } catch (error) {
      context.log.error(
        {
          installationId: context.payload.installation.id,
          error: error instanceof Error ? error.message : error,
        },
        "Failed to delete LLM configuration after uninstall",
      );
    }
  });

  app.log.info("LLM PR Labeler app loaded");
};
