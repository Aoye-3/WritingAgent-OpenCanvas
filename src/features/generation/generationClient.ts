import type { GenerateRequest, GenerateResponse } from "./types";
import { apiPost } from "../../shared/apiClient";

export async function generateText(payload: GenerateRequest): Promise<GenerateResponse> {
  return apiPost<GenerateResponse>("/api/generate", payload);
}

export async function generateTextStream(
  payload: GenerateRequest,
  handlers: {
    onToken?: (token: string) => void;
    onToolEvent?: (event: unknown) => void;
  } = {}
): Promise<GenerateResponse> {
  const response = await fetch("/api/generate/stream", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload)
  });

  if (!response.ok || !response.body) {
    throw new Error(`Streaming generation request failed with ${response.status}`);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finalResult: GenerateResponse | null = null;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";
    for (const rawEvent of events) {
      const parsed = parseSseEvent(rawEvent);
      if (!parsed) continue;
      if (parsed.event === "token") {
        handlers.onToken?.(String((parsed.data as { text?: unknown }).text ?? ""));
      } else if (parsed.event === "tool_event") {
        handlers.onToolEvent?.(parsed.data);
      } else if (parsed.event === "final") {
        finalResult = parsed.data as GenerateResponse;
      } else if (parsed.event === "error") {
        const message = String((parsed.data as { message?: unknown }).message ?? "Streaming generation failed");
        throw new Error(message);
      }
    }
  }

  if (!finalResult) {
    throw new Error("Streaming generation ended without a final response");
  }

  return finalResult;
}

function parseSseEvent(raw: string) {
  const event = raw.split("\n").find((line) => line.startsWith("event: "))?.slice(7).trim();
  const dataLine = raw.split("\n").find((line) => line.startsWith("data: "));
  if (!event || !dataLine) return null;
  return { event, data: JSON.parse(dataLine.slice(6)) as unknown };
}
