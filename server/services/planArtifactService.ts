import { lookup } from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import type { SQLiteStorageRepository } from "../storage.js";
import type { PlanArtifact, PlanArtifactLink } from "../storageTypes.js";
import { splitCanvasText, stableDeliveryId } from "./canvasDelivery.js";

const maxImageBytes = 10 * 1024 * 1024;
const imageTypes = new Map([["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/gif", ".gif"], ["image/webp", ".webp"]]);

export async function commitPlanArtifact(storage: SQLiteStorageRepository, threadId: string, planId: string, artifactId: string, fetchImpl: typeof fetch = fetch): Promise<PlanArtifact> {
  const plan = storage.getPlanRun(threadId, planId);
  if (!plan || plan.approval !== "approved") throw new Error("Plan must be approved before committing artifacts");
  const artifact = plan.artifacts.find((item) => item.id === artifactId);
  if (!artifact) throw new Error("Artifact not found");
  if (artifact.status === "committed" && artifact.canvasTargetId) return artifact;
  try {
    const payload = record(artifact.payload);
    let targetId: string;
    if (artifact.type === "text") {
      const content = string(payload.content);
      if (!content) throw new Error("Text artifact content is required");
      const nodeKind = payload.nodeKind === "reference" || payload.nodeKind === "note" ? payload.nodeKind : "document";
      const index = plan.artifacts.findIndex((item) => item.id === artifact.id);
      const chunks = splitCanvasText(content);
      const existingNodes = new Map(storage.listCanvasNodes(plan.projectId).map((node) => [node.id, node]));
      const existingEdges = new Set(storage.listCanvasEdges(plan.projectId).map((edge) => edge.id));
      const nodeIds = chunks.map((chunk, chunkIndex) => {
        const id = stableDeliveryId("node", `${planId}_${artifactId}`, chunkIndex + 1);
        if (!existingNodes.has(id)) {
          storage.createCanvasNode(plan.projectId, {
            id, kind: nodeKind, title: chunks.length === 1 ? artifact.title : `${artifact.title} ${chunkIndex + 1}/${chunks.length}`,
            content: chunk, x: 120 + (index % 3) * 380 + chunkIndex * 360, y: 120 + Math.floor(index / 3) * 300,
            metadata: { planArtifact: { planId, artifactId, chunkIndex, chunkCount: chunks.length } }
          });
        }
        return id;
      });
      for (let chunkIndex = 1; chunkIndex < nodeIds.length; chunkIndex += 1) {
        const id = stableDeliveryId("edge", `${planId}_${artifactId}`, chunkIndex);
        if (!existingEdges.has(id)) storage.createCanvasEdge(plan.projectId, { id, sourceNodeId: nodeIds[chunkIndex - 1], targetNodeId: nodeIds[chunkIndex], label: "continues" });
      }
      targetId = nodeIds[0];
    } else {
      const imageUrl = string(payload.imageUrl);
      await validatePublicImageUrl(imageUrl);
      const response = await fetchImpl(imageUrl, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Image download returned HTTP ${response.status}`);
      const contentType = response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() ?? "";
      const extension = imageTypes.get(contentType);
      if (!extension) throw new Error("Downloaded artifact is not a supported image");
      const declared = Number(response.headers.get("content-length") ?? 0);
      if (declared > maxImageBytes) throw new Error("Image artifact exceeds 10MB");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > maxImageBytes) throw new Error("Image artifact must be between 1 byte and 10MB");
      const safeName = `${path.parse(artifact.title).name.replace(/[^A-Za-z0-9_-]/g, "_") || artifact.id}${extension}`;
      const source = record(artifact.source);
      targetId = (await storage.createCanvasAsset(plan.projectId, {
        fileName: safeName,
        fileBase64: bytes.toString("base64"),
        sourceUrl: imageUrl,
        pageUrl: string(source.pageUrl),
        caption: string(payload.caption) || string(source.caption),
        alt: string(payload.alt) || string(source.alt)
      })).id;
    }
    return storage.markPlanArtifactCommitted(threadId, planId, artifactId, targetId)!;
  } catch (error) {
    storage.markPlanArtifactFailed(threadId, planId, artifactId, error instanceof Error ? error.message : "Artifact commit failed");
    throw error;
  }
}

export function commitPlanArtifactLinks(storage: SQLiteStorageRepository, threadId: string, planId: string): PlanArtifactLink[] {
  const plan = storage.getPlanRun(threadId, planId);
  if (!plan || plan.approval !== "approved") throw new Error("Plan must be approved before committing artifact links");
  const nodeIds = new Set(storage.listCanvasNodes(threadId).map((node) => node.id));
  return plan.links.map((link) => {
    if (link.canvasEdgeId) return link;
    const from = plan.artifacts.find((artifact) => artifact.id === link.fromArtifactId)?.canvasTargetId;
    const to = plan.artifacts.find((artifact) => artifact.id === link.toArtifactId)?.canvasTargetId;
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) return link;
    const edge = storage.createCanvasEdge(threadId, { sourceNodeId: from, targetNodeId: to, label: link.label });
    return storage.markPlanArtifactLinkCommitted(threadId, planId, link.id, edge.id) ?? link;
  });
}

export async function validatePublicImageUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Image URL must be a valid public http URL"); }
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("Image URL must use http or https");
  const addresses = net.isIP(url.hostname) ? [{ address: url.hostname }] : await lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) throw new Error("Image URL must resolve to a public address");
  return url;
}

function isPrivateAddress(address: string) {
  if (address === "::1" || address === "0.0.0.0" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  const parts = address.split(".").map(Number);
  return parts.length === 4 && (parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
