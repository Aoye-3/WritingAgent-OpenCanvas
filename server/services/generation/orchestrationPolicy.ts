export type OrchestrationPolicy = {
  mode: "direct" | "guided" | "managed_plan";
  trigger: "ordinary" | "explicit_plan";
  clarificationPolicy: "when_needed" | "required_once";
  deliveryPolicy: "conversation_only" | "canvas_required";
};

export function resolveOrchestrationPolicy(instruction = ""): OrchestrationPolicy {
  if (/^\s*\/plan\b/i.test(instruction)) {
    return { mode: "managed_plan", trigger: "explicit_plan", clarificationPolicy: "required_once", deliveryPolicy: "canvas_required" };
  }
  const multiStage = countMatches(instruction, /\b(?:analy[sz]e|research|compare|design|implement|test|verify|write|deliver|recommend)\b|分析|研究|对比|设计|实现|测试|验证|撰写|交付|建议/gi) >= 3;
  const durable = /\b(?:multi[- ]stage|project|report|deliverables?|step[- ]by[- ]step)\b|多阶段|长期|项目|报告|分步执行|交付物/i.test(instruction);
  if (multiStage && durable) {
    return { mode: "managed_plan", trigger: "ordinary", clarificationPolicy: "when_needed", deliveryPolicy: "conversation_only" };
  }
  if (multiStage || instruction.length > 500) {
    return { mode: "guided", trigger: "ordinary", clarificationPolicy: "when_needed", deliveryPolicy: "conversation_only" };
  }
  return { mode: "direct", trigger: "ordinary", clarificationPolicy: "when_needed", deliveryPolicy: "conversation_only" };
}

function countMatches(value: string, pattern: RegExp) {
  return [...value.matchAll(pattern)].length;
}
