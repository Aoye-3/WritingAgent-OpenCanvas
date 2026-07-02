export type ModelCapabilityInput = {
  providerId?: string;
  modelId?: string;
  modelName?: string;
};

export function supportsModelThinking(input?: ModelCapabilityInput) {
  if (!input) return false;

  const name = `${input.modelId ?? ""} ${input.modelName ?? ""}`.toLowerCase();
  if (!name.includes("deepseek")) return false;
  return /(?:^|[-_/ ])(?:r1|reasoner)(?:$|[-_/ ])|deepseek[-_/ ]?r1|deepseek[-_/ ]?v(?:3\.2|4)(?:$|[-_/ ])/i.test(name);
}
