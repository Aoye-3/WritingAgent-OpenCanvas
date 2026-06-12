import cors from "cors";
import express from "express";
import { agentCards } from "./agentCards.js";
import { createAgentRuntimeAdapter } from "./agentRuntimeAdapter.js";
import { createAgentRuntime } from "./runtime/index.js";
import { createGenerationService } from "./services/generationService.js";
import { KnowledgeService } from "./knowledge/service.js";
import { AgentRuntimeMemoryService } from "./services/agentRuntimeMemoryService.js";
import { createStorage } from "./storage.js";
import { createCanvasDomainService } from "./domains/canvas/index.js";
import { registerAgentRoutes } from "./routes/agentRoutes.js";
import { registerCatalogRoutes } from "./routes/catalogRoutes.js";
import { registerCanvasRoutes } from "./routes/canvasRoutes.js";
import { registerAgentBackendRoutes } from "./routes/agentBackendRoutes.js";
import { registerAgentRuntimeRoutes } from "./routes/agentRuntimeRoutes.js";
import { registerGenerationRoutes } from "./routes/generationRoutes.js";
import { registerHealthRoutes } from "./routes/healthRoutes.js";
import { registerInternalAgentBackendRoutes } from "./routes/internalAgentBackendRoutes.js";
import { registerInternalAgentRuntimeRoutes } from "./routes/internalAgentRuntimeRoutes.js";
import { registerKnowledgeRoutes } from "./routes/knowledgeRoutes.js";
import { registerProjectRoutes } from "./routes/projectRoutes.js";
import { registerSettingsRoutes } from "./routes/settingsRoutes.js";
import { registerThreadRoutes } from "./routes/threadRoutes.js";
import { registerPlanRoutes } from "./routes/planRoutes.js";
import { syncConfiguredModelsToAgentBackend } from "./runtime/agentBackendAdapter/modelSync.js";

export async function createApp() {
  const app = express();
  const storage = await createStorage();
  const agentRuntime = createAgentRuntimeAdapter(storage);
  const executionRuntime = createAgentRuntime();
  const knowledgeService = new KnowledgeService(storage);
  const memoryService = new AgentRuntimeMemoryService();
  const canvasService = createCanvasDomainService(storage);
  const generationService = createGenerationService(storage, agentRuntime, { agentRuntime: executionRuntime, knowledge: knowledgeService, memory: memoryService });

  storage.upsertAgentCards(agentCards);
  await syncConfiguredModelsToAgentBackend().catch((error) => {
    console.error("AgentBackend model sync failed during startup", error);
  });

  app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
  app.use(express.json({ limit: "25mb" }));

  registerHealthRoutes(app);
  registerInternalAgentRuntimeRoutes(app, { storage, knowledgeService });
  registerInternalAgentBackendRoutes(app, { storage, knowledgeService });
  registerAgentRuntimeRoutes(app, { agentRuntime, executionRuntime, memoryService });
  registerAgentBackendRoutes(app, { agentRuntime, executionRuntime, memoryService });
  registerKnowledgeRoutes(app, { knowledgeService });
  registerCatalogRoutes(app);
  registerAgentRoutes(app, { agentRuntime });
  registerThreadRoutes(app, { storage, agentRuntime });
  registerPlanRoutes(app, storage);
  registerProjectRoutes(app, { storage, agentRuntime });
  registerCanvasRoutes(app, { canvasService });
  registerSettingsRoutes(app, { storage });
  registerGenerationRoutes(app, { generationService, canvasService });

  return app;
}
