import { setupTracing, tracePipeline, traceStep, traceLLMCall } from "cursor-auto-otel";

await setupTracing("simple-pipeline-example");

interface ClassifyResult {
  intent: string;
  confidence: number;
}

async function mockLLMCall(prompt: string): Promise<{ text: string; inputTokens: number; outputTokens: number }> {
  await new Promise((r) => setTimeout(r, 80 + Math.random() * 120));
  return {
    text: `Mock response to: ${prompt.slice(0, 50)}`,
    inputTokens: 42 + Math.floor(Math.random() * 20),
    outputTokens: 128 + Math.floor(Math.random() * 50),
  };
}

const userMessage = "I need help resetting my password for my account";

const response = await tracePipeline("customer-support-pipeline", async (pipeline) => {
  const classification = await traceLLMCall<ClassifyResult>(
    pipeline,
    "classify-intent",
    { provider: "openai", model: "gpt-4o-mini", operationName: "chat" },
    async (captureUsage) => {
      const result = await mockLLMCall(`Classify the intent of: "${userMessage}"`);
      captureUsage(result.inputTokens, result.outputTokens, "stop");
      return { intent: "password_reset", confidence: 0.95 };
    },
  );

  const isAllowed = await traceStep(
    pipeline,
    "policy-check",
    { executionType: "heuristic" },
    async () => {
      await new Promise((r) => setTimeout(r, 5));
      const blockedIntents = ["account_deletion", "refund_over_limit"];
      return !blockedIntents.includes(classification.intent);
    },
  );

  if (!isAllowed) {
    return "This request requires human review.";
  }

  const reply = await traceLLMCall<string>(
    pipeline,
    "generate-response",
    { provider: "openai", model: "gpt-4o", operationName: "chat", maxTokens: 512 },
    async (captureUsage) => {
      const result = await mockLLMCall(
        `You are a support agent. The user intent is "${classification.intent}" (confidence: ${classification.confidence}). Respond to: "${userMessage}"`,
      );
      captureUsage(result.inputTokens, result.outputTokens, "stop");
      return result.text;
    },
  );

  return reply;
});

console.log("Pipeline result:", response);
console.log("Traces sent to http://localhost:4318 — view at http://localhost:16686");

// flush to ensure spans are exported before exit
await new Promise((r) => setTimeout(r, 2000));
