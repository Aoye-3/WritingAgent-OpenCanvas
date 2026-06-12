import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import type { AddressInfo } from "node:net";
import { registerPlanRoutes } from "./planRoutes.js";

test("plan routes list, approve, cancel, answer, and retry", async () => {
  const calls: string[] = [];
  const plan = { id: "plan_1", status: "awaiting_approval", steps: [{ id: "step_1", status: "failed" }] };
  const storage = {
    listPlanRuns: () => [plan], getPlanRun: () => plan,
    approvePlanRun: () => (calls.push("approve"), { ...plan, status: "running" }),
    cancelPlanRun: () => (calls.push("cancel"), { ...plan, status: "cancelled" }),
    retryPlanStep: () => (calls.push("retry"), { ...plan.steps[0], status: "pending" }),
    resumePlanWithAnswer: (_threadId: string, _planId: string, message: string) => (calls.push(message), { ...plan, status: "running", statusMessage: message })
  };
  const app = express(); app.use(express.json()); registerPlanRoutes(app, storage as never);

  assert.equal((await request(app, "/api/threads/thread_1/plans")).status, 200);
  assert.equal((await request(app, "/api/threads/thread_1/plans/plan_1/approve", "POST")).status, 200);
  assert.equal((await request(app, "/api/threads/thread_1/plans/plan_1/steps/step_1/retry", "POST")).status, 200);
  assert.equal((await request(app, "/api/threads/thread_1/plans/plan_1/answer", "POST", { answer: "UK market" })).status, 200);
  assert.equal((await request(app, "/api/threads/thread_1/plans/plan_1/cancel", "POST")).status, 200);
  assert.deepEqual(calls, ["approve", "retry", "UK market", "cancel"]);
});

async function request(app: express.Express, path: string, method = "GET", body?: unknown) {
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  try {
    const address = server.address() as AddressInfo;
    const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { method, headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
    return { status: response.status, body: await response.json() };
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); }
}
