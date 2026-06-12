import type { Express } from "express";
import type { SQLiteStorageRepository } from "../storage.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

export function registerPlanRoutes(app: Express, storage: SQLiteStorageRepository) {
  app.get("/api/threads/:threadId/plans", (request, response) => {
    try { sendOk(response, { plans: storage.listPlanRuns(request.params.threadId) }); }
    catch (error) { sendError(response, 400, "bad_request", errorMessage(error, "Unable to list plans")); }
  });
  app.get("/api/threads/:threadId/plans/:planId", (request, response) => {
    const plan = storage.getPlanRun(request.params.threadId, request.params.planId);
    return plan ? sendOk(response, { plan }) : sendError(response, 404, "not_found", "Plan not found");
  });
  app.post("/api/threads/:threadId/plans/:planId/approve", (request, response) => mutate(response, () => storage.approvePlanRun(request.params.threadId, request.params.planId)));
  app.post("/api/threads/:threadId/plans/:planId/cancel", (request, response) => mutate(response, () => storage.cancelPlanRun(request.params.threadId, request.params.planId)));
  app.post("/api/threads/:threadId/plans/:planId/steps/:stepId/retry", (request, response) => mutate(response, () => storage.retryPlanStep(request.params.threadId, request.params.planId, request.params.stepId), "step"));
  app.post("/api/threads/:threadId/plans/:planId/answer", (request, response) => {
    const answer = typeof request.body?.answer === "string" ? request.body.answer.trim() : "";
    if (!answer) return sendError(response, 400, "bad_request", "Answer is required");
    return mutate(response, () => storage.resumePlanWithAnswer(request.params.threadId, request.params.planId, answer));
  });
}

function mutate(response: Parameters<typeof sendOk>[0], work: () => unknown, key = "plan") {
  try {
    const value = work();
    return value ? sendOk(response, { [key]: value }) : sendError(response, 404, "not_found", "Plan not found");
  } catch (error) { return sendError(response, 400, "bad_request", errorMessage(error, "Unable to update plan")); }
}
