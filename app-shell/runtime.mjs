const requiredRuntimeServices = new Set([
  "facetwrite-agent-runtime-nginx",
  "facetwrite-agent-runtime-frontend",
  "facetwrite-agent-runtime-gateway",
]);

export function classifyRuntimeState(runningServices) {
  const running = new Set(runningServices.filter((service) => requiredRuntimeServices.has(service)));
  if (running.size === 0) return { action: "start", owned: true };
  if (running.size === requiredRuntimeServices.size) return { action: "reuse", owned: false };
  throw new Error("Agent Runtime is partially running. Stop or repair it before launching OpenCanvas.");
}

export function createLifecycle(deps) {
  let frontend;
  let api;
  let runtimeOwned = false;
  let stopping;

  const stop = () => {
    if (stopping) return stopping;
    stopping = (async () => {
      const errors = [];
      for (const cleanup of [
        () => frontend?.stop(),
        () => api?.stop(),
        () => runtimeOwned ? deps.stopRuntime() : undefined,
      ]) {
        try {
          await cleanup();
        } catch (error) {
          errors.push(error);
        }
      }
      if (errors.length === 1) throw errors[0];
      if (errors.length > 1) throw new AggregateError(errors, "Multiple app shell cleanup steps failed.");
    })();
    return stopping;
  };

  return {
    async start() {
      try {
        deps.onStage("docker");
        const runtimeState = classifyRuntimeState(await deps.inspectRuntime());
        deps.onStage("runtime");
        if (runtimeState.action === "start") {
          await deps.startRuntime();
          runtimeOwned = true;
        }
        await deps.waitForRuntime();

        deps.onStage("api");
        api = await deps.startApi();
        await deps.waitForApi();

        deps.onStage("frontend");
        frontend = await deps.startFrontend();
        await deps.waitForFrontend();
        deps.onStage("ready");
      } catch (error) {
        await stop().catch(() => undefined);
        throw error;
      }
    },
    stop,
  };
}
