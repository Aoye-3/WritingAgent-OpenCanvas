export function splitCanvasText(content: string, target = 1200) {
  const blocks = content.trim().split(/\n{2,}|(?=^#{1,6}\s)/m).map((block) => block.trim()).filter(Boolean);
  const chunks: string[] = [];
  for (const block of blocks) {
    if (block.length <= target) {
      const last = chunks.at(-1);
      if (last && last.length + block.length + 2 <= target) chunks[chunks.length - 1] = `${last}\n\n${block}`;
      else chunks.push(block);
      continue;
    }
    for (let offset = 0; offset < block.length; offset += target) chunks.push(block.slice(offset, offset + target));
  }
  return chunks.length ? chunks : [content];
}

export function stableDeliveryId(prefix: "node" | "edge", deliveryId: string, index: number) {
  return `${prefix}_${deliveryId}_${index}`.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 120);
}

export function extractTopLevelListItems(markdown: string) {
  const lines = markdown.split(/\r?\n/);
  const items: Array<{ title: string; content: string }> = [];
  let current: string[] | undefined;
  for (const line of lines) {
    const match = line.match(/^(?:[-*+]\s+|\d+[.)]\s+)(.+)$/);
    if (match) {
      if (current) items.push(toItem(current));
      current = [match[1].trim()];
    } else if (current && (line.startsWith("  ") || !line.trim())) {
      current.push(line.trim());
    } else if (current) {
      items.push(toItem(current));
      current = undefined;
    }
  }
  if (current) items.push(toItem(current));
  return items.length >= 3 ? items : [];
}

function toItem(lines: string[]) {
  const content = lines.filter(Boolean).join("\n\n");
  const title = content.replace(/^#+\s*/, "").replace(/\*\*/g, "").split(/[。.!?\n]/)[0].slice(0, 80) || "Canvas item";
  return { title, content };
}
