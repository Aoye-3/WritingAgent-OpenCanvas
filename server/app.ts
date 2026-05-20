import cors from "cors";
import express from "express";
import { agentCards } from "./agentCards.js";
import { createAgentRuntimeAdapter } from "./agentRuntimeAdapter.js";
import { createGenerationService } from "./services/generationService.js";
import { KnowledgeService } from "./knowledge/service.js";
import { createStorage } from "./storage.js";
import { registerAgentRoutes } from "./routes/agentRoutes.js";
import { registerCatalogRoutes } from "./routes/catalogRoutes.js";
import { registerCanvasRoutes } from "./routes/canvasRoutes.js";
import { registerDeerFlowRoutes } from "./routes/deerflowRoutes.js";
import { registerGenerationRoutes } from "./routes/generationRoutes.js";
import { registerHealthRoutes } from "./routes/healthRoutes.js";
import { registerInternalDeerFlowRoutes } from "./routes/internalDeerFlowRoutes.js";
import { registerKnowledgeRoutes } from "./routes/knowledgeRoutes.js";
import { registerProjectRoutes } from "./routes/projectRoutes.js";
import { registerSettingsRoutes } from "./routes/settingsRoutes.js";
import { registerThreadRoutes } from "./routes/threadRoutes.js";

export async function createApp() {
  const app = express();
  const storage = await createStorage();
  const agentRuntime = createAgentRuntimeAdapter(storage);
  const knowledgeService = new KnowledgeService(storage);
  const generationService = createGenerationService(storage, agentRuntime, { knowledge: knowledgeService });

  storage.upsertAgentCards(agentCards);

  app.use(cors({ origin: ["http://127.0.0.1:5173", "http://localhost:5173"] }));
  app.use(express.json({ limit: "25mb" }));

  registerHealthRoutes(app);
  registerInternalDeerFlowRoutes(app, { storage, knowledgeService });
  registerDeerFlowRoutes(app, { agentRuntime });
  registerKnowledgeRoutes(app, { knowledgeService });
  registerCatalogRoutes(app);
  registerAgentRoutes(app, { agentRuntime });
  registerThreadRoutes(app, { storage, agentRuntime });
  registerProjectRoutes(app, { storage, agentRuntime });
  registerCanvasRoutes(app, { storage });
  registerSettingsRoutes(app);
  registerGenerationRoutes(app, { generationService });

  return app;
}
