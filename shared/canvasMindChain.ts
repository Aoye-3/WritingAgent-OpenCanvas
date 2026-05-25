export type MindChainNode = {
  id: string;
  kind: string;
  title: string;
  content: string;
};

export type MindChainEdge = {
  sourceNodeId: string;
  targetNodeId: string;
};

export function formatMindChain(nodeId: string, nodes: MindChainNode[], edges: MindChainEdge[], locale: "en" | "zh") {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const startId = findChainStart(nodeId, edges);
  const orderedIds = followDirectedChain(startId, edges);
  const orderedNodes = orderedIds.map((id) => nodeById.get(id)).filter((node): node is MindChainNode => Boolean(node));
  if (orderedNodes.length === 0) return "";
  const title = locale === "zh" ? "请基于以下 Canvas 思维链协作：" : "Please collaborate using this Canvas mind chain:";
  return [
    title,
    ...orderedNodes.map((node, index) => [
      `${index + 1}. [${node.kind}] ${node.title || node.id}`,
      node.content.trim() || (locale === "zh" ? "（空节点）" : "(empty node)")
    ].join("\n"))
  ].join("\n\n");
}

export function findChainStart(nodeId: string, edges: MindChainEdge[]) {
  const incoming = new Map(edges.map((edge) => [edge.targetNodeId, edge.sourceNodeId]));
  const seen = new Set<string>();
  let current = nodeId;
  while (incoming.has(current) && !seen.has(current)) {
    seen.add(current);
    current = incoming.get(current) ?? current;
  }
  return current;
}

export function followDirectedChain(startId: string, edges: MindChainEdge[]) {
  const outgoing = new Map(edges.map((edge) => [edge.sourceNodeId, edge.targetNodeId]));
  const ordered = [startId];
  const seen = new Set<string>(ordered);
  let current = startId;
  while (outgoing.has(current)) {
    const next = outgoing.get(current);
    if (!next || seen.has(next)) break;
    ordered.push(next);
    seen.add(next);
    current = next;
  }
  return ordered;
}
