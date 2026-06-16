import type {
  CanvasEdgeInput,
  CanvasNodeInput,
  CanvasNodePatch,
  CanvasNodePositionUpdate,
  CanvasObjectInput,
  CanvasObjectPatch,
  CanvasNodeWorkflowPatch,
  CanvasSuggestionToNodeInput,
  CanvasWorkflowInput,
  CanvasWorkflowSuggestionInput,
  CanvasWriteRequestInput,
  SQLiteStorageRepository
} from "../../storage.js";

export type CanvasDomainService = ReturnType<typeof createCanvasDomainService>;

export function createCanvasDomainService(storage: SQLiteStorageRepository) {
  return {
    projectIdForThread(threadId: string) {
      const thread = storage.getThread(threadId);
      if (!thread) throw new Error("A valid Thread is required for Project Canvas access");
      return thread.projectId;
    },

    getCanvas(projectId: string) {
      if (!storage.getProject(projectId)) return undefined;
      storage.migrateCanvasWorkflowRoleNodes(projectId);
      return {
        nodes: storage.listCanvasNodes(projectId),
        edges: storage.listCanvasEdges(projectId),
        objects: storage.listCanvasObjects?.(projectId) ?? [],
        writeRequests: storage.listCanvasWriteRequests(projectId, "pending"),
        workflow: storage.getCanvasWorkflow(projectId),
        suggestions: storage.listCanvasWorkflowSuggestions(projectId)
      };
    },

    updateWorkflow(projectId: string, input: CanvasWorkflowInput) {
      return storage.updateCanvasWorkflow(projectId, input);
    },

    updateNodeWorkflow(projectId: string, nodeId: string, patch: CanvasNodeWorkflowPatch) {
      return storage.updateCanvasNodeWorkflow(projectId, nodeId, patch);
    },

    createSuggestion(projectId: string, input: CanvasWorkflowSuggestionInput) {
      return storage.createCanvasWorkflowSuggestion(projectId, input);
    },

    acceptSuggestion(projectId: string, suggestionId: string) {
      return storage.acceptCanvasWorkflowSuggestion(projectId, suggestionId);
    },

    ignoreSuggestion(projectId: string, suggestionId: string) {
      return storage.ignoreCanvasWorkflowSuggestion(projectId, suggestionId);
    },

    convertSuggestionToNode(projectId: string, suggestionId: string, input: CanvasSuggestionToNodeInput) {
      return storage.convertCanvasWorkflowSuggestionToNode(projectId, suggestionId, input);
    },

    createNode(projectId: string, input: CanvasNodeInput) {
      if (input.kind === "plan") throw new Error("Plan nodes are managed by the Plan runtime");
      return storage.createCanvasNode(projectId, input);
    },

    updateNode(projectId: string, nodeId: string, patch: CanvasNodePatch) {
      const node = storage.listCanvasNodes(projectId).find((candidate) => candidate.id === nodeId);
      if (node?.kind === "plan" && (patch.kind !== undefined || patch.title !== undefined || patch.content !== undefined || patch.metadata !== undefined || patch.includeInProjectContext !== undefined)) {
        throw new Error("Plan node content is read-only");
      }
      return storage.updateCanvasNode(projectId, nodeId, patch);
    },

    updateNodePositions(projectId: string, updates: CanvasNodePositionUpdate[]) {
      return storage.updateCanvasNodePositions(projectId, updates);
    },

    deleteNode(projectId: string, nodeId: string) {
      return storage.deleteCanvasNode(projectId, nodeId);
    },

    createEdge(projectId: string, input: CanvasEdgeInput) {
      return storage.createCanvasEdge(projectId, input);
    },

    deleteEdge(projectId: string, edgeId: string) {
      return storage.deleteCanvasEdge(projectId, edgeId);
    },

    createObject(projectId: string, input: CanvasObjectInput) {
      return storage.createCanvasObject(projectId, input);
    },

    updateObject(projectId: string, objectId: string, patch: CanvasObjectPatch) {
      return storage.updateCanvasObject(projectId, objectId, patch);
    },

    deleteObject(projectId: string, objectId: string) {
      return storage.deleteCanvasObject(projectId, objectId);
    },

    createAsset(projectId: string, input: { fileName: string; fileBase64: string; sourceUrl?: string; pageUrl?: string; caption?: string; alt?: string }) {
      return storage.createCanvasAsset(projectId, input);
    },

    readAsset(projectId: string, objectId: string) {
      return storage.readCanvasAsset(projectId, objectId);
    },

    createWriteRequest(projectId: string, input: CanvasWriteRequestInput) {
      return storage.createCanvasWriteRequest(projectId, input);
    },
    acceptWriteSuggestion(threadId: string, suggestionId: string) {
      return storage.acceptCanvasWriteSuggestion(threadId, suggestionId);
    },
    dismissWriteSuggestion(threadId: string, suggestionId: string) {
      return storage.dismissCanvasWriteSuggestion(threadId, suggestionId);
    },

    approveWriteRequest(projectId: string, requestId: string) {
      return storage.approveCanvasWriteRequest(projectId, requestId);
    },

    rejectWriteRequest(projectId: string, requestId: string) {
      return storage.rejectCanvasWriteRequest(projectId, requestId);
    }
  };
}
