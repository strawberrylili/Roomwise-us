// Central knobs. Model IDs are env-overridable so undocumented models can be swapped without code changes.
export const config = {
  models: {
    orchestrator: process.env.ROOMWISE_MODEL_ORCHESTRATOR ?? "gpt-5.5",
    vision: process.env.ROOMWISE_MODEL_VISION ?? "gpt-5.5",
    fast: process.env.ROOMWISE_MODEL_FAST ?? "gpt-5.4-mini",
    render: process.env.ROOMWISE_MODEL_RENDER ?? "gpt-image-2.5-sunburst",
    renderFallback: process.env.ROOMWISE_MODEL_RENDER_FALLBACK ?? "gpt-image-2",
  },
  agent: {
    maxIterations: Number(process.env.ROOMWISE_MAX_ITERATIONS ?? 24),
    maxToolRetries: 2,
    maxConsecutiveToolFailures: 3,
    // Renders per run before the user must approve more (cost control).
    freeRendersPerRun: 3,
    critiquePassScore: 7,
  },
  dataDir: process.env.ROOMWISE_DATA_DIR ?? ".data-us",
  currency: "USD" as const,
};
