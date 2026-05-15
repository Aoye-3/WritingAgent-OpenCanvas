import type { GenerateRequest } from "../../contracts/generation.js";

export function mockText(payload: GenerateRequest) {
  const instruction = payload.chatInstruction?.trim() || payload.freeTextPrompt?.trim();
  if (payload.locale === "zh") {
    if (isChatMode(payload.mode)) {
      return instruction
        ? `我现在处于 Mock fallback 模式，无法调用真实模型。你刚才说：“${instruction}”。请先检查模型连接，恢复后我会基于右侧对话理解意图，并在需要改画布时发起写入申请。`
        : "我现在处于 Mock fallback 模式，无法调用真实模型。请先检查模型连接。";
    }

    return "气候变化是指地球温度、降雨和天气模式的长期变化。\n\n温室气体会把更多热量留在大气中，而燃烧煤、石油和天然气等人类活动会增加这些气体。\n\n在日常生活中，它可能表现为更炎热的夏天、更强的暴雨、海平面上升，以及农业生产变化。\n\n我们可以通过节约能源、使用更清洁的交通方式和减少浪费来应对。";
  }

  if (isChatMode(payload.mode)) {
    return instruction
      ? `I am in mock fallback mode, so I cannot call the real model yet. You said: "${instruction}". Once the model connection is restored, I will infer intent from this chat and request Canvas writes only when needed.`
      : "I am in mock fallback mode, so I cannot call the real model yet. Please check the model connection.";
  }

  return "Climate change means long-term shifts in temperature, rainfall, and weather patterns across the planet.\n\nGreenhouse gases trap heat in the atmosphere, and human activities add more of these gases by burning coal, oil, and gas.\n\nThe effects can include hotter summers, stronger storms, rising sea levels, and changes to food production.\n\nPeople can respond by saving energy, using cleaner transport, reducing waste, and supporting climate-aware decisions.";
}

export function isChatMode(mode: GenerateRequest["mode"]) {
  return mode === "freeText" || mode === "chat";
}
