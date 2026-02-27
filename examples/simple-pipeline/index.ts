import {
  setupTracing,
  tracePipeline,
  traceStep,
  traceLLMCall,
} from "cursor-auto-otel";

const tracerControl = await setupTracing("simple-pipeline-example", {
  autoInstrumentations: true,
});

const express = (await import("express")).default;
const app = express();
app.use(express.json());

app.post("/api/support", async (req, res) => {
  const body = req.body as { message?: string };
  const userMessage = typeof body?.message === "string" ? body.message : "I need help";

  try {
    const response = await tracePipeline(
      "customer-support-pipeline",
      async (pipeline) => {
        const customer = await traceStep(
          pipeline,
          "lookup-customer",
          { executionType: "programmatic" },
          async () => {
            await new Promise((r) => setTimeout(r, 20));
            return { id: "cust-1", tier: "standard" };
          },
        );

        const classification = await traceLLMCall<{ intent: string; confidence: number }>(
          pipeline,
          "classify-intent",
          { provider: "openai", model: "gpt-4o-mini", operationName: "chat" },
          async (captureUsage) => {
            await new Promise((r) => setTimeout(r, 100));
            captureUsage(50, 12, "stop");
            return { intent: "password_reset", confidence: 0.95 };
          },
        );

        const reply = await traceLLMCall<string>(
          pipeline,
          "generate-response",
          {
            provider: "openai",
            model: "gpt-4o",
            operationName: "chat",
            maxTokens: 512,
          },
          async (captureUsage) => {
            await new Promise((r) => setTimeout(r, 150));
            captureUsage(120, 80, "stop");
            return `Support response for "${userMessage.slice(0, 30)}..." (customer ${customer.id})`;
          },
        );

        return { reply, intent: classification.intent };
      },
    );

    res.json(response);
  } catch (err) {
    res.status(500).json({
      error: err instanceof Error ? err.message : "Internal server error",
    });
  }
});

const port = Number(process.env.PORT) || 3000;
const server = app.listen(port, () => {
  console.log(`Server listening on http://localhost:${port}`);
  console.log(`POST /api/support with body { "message": "..." }`);
  console.log(`Traces → http://localhost:4318 — Jaeger UI → http://localhost:16686`);
});

const shutdown = () => {
  server.close(() => {
    tracerControl.shutdown().catch(() => {}).finally(() => process.exit(0));
  });
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
