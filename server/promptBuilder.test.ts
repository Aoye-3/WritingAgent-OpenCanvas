import test from "node:test";
import assert from "node:assert/strict";
import { buildAgentPrompt } from "./promptBuilder.js";
import { agentCards } from "./agentCards.js";

test("Brief sections are injected before the current user instruction and omit empty values", () => {
  const prompt = buildAgentPrompt({
    agentCard: agentCards[0],
    skills: [],
    locale: "en",
    projectBrief: {
      goal: "Launch the research report",
      audience: "",
      standingConstraints: "Use sourced claims"
    },
    taskBrief: {
      objective: "Create the first outline",
      deliverableType: "outline",
      deliverableDetails: ""
    },
    chatInstruction: "Start with the key argument"
  });

  assert.match(prompt, /# Project Brief\n- Project goal: Launch the research report\n- Standing constraints and expression principles: Use sourced claims/);
  assert.match(prompt, /# Current Task Brief\n- Task objective: Create the first outline\n- Expected deliverable: outline/);
  assert.doesNotMatch(prompt, /Target audience:/);
  assert.ok(prompt.indexOf("# Project Brief") < prompt.indexOf("# Current Task Brief"));
  assert.match(prompt, /When the Current Task Brief conflicts with the Project Brief, follow the Current Task Brief for this request\./);
  assert.ok(prompt.indexOf("# Current Task Brief") < prompt.indexOf("# Current User Instruction"));
});

test("Canvas delivery contract is injected only when supplied", () => {
  const prompt = buildAgentPrompt({
    agentCard: agentCards[0],
    skills: [],
    locale: "zh",
    chatInstruction: "帮我查最近新闻，然后总结到画板里",
    canvasDeliveryContract: {
      id: "facetwrite_canvas_delivery_v1",
      format: "facetwrite_canvas_delivery",
      diagramFormat: "facetwrite_diagram_delivery",
      preferredMode: "mind_map",
      locale: "zh"
    }
  });

  assert.match(prompt, /# Canvas Delivery Contract/);
  assert.match(prompt, /facetwrite_canvas_delivery/);
  assert.match(prompt, /assistant_reply/);
  assert.match(prompt, /outline_markdown/);
  assert.match(prompt, /body_markdown/);
  assert.match(prompt, /facetwrite_diagram_delivery/);
  assert.match(prompt, /kind "mindmap"/);
  assert.match(prompt, /shape/);

  const ordinary = buildAgentPrompt({
    agentCard: agentCards[0],
    skills: [],
    locale: "zh",
    chatInstruction: "总结一下最近新闻"
  });
  assert.doesNotMatch(ordinary, /# Canvas Delivery Contract/);
});
