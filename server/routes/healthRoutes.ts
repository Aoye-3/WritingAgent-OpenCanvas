import type { Express } from "express";
import { sendOk } from "../utils/http.js";

export function registerHealthRoutes(app: Express) {
  app.get("/api/health", (_request, response) => {
    sendOk(response, {
      ok: true,
      schemaVersion: 3,
      apiContract: "facetwrite-project-first-v1"
    });
  });
}
