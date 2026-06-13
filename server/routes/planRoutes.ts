import type { Express } from "express";
import type { SQLiteStorageRepository } from "../storage.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

export function registerPlanRoutes(app: Express, storage: SQLiteStorageRepository, executor?: { wake: (threadId: string, planId: string) => void }) {
  app.post("/api/threads/:threadId/plans/intake", (request, response) => mutate(response, () => storage.createPlanIntake(request.params.threadId, {
    title: request.body?.title,
    goal: request.body?.goal
  })));
  app.get("/api/threads/:threadId/plans", (request, response) => {
    try { sendOk(response, { plans: storage.listPlanRuns(request.params.threadId) }); }
    catch (error) { sendError(response, 400, "bad_request", errorMessage(error, "Unable to list plans")); }
  });
  app.get("/api/threads/:threadId/plans/:planId", (request, response) => {
    const plan = storage.getPlanRun(request.params.threadId, request.params.planId);
    return plan ? sendOk(response, { plan }) : sendError(response, 404, "not_found", "Plan not found");
  });
  app.post("/api/threads/:threadId/plans/:planId/approve", (request, response) => mutateAndWake(request, response, () => storage.approvePlanRun(request.params.threadId, request.params.planId)));
  app.post("/api/threads/:threadId/plans/:planId/pause", (request, response) => mutate(response, () => storage.pausePlanRun(request.params.threadId, request.params.planId, request.body?.message)));
  app.post("/api/threads/:threadId/plans/:planId/resume", (request, response) => mutateAndWake(request, response, () => storage.resumePlanRun(request.params.threadId, request.params.planId)));
  app.post("/api/threads/:threadId/plans/:planId/cancel", (request, response) => mutate(response, () => storage.cancelPlanRun(request.params.threadId, request.params.planId)));
  app.get("/api/threads/:threadId/plans/:planId/activities", (request, response) => {
    try { sendOk(response, { activities: storage.listPlanActivities(request.params.threadId, request.params.planId) }); }
    catch (error) { sendError(response, 400, "bad_request", errorMessage(error, "Unable to list Plan activities")); }
  });
  app.post("/api/threads/:threadId/plans/:planId/canvas-projection", (request, response) => mutate(response, () => storage.ensurePlanCanvasProjection(request.params.threadId, request.params.planId)));
  app.post("/api/threads/:threadId/plans/:planId/steps/:stepId/retry", (request, response) => mutateAndWake(request, response, () => storage.retryPlanStep(request.params.threadId, request.params.planId, request.params.stepId), "step"));
  app.post("/api/threads/:threadId/plans/:planId/answer", (request, response) => {
    const answer = {
      answer: typeof request.body?.answer === "string" ? request.body.answer.trim() : undefined,
      optionId: typeof request.body?.optionId === "string" ? request.body.optionId.trim() : undefined,
      customAnswer: typeof request.body?.customAnswer === "string" ? request.body.customAnswer.trim() : undefined
    };
    if (!answer.answer && !answer.optionId && !answer.customAnswer) return sendError(response, 400, "bad_request", "Answer is required");
    return mutate(response, () => storage.resumePlanWithAnswer(request.params.threadId, request.params.planId, answer));
  });

  function mutateAndWake(request: { params: { threadId: string; planId: string } }, response: Parameters<typeof sendOk>[0], work: () => unknown, key = "plan") {
    const value = mutate(response, work, key);
    executor?.wake(request.params.threadId, request.params.planId);
    return value;
  }
}

function mutate(response: Parameters<typeof sendOk>[0], work: () => unknown, key = "plan") {
  try {
    const value = work();
    return value ? sendOk(response, { [key]: value }) : sendError(response, 404, "not_found", "Plan not found");
  } catch (error) { return sendError(response, 400, "bad_request", errorMessage(error, "Unable to update plan")); }
}
