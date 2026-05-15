import type { Express, Response } from "express";
import { parseGenerateRequest } from "../contracts/generation.js";
import type { GenerationService } from "../services/generationService.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

type GenerationRouteDeps = {
  generationService: GenerationService;
};

export function registerGenerationRoutes(app: Express, { generationService }: GenerationRouteDeps) {
  app.post("/api/generate", async (request, response) => {
    try {
      const payload = parseGenerateRequest(request.body);
      sendOk(response, await generationService.generateAndRecord(payload));
    } catch (error) {
      sendError(response, 500, "internal_error", errorMessage(error, "Generation failed"));
    }
  });

  app.post("/api/generate/stream", async (request, response) => {
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    });

    try {
      const payload = parseGenerateRequest(request.body);
      const result = await generationService.generateAndRecord(payload, (event) => {
        writeSse(response, "tool_event", event);
      });
      for (const token of chunkText(result.text)) {
        writeSse(response, "token", { text: token });
      }
      writeSse(response, "final", result);
    } catch (error) {
      writeSse(response, "error", { message: errorMessage(error, "Generation failed") });
    } finally {
      response.end();
    }
  });
}

function writeSse(response: Response, event: string, payload: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function chunkText(text: string) {
  const chunks: string[] = [];
  for (let index = 0; index < text.length; index += 24) {
    chunks.push(text.slice(index, index + 24));
  }
  return chunks;
}
