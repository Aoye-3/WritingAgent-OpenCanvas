export type ParsedSseEvent = {
  event: string;
  data: unknown;
};

export function parseSseChunk(input: string): ParsedSseEvent[] {
  const blocks = input.replace(/\r\n/g, "\n").split(/\n\n+/);
  return blocks
    .map((block) => parseBlock(block))
    .filter((event): event is ParsedSseEvent => Boolean(event));
}

function parseBlock(block: string): ParsedSseEvent | undefined {
  const lines = block.split("\n").filter(Boolean);
  if (lines.length === 0) return undefined;

  let event = "message";
  const dataLines: string[] = [];
  const commentLines: string[] = [];
  for (const line of lines) {
    if (line.startsWith("event:")) {
      event = line.slice("event:".length).trim() || "message";
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice("data:".length).trimStart());
    } else if (line.startsWith(":")) {
      commentLines.push(line.slice(1).trim());
    }
  }

  if (dataLines.length === 0 && commentLines.length > 0) {
    return { event: "comment", data: commentLines.join("\n") };
  }
  if (dataLines.length === 0) return undefined;
  const rawData = dataLines.join("\n");
  return { event, data: parseData(rawData) };
}

function parseData(rawData: string): unknown {
  if (rawData === "[DONE]") return rawData;
  try {
    return JSON.parse(rawData) as unknown;
  } catch {
    return rawData;
  }
}
