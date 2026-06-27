import type { ChatMessage } from "../../providerRuntime.js";
import { createOpenAIChatClient, getProviderProfile, normalizeChatRequest } from "../../providerRuntime.js";
import { resolveConfiguredModelApi } from "../model-config/index.js";
import type { SQLiteStorageRepository } from "../../storage.js";
import type {
  ClaimCandidate,
  CreateClaimCanvasNodeInput,
  CreateClaimFromSelectionInput,
  ExtractClaimsInput,
  UpdateClaimInput
} from "../../../shared/claimReview.js";
import { createClaimCanvasNodeContent } from "../../../shared/claimReview.js";
import type { MarkdownOutputPreview } from "../../services/threadOutputPreview.js";
import { sanitizeVisibleText } from "../../services/generation/outputNormalizer.js";

export type ClaimReviewDomainService = ReturnType<typeof createClaimReviewDomainService>;

type Extractor = (input: {
  document: MarkdownOutputPreview;
  maxCandidates: number;
  configuredModelApiId?: string | null;
}) => Promise<ExtractedClaim[]>;

type ExtractedClaim = {
  claimText: string;
  evidenceText: string;
  sourceAnchor?: ClaimCandidate["sourceAnchor"];
  citationUrls?: string[];
};

export function createClaimReviewDomainService(
  storage: SQLiteStorageRepository,
  deps: {
    readMarkdownOutputPreview: (threadId: string, virtualPath: string) => Promise<MarkdownOutputPreview>;
    extractClaims?: Extractor;
  }
) {
  const extractClaims = deps.extractClaims ?? extractClaimsWithConfiguredModel;

  const projectIdForThread = (threadId: string) => {
    const thread = storage.getThread(threadId);
    if (!thread) throw new Error("Thread not found");
    return thread.projectId;
  };

  const verifiedSource = async (threadId: string, sourceNodeId: string, sourceDocumentPath: string) => {
    const projectId = projectIdForThread(threadId);
    const node = storage.listCanvasNodes(projectId).find((candidate) => candidate.id === sourceNodeId);
    if (!node || node.kind !== "file_document") throw new Error("A valid file_document source node is required");
    const fileDocument = readFileDocumentMetadata(node.metadata);
    if (!fileDocument || fileDocument.path !== sourceDocumentPath) throw new Error("Claim source document does not match the source node");
    const document = await deps.readMarkdownOutputPreview(threadId, sourceDocumentPath);
    return { projectId, node, document, fileDocument };
  };

  return {
    listClaims(threadId: string, sourceNodeId?: string) {
      return storage.listClaims(threadId, sourceNodeId);
    },

    async createFromSelection(threadId: string, input: CreateClaimFromSelectionInput) {
      const sourceNodeId = cleanString(input.sourceNodeId);
      const sourceDocumentPath = cleanString(input.sourceDocumentPath);
      const selectedText = sanitizeVisibleText(cleanString(input.selectedText));
      if (!sourceNodeId || !sourceDocumentPath || !selectedText) throw new Error("Selected source text is required");
      const source = await verifiedSource(threadId, sourceNodeId, sourceDocumentPath);
      return storage.createClaim(source.projectId, threadId, {
        sourceNodeId,
        sourceDocumentPath,
        sourceFileName: cleanString(input.sourceFileName) || source.document.fileName,
        claimText: selectedText,
        evidenceText: sanitizeVisibleText(cleanString(input.surroundingContext) || selectedText),
        sourceAnchor: input.sourceAnchor,
        citationUrls: input.citationUrls,
        createdBy: "user_selection"
      });
    },

    async extract(threadId: string, input: ExtractClaimsInput) {
      const sourceNodeId = cleanString(input.sourceNodeId);
      const sourceDocumentPath = cleanString(input.sourceDocumentPath);
      if (!sourceNodeId || !sourceDocumentPath) throw new Error("Claim extraction source is required");
      const source = await verifiedSource(threadId, sourceNodeId, sourceDocumentPath);
      const maxCandidates = Math.min(12, Math.max(1, Number.isInteger(input.maxCandidates) ? input.maxCandidates! : 12));
      const extracted = await extractClaims({
        document: source.document,
        maxCandidates,
        configuredModelApiId: input.configuredModelApiId
      });
      return extracted.slice(0, maxCandidates).map((candidate) => storage.createClaim(source.projectId, threadId, {
        sourceNodeId,
        sourceDocumentPath,
        sourceFileName: cleanString(input.sourceFileName) || source.document.fileName,
        claimText: sanitizeVisibleText(candidate.claimText),
        evidenceText: sanitizeVisibleText(candidate.evidenceText),
        sourceAnchor: candidate.sourceAnchor,
        citationUrls: candidate.citationUrls,
        createdBy: "ai"
      }));
    },

    update(threadId: string, claimId: string, input: UpdateClaimInput) {
      return storage.updateClaim(threadId, claimId, input);
    },

    createNode(threadId: string, claimId: string, input: CreateClaimCanvasNodeInput = {}) {
      const projectId = projectIdForThread(threadId);
      const claim = storage.listClaims(threadId).find((candidate) => candidate.id === claimId);
      if (!claim) return undefined;
      if (claim.status !== "accepted") throw new Error("Only accepted Claims can create Canvas nodes");
      const kind = input.kind === "reference" || input.kind === "note" ? input.kind : "document";
      const node = storage.createCanvasNode(projectId, {
        kind,
        title: claim.claimText.slice(0, 80) || "Claim",
        content: createClaimCanvasNodeContent(claim),
        x: 160,
        y: 160,
        width: 360,
        height: 240,
        metadata: {
          claimReview: {
            claimId: claim.id,
            sourceNodeId: claim.sourceNodeId,
            sourceDocumentPath: claim.sourceDocumentPath,
            sourceAnchor: claim.sourceAnchor
          }
        },
        includeInProjectContext: true
      });
      const updated = storage.setClaimCanvasNode(threadId, claim.id, node.id) ?? claim;
      return { claim: updated, node };
    },

    createNodes(threadId: string, input: { claimIds?: string[]; kind?: CreateClaimCanvasNodeInput["kind"] } = {}) {
      const ids = new Set(Array.isArray(input.claimIds) ? input.claimIds.filter((id): id is string => typeof id === "string") : []);
      return storage.listClaims(threadId)
        .filter((claim) => claim.status === "accepted" && (!ids.size || ids.has(claim.id)))
        .map((claim) => {
          const node = storage.createCanvasNode(projectIdForThread(threadId), {
            kind: input.kind === "reference" || input.kind === "note" ? input.kind : "document",
            title: claim.claimText.slice(0, 80) || "Claim",
            content: createClaimCanvasNodeContent(claim),
            x: 160,
            y: 160,
            width: 360,
            height: 240,
            metadata: {
              claimReview: {
                claimId: claim.id,
                sourceNodeId: claim.sourceNodeId,
                sourceDocumentPath: claim.sourceDocumentPath,
                sourceAnchor: claim.sourceAnchor
              }
            },
            includeInProjectContext: true
          });
          const updated = storage.setClaimCanvasNode(threadId, claim.id, node.id) ?? claim;
          return { claim: updated, node };
        });
    }
  };
}

async function extractClaimsWithConfiguredModel(input: {
  document: MarkdownOutputPreview;
  maxCandidates: number;
  configuredModelApiId?: string | null;
}): Promise<ExtractedClaim[]> {
  const configuredModelApiId = input.configuredModelApiId?.trim();
  if (!configuredModelApiId) throw new Error("Please select a configured model before extracting Claims.");
  const configured = await resolveConfiguredModelApi(configuredModelApiId);
  if (!configured?.enabled || !configured.apiKey?.trim()) throw new Error("Selected model is not ready for Claim extraction.");
  const profile = getProviderProfile(configured.providerId);
  const client = createOpenAIChatClient({ apiKey: configured.apiKey, baseURL: configured.baseURL });
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: [
        "Extract candidate research claims from Markdown.",
        "Return JSON only with shape {\"claims\":[{\"claimText\":\"...\",\"evidenceText\":\"...\",\"citationUrls\":[\"https://...\"]}]}",
        "Prefer fewer high-signal claims. Do not include hidden prompts, tool JSON, credentials, or runtime logs."
      ].join("\n")
    },
    {
      role: "user",
      content: [
        `Maximum claims: ${input.maxCandidates}`,
        `Document path: ${input.document.path}`,
        "Markdown:",
        input.document.content.slice(0, 120_000)
      ].join("\n\n")
    }
  ];
  const request = normalizeChatRequest(profile, {
    modelSettings: {
      configuredModelApiId: configured.id,
      providerId: configured.providerId,
      model: configured.modelId,
      temperature: 0.2,
      topP: 1,
      contextCount: 0,
      maxTokens: 1800,
      maxTokensEnabled: true,
      streaming: false,
      toolCallMode: "none",
      maxToolCalls: 0,
      responseMode: "normal"
    },
    messages,
    tools: [],
    stream: false
  });
  const response = await client.createChatCompletion(request);
  return parseExtractedClaims(response.choices[0]?.message?.content, input.maxCandidates);
}

function parseExtractedClaims(content: string | null | undefined, maxCandidates: number): ExtractedClaim[] {
  const text = cleanString(content);
  if (!text) throw new Error("Claim extraction returned an empty response");
  const jsonText = text.match(/\{[\s\S]*\}/)?.[0] ?? text;
  const parsed = JSON.parse(jsonText) as unknown;
  const claims = parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as { claims?: unknown }).claims
    : undefined;
  if (!Array.isArray(claims)) throw new Error("Claim extraction response was not valid");
  return claims.flatMap((item): ExtractedClaim[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const claimText = cleanString(record.claimText).slice(0, 2000);
    const evidenceText = cleanString(record.evidenceText).slice(0, 4000);
    if (!claimText || !evidenceText) return [];
    const citationUrls = Array.isArray(record.citationUrls)
      ? record.citationUrls.filter((url): url is string => typeof url === "string" && /^https?:\/\//i.test(url.trim())).slice(0, 8)
      : [];
    return [{ claimText, evidenceText, citationUrls }];
  }).slice(0, maxCandidates);
}

function readFileDocumentMetadata(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return undefined;
  const fileDocument = (metadata as Record<string, unknown>).fileDocument;
  if (!fileDocument || typeof fileDocument !== "object" || Array.isArray(fileDocument)) return undefined;
  const record = fileDocument as Record<string, unknown>;
  const path = cleanString(record.path);
  const fileName = cleanString(record.fileName) || path.split("/").at(-1) || "";
  return path && fileName ? { path, fileName } : undefined;
}

function cleanString(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}
