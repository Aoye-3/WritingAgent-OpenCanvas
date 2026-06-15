export type CanvasWorkflowStage = "inspiration" | "research" | "structure" | "writing" | "polish" | "publish";
export type CanvasWorkflowMode = "batch_delivery";
export type CanvasWorkflowSuggestionStatus = "pending" | "accepted" | "ignored";

export type CanvasWorkflowRole = {
  id: string;
  label: string;
  prompt: string;
};

export type CanvasWorkflowState = {
  mode: CanvasWorkflowMode;
  stage: CanvasWorkflowStage;
  stages: CanvasWorkflowStage[];
  roles: CanvasWorkflowRole[];
};

export type CanvasWorkflowNodeMetadata = Record<string, unknown> & {
  workflow?: {
    stage?: CanvasWorkflowStage;
    roles?: string[];
  };
};

export type CanvasWorkflowRoleNodeMetadata = Record<string, unknown> & {
  workflowRole?: {
    roleId?: string;
    label?: string;
    prompt?: string;
    description?: string;
  };
};

export type CanvasWorkflowSuggestion = {
  id: string;
  nodeId: string;
  roleNodeId: string;
  targetNodeId: string;
  roleId: string;
  content: string;
  rationale: string;
  status: CanvasWorkflowSuggestionStatus;
  createdAt: string;
  updatedAt: string;
};

export type CanvasWorkflowContextNode = {
  id: string;
  kind?: string;
  title: string;
  content: string;
  metadata: unknown;
};

export type CanvasWorkflowContextEdge = {
  sourceNodeId: string;
  targetNodeId: string;
};

export type CanvasWorkflowContextRole = {
  nodeId: string;
  roleId: string;
  label: string;
  prompt: string;
  description?: string;
  targetNodeIds: string[];
};

export type CanvasWorkflowContext = {
  stage: CanvasWorkflowStage;
  roleIds: string[];
  nodes: CanvasWorkflowContextNode[];
  roles: CanvasWorkflowContextRole[];
};

export const canvasWorkflowStages: CanvasWorkflowStage[] = ["inspiration", "research", "structure", "writing", "polish", "publish"];
export const canvasWorkflowModes: CanvasWorkflowMode[] = ["batch_delivery"];

export const defaultCanvasWorkflowRoles: CanvasWorkflowRole[] = [
  { id: "structure", label: "Structure", prompt: "Review structure, sequence, and argument flow." },
  { id: "evidence", label: "Evidence", prompt: "Check support, sources, and factual grounding." },
  { id: "style", label: "Style", prompt: "Improve tone, clarity, rhythm, and wording." },
  { id: "reader", label: "Reader", prompt: "Respond from the target reader's point of view." },
  { id: "counterpoint", label: "Counterpoint", prompt: "Challenge assumptions and identify weak claims." }
];

export function defaultCanvasWorkflow(): CanvasWorkflowState {
  return {
    mode: "batch_delivery",
    stage: "inspiration",
    stages: [...canvasWorkflowStages],
    roles: defaultCanvasWorkflowRoles.map((role) => ({ ...role }))
  };
}

export function updateCanvasWorkflowStage(workflow: CanvasWorkflowState, stage: CanvasWorkflowStage): CanvasWorkflowState {
  return { ...workflow, stage };
}

export function nextCanvasWorkflowNodeMetadata(
  workflow: Pick<CanvasWorkflowState, "stage">,
  metadata: CanvasWorkflowNodeMetadata = {}
): CanvasWorkflowNodeMetadata {
  return {
    ...metadata,
    workflow: {
      ...(metadata.workflow ?? {}),
      stage: metadata.workflow?.stage ?? workflow.stage,
      ...(metadata.workflow?.roles ? { roles: metadata.workflow.roles } : {})
    }
  };
}

export function mergeCanvasWorkflowRoles(
  metadata: CanvasWorkflowNodeMetadata,
  roleIds: string[],
  availableRoles: CanvasWorkflowRole[]
): CanvasWorkflowNodeMetadata {
  const available = new Set(availableRoles.map((role) => role.id));
  const current = metadata.workflow?.roles ?? [];
  const roles = [...current, ...roleIds].filter((roleId, index, values) => available.has(roleId) && values.indexOf(roleId) === index);
  return {
    ...metadata,
    workflow: {
      ...(metadata.workflow ?? {}),
      roles
    }
  };
}

export function createCanvasWorkflowSuggestion(input: {
  nodeId?: string;
  roleNodeId?: string;
  targetNodeId?: string;
  roleId: string;
  content: string;
  rationale?: string;
}): CanvasWorkflowSuggestion {
  const now = new Date().toISOString();
  const roleNodeId = input.roleNodeId ?? input.nodeId ?? "";
  const targetNodeId = input.targetNodeId ?? "";
  return {
    id: `suggestion_${randomId()}`,
    nodeId: roleNodeId,
    roleNodeId,
    targetNodeId,
    roleId: input.roleId,
    content: input.content.trim(),
    rationale: (input.rationale ?? "").trim(),
    status: "pending",
    createdAt: now,
    updatedAt: now
  };
}

export function acceptCanvasWorkflowSuggestion(suggestion: CanvasWorkflowSuggestion): CanvasWorkflowSuggestion {
  return { ...suggestion, status: "accepted", updatedAt: new Date().toISOString() };
}

export function ignoreCanvasWorkflowSuggestion(suggestion: CanvasWorkflowSuggestion): CanvasWorkflowSuggestion {
  return { ...suggestion, status: "ignored", updatedAt: new Date().toISOString() };
}

export function buildCanvasWorkflowContext(input: {
  workflow: CanvasWorkflowState;
  nodes: CanvasWorkflowContextNode[];
  edges?: CanvasWorkflowContextEdge[];
  chainNodeIds?: string[];
  stage?: CanvasWorkflowStage;
  roleIds?: string[];
}): CanvasWorkflowContext {
  const mode = input.workflow.mode;
  const stage = input.stage ?? input.workflow.stage;
  const roleIds = input.roleIds ?? [];
  const chain = input.chainNodeIds ? new Set(input.chainNodeIds) : undefined;
  const roleFilter = roleIds.length > 0 ? new Set(roleIds) : undefined;
  const nodes = input.nodes.filter((node) => {
    if (node.kind === "role") return false;
    if (chain && !chain.has(node.id)) return false;
    const metadata = readWorkflowMetadata(node.metadata);
    if (mode === "batch_delivery" && metadata.stage !== stage) return false;
    return true;
  });
  const targetNodeIds = nodes.map((node) => node.id);
  const roles = findConnectedWorkflowRoles({ nodes: input.nodes, edges: input.edges ?? [], targetNodeIds })
    .filter((role) => !roleFilter || roleFilter.has(role.roleId));

  return { stage, roleIds, nodes, roles };
}

export function readWorkflowMetadata(metadata: unknown): { stage?: CanvasWorkflowStage; roles: string[] } {
  if (!metadata || typeof metadata !== "object") return { roles: [] };
  const workflow = (metadata as { workflow?: unknown }).workflow;
  if (!workflow || typeof workflow !== "object") return { roles: [] };
  const stage = (workflow as { stage?: unknown }).stage;
  const roles = (workflow as { roles?: unknown }).roles;
  return {
    stage: isCanvasWorkflowStage(stage) ? stage : undefined,
    roles: Array.isArray(roles) ? roles.filter((role): role is string => typeof role === "string") : []
  };
}

export function readWorkflowRoleMetadata(metadata: unknown): { roleId: string; label: string; prompt: string; description?: string } | undefined {
  if (!metadata || typeof metadata !== "object") return undefined;
  const workflowRole = (metadata as { workflowRole?: unknown }).workflowRole;
  if (!workflowRole || typeof workflowRole !== "object") return undefined;
  const roleId = cleanRoleText((workflowRole as { roleId?: unknown }).roleId);
  const label = cleanRoleText((workflowRole as { label?: unknown }).label);
  const prompt = cleanRoleText((workflowRole as { prompt?: unknown }).prompt);
  const description = cleanRoleText((workflowRole as { description?: unknown }).description);
  if (!roleId || !label || !prompt) return undefined;
  return description ? { roleId, label, prompt, description } : { roleId, label, prompt };
}

export function findConnectedWorkflowRoles(input: {
  nodes: Array<{ id: string; kind?: string; metadata: unknown }>;
  edges: CanvasWorkflowContextEdge[];
  targetNodeIds: string[];
}): CanvasWorkflowContextRole[] {
  const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
  const targetIds = new Set(input.targetNodeIds);
  const grouped = new Map<string, CanvasWorkflowContextRole>();
  for (const edge of input.edges) {
    if (!targetIds.has(edge.targetNodeId)) continue;
    const source = nodesById.get(edge.sourceNodeId);
    const target = nodesById.get(edge.targetNodeId);
    if (!source || source.kind !== "role" || target?.kind === "role") continue;
    const role = readWorkflowRoleMetadata(source.metadata);
    if (!role) continue;
    const existing = grouped.get(source.id);
    if (existing) {
      if (!existing.targetNodeIds.includes(edge.targetNodeId)) existing.targetNodeIds.push(edge.targetNodeId);
    } else {
      grouped.set(source.id, { nodeId: source.id, ...role, targetNodeIds: [edge.targetNodeId] });
    }
  }
  return [...grouped.values()];
}

export function isCanvasWorkflowStage(value: unknown): value is CanvasWorkflowStage {
  return typeof value === "string" && canvasWorkflowStages.includes(value as CanvasWorkflowStage);
}

export function isCanvasWorkflowMode(value: unknown): value is CanvasWorkflowMode {
  return typeof value === "string" && canvasWorkflowModes.includes(value as CanvasWorkflowMode);
}

function cleanRoleText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}
