import type { Express, Response } from "express";
import { parseGenerateRequest, type GenerateRequest } from "../contracts/generation.js";
import type { GenerationService } from "../services/generationService.js";
import type { CanvasDomainService } from "../domains/canvas/index.js";
import { errorMessage, sendError, sendOk } from "../utils/http.js";

type GenerationRouteDeps = {
  generationService: GenerationService;
  canvasService: CanvasDomainService;
};

export function registerGenerationRoutes(app: Express, { generationService, canvasService }: GenerationRouteDeps) {
  app.post("/api/generate", async (request, response) => {
    try {
      const payload = parseGenerateRequest(request.body);
      sendOk(response, await generationService.generateAndRecord(payload));
    } catch (error) {
      const status = error instanceof Error && error.message.startsWith("Request body") || error instanceof Error && error.message.startsWith("mode ") || error instanceof Error && error.message.startsWith("locale ")
        ? 400
        : 500;
      sendError(response, status, status === 400 ? "bad_request" : "internal_error", errorMessage(error, "Generation failed"));
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
      const result = await generationService.generateAndRecordStream(payload, {
        onStatus: (status) => writeSse(response, "status", status),
        onToken: (token) => writeSse(response, "token", { text: token }),
        onToolEvent: (event) => {
          writeSse(response, "tool_event", event);
        }
      });
      writeSse(response, "final", result);
    } catch (error) {
      writeSse(response, "error", {
        code: error instanceof Error && (error.message.startsWith("Request body") || error.message.startsWith("mode ") || error.message.startsWith("locale ")) ? "bad_request" : "internal_error",
        message: errorMessage(error, "Generation failed")
      });
    } finally {
      response.end();
    }
  });

  app.post("/api/threads/:threadId/canvas/range-rewrites", async (request, response) => {
    try {
      const body = request.body as Record<string, unknown>;
      const canvas = canvasService.getCanvas(request.params.threadId);
      const node = canvas?.nodes.find((item) => item.id === body.nodeId);
      const rangeStart = body.rangeStart;
      const rangeEnd = body.rangeEnd;
      const originalText = body.originalText;
      const instruction = typeof body.instruction === "string" ? body.instruction.trim() : "";
      const locale = body.locale === "zh" ? "zh" : "en";
      if (!node || node.kind !== "document") throw new Error("Range rewrite requires a document node");
      if (!Number.isInteger(rangeStart) || !Number.isInteger(rangeEnd) || typeof originalText !== "string" || !instruction) {
        throw new Error("Range rewrite selection and instruction are required");
      }
      const start = rangeStart as number;
      const end = rangeEnd as number;
      if (start < 0 || end <= start || end > node.content.length || node.content.slice(start, end) !== originalText || originalText.includes("\n")) {
        throw new Error("Range rewrite selection is stale or crosses paragraphs");
      }
      const paragraphStart = Math.max(node.content.lastIndexOf("\n", start - 1) + 1, 0);
      const nextBreak = node.content.indexOf("\n", end);
      const paragraph = node.content.slice(paragraphStart, nextBreak < 0 ? node.content.length : nextBreak);
      const result = await generationService.generateAndRecord({
        mode: "freeText",
        locale,
        threadId: request.params.threadId,
        agentCardId: typeof body.agentCardId === "string" ? body.agentCardId : undefined,
        modelOverrides: readModelOverrides(body.modelOverrides),
        systemPrompt: "Rewrite only the selected text. Return replacement text only, with no explanation, labels, quotes, or markdown fences. Preserve the surrounding language and tone.",
        freeTextPrompt: instruction,
        contextValues: { selectedText: originalText, containingParagraph: paragraph }
      });
      const replacement = result.text.trim();
      if (!replacement) throw new Error("Range rewrite returned empty text");
      const writeRequest = canvasService.createWriteRequest(request.params.threadId, {
        operation: "replace_range",
        targetNodeId: node.id,
        nodeKind: "document",
        title: node.title,
        content: replacement,
        rationale: instruction,
        rangeStart: start,
        rangeEnd: end,
        originalText,
        baseNodeUpdatedAt: node.updatedAt
      });
      sendOk(response, { request: writeRequest });
    } catch (error) {
      sendError(response, 400, "bad_request", errorMessage(error, "Unable to create range rewrite"));
    }
  });
}

function readModelOverrides(value: unknown): GenerateRequest["modelOverrides"] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const input = value as Record<string, unknown>;
  const thinkingMode = input.thinkingMode === "enabled" || input.thinkingMode === "disabled" ? input.thinkingMode : undefined;
  const effort = input.reasoningEffort;
  const reasoningEffort = effort === "high" || effort === "max" || effort === "low" || effort === "medium" || effort === "xhigh" ? effort : undefined;
  return thinkingMode || reasoningEffort ? { thinkingMode, reasoningEffort } : undefined;
}

function writeSse(response: Response, event: string, payload: unknown) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
}
