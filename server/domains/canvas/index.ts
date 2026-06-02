import type {
  CanvasEdgeInput,
  CanvasNodeInput,
  CanvasNodePatch,
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
    getCanvas(threadId: string) {
      const thread = storage.getThread(threadId);
      if (!thread) return undefined;
      storage.migrateCanvasWorkflowRoleNodes(threadId);
      return {
        nodes: storage.listCanvasNodes(threadId),
        edges: storage.listCanvasEdges(threadId),
        writeRequests: storage.listCanvasWriteRequests(threadId, "pending"),
        workflow: storage.getCanvasWorkflow(threadId),
        suggestions: storage.listCanvasWorkflowSuggestions(threadId)
      };
    },

    updateWorkflow(threadId: string, input: CanvasWorkflowInput) {
      return storage.updateCanvasWorkflow(threadId, input);
    },

    updateNodeWorkflow(threadId: string, nodeId: string, patch: CanvasNodeWorkflowPatch) {
      return storage.updateCanvasNodeWorkflow(threadId, nodeId, patch);
    },

    createSuggestion(threadId: string, input: CanvasWorkflowSuggestionInput) {
      return storage.createCanvasWorkflowSuggestion(threadId, input);
    },

    acceptSuggestion(threadId: string, suggestionId: string) {
      return storage.acceptCanvasWorkflowSuggestion(threadId, suggestionId);
    },

    ignoreSuggestion(threadId: string, suggestionId: string) {
      return storage.ignoreCanvasWorkflowSuggestion(threadId, suggestionId);
    },

    convertSuggestionToNode(threadId: string, suggestionId: string, input: CanvasSuggestionToNodeInput) {
      return storage.convertCanvasWorkflowSuggestionToNode(threadId, suggestionId, input);
    },

    createNode(threadId: string, input: CanvasNodeInput) {
      return storage.createCanvasNode(threadId, input);
    },

    updateNode(threadId: string, nodeId: string, patch: CanvasNodePatch) {
      return storage.updateCanvasNode(threadId, nodeId, patch);
    },

    deleteNode(threadId: string, nodeId: string) {
      return storage.deleteCanvasNode(threadId, nodeId);
    },

    createEdge(threadId: string, input: CanvasEdgeInput) {
      return storage.createCanvasEdge(threadId, input);
    },

    deleteEdge(threadId: string, edgeId: string) {
      return storage.deleteCanvasEdge(threadId, edgeId);
    },

    createWriteRequest(threadId: string, input: CanvasWriteRequestInput) {
      return storage.createCanvasWriteRequest(threadId, input);
    },

    approveWriteRequest(threadId: string, requestId: string) {
      return storage.approveCanvasWriteRequest(threadId, requestId);
    },

    rejectWriteRequest(threadId: string, requestId: string) {
      return storage.rejectCanvasWriteRequest(threadId, requestId);
    }
  };
}
