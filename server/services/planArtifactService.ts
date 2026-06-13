import { lookup } from "node:dns/promises";
import net from "node:net";
import path from "node:path";
import type { SQLiteStorageRepository } from "../storage.js";
import type { PlanArtifact, PlanArtifactLink } from "../storageTypes.js";
import { splitCanvasText, stableDeliveryId } from "./canvasDelivery.js";

const maxImageBytes = 10 * 1024 * 1024;
const imageTypes = new Map([["image/png", ".png"], ["image/jpeg", ".jpg"], ["image/gif", ".gif"], ["image/webp", ".webp"]]);

type TextSection = { id: string; title: string; content: string };

export async function commitPlanArtifact(storage: SQLiteStorageRepository, threadId: string, planId: string, artifactId: string, fetchImpl: typeof fetch = fetch): Promise<PlanArtifact> {
  const plan = storage.getPlanRun(threadId, planId);
  if (!plan || plan.approval !== "approved") throw new Error("Plan must be approved before committing artifacts");
  const artifact = plan.artifacts.find((item) => item.id === artifactId);
  if (!artifact) throw new Error("Artifact not found");
  if (artifact.status === "committed" && artifact.canvasTargetId) return artifact;
  try {
    const payload = record(artifact.payload);
    const targetId = artifact.type === "text"
      ? commitTextArtifact(storage, plan, artifact, payload)
      : await commitImageArtifact(storage, plan.projectId, artifact, payload, fetchImpl);
    return storage.markPlanArtifactCommitted(threadId, planId, artifactId, targetId)!;
  } catch (error) {
    storage.markPlanArtifactFailed(threadId, planId, artifactId, error instanceof Error ? error.message : "Artifact commit failed");
    throw error;
  }
}

function commitTextArtifact(storage: SQLiteStorageRepository, plan: NonNullable<ReturnType<SQLiteStorageRepository["getPlanRun"]>>, artifact: PlanArtifact, payload: Record<string, unknown>) {
  const content = string(payload.content);
  const sections = artifactSections(artifact.title, payload);
  if (!content && sections.length === 0) throw new Error("Text artifact content is required");
  const nodeKind = payload.nodeKind === "reference" || payload.nodeKind === "note" ? payload.nodeKind : "document";
  const artifactIndex = Math.max(0, plan.artifacts.findIndex((item) => item.id === artifact.id));
  const sourceSections = uniqueSectionIds(sections.length ? sections : markdownSections(artifact.title, content));
  const existingNodes = new Set(storage.listCanvasNodes(plan.projectId).map((node) => node.id));
  const existingEdges = new Set(storage.listCanvasEdges(plan.projectId).map((edge) => edge.id));
  const nodeIds: string[] = [];
  const sectionFirstNodeIds: string[] = [];

  sourceSections.forEach((section, sectionIndex) => {
    const pages = splitCanvasText(section.content);
    const sectionNodeIds: string[] = [];
    pages.forEach((page, pageIndex) => {
      const id = stableDeliveryId("node", `${plan.id}_${artifact.id}_${section.id}`, pageIndex + 1);
      const title = pages.length === 1 ? section.title : `${section.title} ${pageIndex + 1}/${pages.length}`;
      const metadata = { planArtifact: { planId: plan.id, artifactId: artifact.id, stepId: artifact.stepId, sectionId: section.id, sectionIndex, pageIndex, pageCount: pages.length } };
      if (existingNodes.has(id)) {
        storage.updateCanvasNode(plan.projectId, id, { title, content: page, metadata, includeInProjectContext: true });
      } else {
        const column = sectionIndex % 3;
        const row = Math.floor(sectionIndex / 3);
        storage.createCanvasNode(plan.projectId, {
          id,
          kind: nodeKind,
          title,
          content: page,
          x: 560 + column * 380,
          y: 120 + artifactIndex * 340 + row * 300 + pageIndex * 260,
          metadata,
          includeInProjectContext: true
        });
        existingNodes.add(id);
      }
      nodeIds.push(id);
      sectionNodeIds.push(id);
    });
    if (sectionNodeIds[0]) sectionFirstNodeIds.push(sectionNodeIds[0]);
    for (let index = 1; index < sectionNodeIds.length; index += 1) {
      const id = stableDeliveryId("edge", `${plan.id}_${artifact.id}_${section.id}`, index);
      if (!existingEdges.has(id)) {
        storage.createCanvasEdge(plan.projectId, { id, sourceNodeId: sectionNodeIds[index - 1], targetNodeId: sectionNodeIds[index], label: "continues" });
        existingEdges.add(id);
      }
    }
  });

  if (plan.canvasNodeId) {
    for (const [index, nodeId] of sectionFirstNodeIds.entries()) {
      const id = stableDeliveryId("edge", `${plan.id}_${artifact.id}_plan`, index + 1);
      if (!existingEdges.has(id)) {
        storage.createCanvasEdge(plan.projectId, { id, sourceNodeId: plan.canvasNodeId, targetNodeId: nodeId, label: artifact.title });
        existingEdges.add(id);
      }
    }
  }

  return nodeIds[0];
}

async function commitImageArtifact(storage: SQLiteStorageRepository, projectId: string, artifact: PlanArtifact, payload: Record<string, unknown>, fetchImpl: typeof fetch) {
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
  return (await storage.createCanvasAsset(projectId, {
    fileName: safeName,
    fileBase64: bytes.toString("base64"),
    sourceUrl: imageUrl,
    pageUrl: string(source.pageUrl),
    caption: string(payload.caption) || string(source.caption),
    alt: string(payload.alt) || string(source.alt)
  })).id;
}

export function commitPlanArtifactLinks(storage: SQLiteStorageRepository, threadId: string, planId: string): PlanArtifactLink[] {
  const plan = storage.getPlanRun(threadId, planId);
  if (!plan || plan.approval !== "approved") throw new Error("Plan must be approved before committing artifact links");
  const nodeIds = new Set(storage.listCanvasNodes(plan.projectId).map((node) => node.id));
  const existingEdges = new Map(storage.listCanvasEdges(plan.projectId).map((edge) => [edge.id, edge]));
  return plan.links.map((link) => {
    if (link.canvasEdgeId) return link;
    const from = plan.artifacts.find((artifact) => artifact.id === link.fromArtifactId)?.canvasTargetId;
    const to = plan.artifacts.find((artifact) => artifact.id === link.toArtifactId)?.canvasTargetId;
    if (!from || !to || !nodeIds.has(from) || !nodeIds.has(to)) return link;
    const id = stableDeliveryId("edge", `${planId}_${link.id}`, 1);
    const existing = existingEdges.get(id);
    const edge = existing && existing.sourceNodeId === from && existing.targetNodeId === to && existing.label === link.label
      ? existing
      : storage.createCanvasEdge(plan.projectId, { id: existing ? stableDeliveryId("edge", `${planId}_${link.id}_repair`, 1) : id, sourceNodeId: from, targetNodeId: to, label: link.label });
    existingEdges.set(edge.id, edge);
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

function artifactSections(fallbackTitle: string, payload: Record<string, unknown>): TextSection[] {
  const values = Array.isArray(payload.sections) ? payload.sections : Array.isArray(payload.items) ? payload.items : [];
  return values
    .map((value, index) => {
      const item = record(value);
      const title = string(item.title) || string(item.label) || `${fallbackTitle} ${index + 1}`;
      const content = [string(item.summary), string(item.content) || string(item.body) || string(item.text)].filter(Boolean).join("\n\n");
      return { id: string(item.id) || `section_${index + 1}`, title, content };
    })
    .filter((section) => section.content);
}

function uniqueSectionIds(sections: TextSection[]) {
  const seen = new Map<string, number>();
  return sections.map((section, index) => {
    const fallback = `section_${index + 1}`;
    const base = section.id.replace(/[^A-Za-z0-9_-]/g, "_").replace(/^_+|_+$/g, "").slice(0, 64) || fallback;
    const next = (seen.get(base) ?? 0) + 1;
    seen.set(base, next);
    return { ...section, id: next === 1 ? base : `${base}_${next}` };
  });
}

function markdownSections(fallbackTitle: string, content: string): TextSection[] {
  const blocks = content.split(/(?=^#{1,3}\s+)/m).map((block) => block.trim()).filter(Boolean);
  if (blocks.length <= 1) return [{ id: "section_1", title: fallbackTitle, content }];
  return blocks.map((block, index) => {
    const heading = block.match(/^#{1,3}\s+(.+)$/m)?.[1]?.trim();
    return { id: `section_${index + 1}`, title: heading || `${fallbackTitle} ${index + 1}`, content: block };
  });
}

function isPrivateAddress(address: string) {
  if (address === "::1" || address === "0.0.0.0" || address.startsWith("fe80:") || address.startsWith("fc") || address.startsWith("fd")) return true;
  const parts = address.split(".").map(Number);
  return parts.length === 4 && (parts[0] === 10 || parts[0] === 127 || parts[0] === 0 || (parts[0] === 169 && parts[1] === 254) || (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) || (parts[0] === 192 && parts[1] === 168));
}

function record(value: unknown) { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" ? value.trim() : ""; }
