import type { Express } from "express";
import { getDeerFlowConfigOverview } from "../deerflow/proxy.js";
import { getDeerFlowRuntimeStatus } from "../deerflow/status.js";
import { sendOk } from "../utils/http.js";

export function registerDeerFlowRoutes(app: Express) {
  app.get("/api/deerflow/status", async (_request, response) => {
    sendOk(response, await getDeerFlowRuntimeStatus());
  });

  app.get("/api/deerflow/config", async (_request, response) => {
    sendOk(response, await getDeerFlowConfigOverview());
  });
}
