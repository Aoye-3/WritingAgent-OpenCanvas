import type { Express } from "express";
import type { ClaimReviewDomainService } from "../domains/claim-review/index.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

export function registerClaimReviewRoutes(app: Express, claimService: ClaimReviewDomainService) {
  app.get("/api/threads/:threadId/claims", (request, response) => {
    try {
      const sourceNodeId = typeof request.query.sourceNodeId === "string" ? request.query.sourceNodeId : undefined;
      sendOk(response, { claims: claimService.listClaims(request.params.threadId, sourceNodeId) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to list Claims"));
    }
  });

  app.post("/api/threads/:threadId/claims/from-selection", async (request, response) => {
    try {
      sendOk(response, { claim: await claimService.createFromSelection(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create Claim candidate"));
    }
  });

  app.post("/api/threads/:threadId/claims/extract", async (request, response) => {
    try {
      sendOk(response, { claims: await claimService.extract(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to extract Claims"));
    }
  });

  app.patch("/api/threads/:threadId/claims/:claimId", (request, response) => {
    try {
      const claim = claimService.update(request.params.threadId, request.params.claimId, request.body ?? {});
      if (!claim) return sendError(response, 404, "not_found", "Claim candidate not found");
      sendOk(response, { claim });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to update Claim candidate"));
    }
  });

  app.delete("/api/threads/:threadId/claims/:claimId", (request, response) => {
    try {
      const deleted = claimService.delete(request.params.threadId, request.params.claimId);
      if (!deleted) return sendError(response, 404, "not_found", "Claim candidate not found");
      sendOk(response, { deleted: true });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to delete Claim candidate"));
    }
  });

  app.post("/api/threads/:threadId/claims/:claimId/create-node", (request, response) => {
    try {
      const result = claimService.createNode(request.params.threadId, request.params.claimId, request.body ?? {});
      if (!result) return sendError(response, 404, "not_found", "Claim candidate not found");
      sendOk(response, result);
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create Canvas node from Claim"));
    }
  });

  app.post("/api/threads/:threadId/claims/create-nodes", (request, response) => {
    try {
      sendOk(response, { results: claimService.createNodes(request.params.threadId, request.body ?? {}) });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create Canvas nodes from Claims"));
    }
  });
}
