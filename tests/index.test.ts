import { SpanKind } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import {
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { describe, it, expect, beforeAll, beforeEach } from "vitest";
import {
  tracePipeline,
  traceStep,
  traceLLMCall,
  PipelineAttributes,
  GenAIAttributes,
} from "cursor-auto-otel";
import { SpanStatusCode } from "@opentelemetry/api";

let exporter: InMemorySpanExporter;
let provider: NodeTracerProvider;

beforeAll(() => {
  exporter = new InMemorySpanExporter();
  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: "test",
  });
  provider = new NodeTracerProvider({
    resource,
    spanProcessors: [new SimpleSpanProcessor(exporter)],
  });
  provider.register();
});

beforeEach(() => {
  exporter.reset();
});

async function getSpans() {
  await provider.forceFlush();
  return exporter.getFinishedSpans();
}

describe("tracePipeline", () => {
  it("creates a root span with pipeline.name and pipeline.success", async () => {
    await tracePipeline("my-pipeline", async () => "ok");
    const spans = await getSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].name).toBe("my-pipeline");
    expect(spans[0].attributes[PipelineAttributes.NAME]).toBe("my-pipeline");
    expect(spans[0].attributes[PipelineAttributes.SUCCESS]).toBe(true);
  });

  it("sets pipeline.success false and error status when fn throws", async () => {
    await expect(
      tracePipeline("fail-pipeline", async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const spans = await getSpans();
    expect(spans).toHaveLength(1);
    expect(spans[0].attributes[PipelineAttributes.SUCCESS]).toBe(false);
    expect(spans[0].status.code).toBe(SpanStatusCode.ERROR);
    expect(spans[0].events.length).toBeGreaterThanOrEqual(1);
  });
});

describe("traceStep", () => {
  it("creates a child span with pipeline.stage, pipeline.execution_type, pipeline.success", async () => {
    await tracePipeline("parent", async (pipeline) => {
      return traceStep(
        pipeline,
        "validate",
        { executionType: "programmatic" },
        async () => 42,
      );
    });
    const spans = await getSpans();
    expect(spans).toHaveLength(2);
    const stepSpan = spans.find((s) => s.name === "validate");
    expect(stepSpan).toBeDefined();
    expect(stepSpan!.attributes[PipelineAttributes.STAGE]).toBe("validate");
    expect(stepSpan!.attributes[PipelineAttributes.EXECUTION_TYPE]).toBe(
      "programmatic",
    );
    expect(stepSpan!.attributes[PipelineAttributes.SUCCESS]).toBe(true);
    expect(stepSpan!.attributes[PipelineAttributes.NAME]).toBe("parent");
  });

  it("records exception and sets success false when fn throws", async () => {
    await expect(
      tracePipeline("parent", async (pipeline) => {
        return traceStep(
          pipeline,
          "bad-step",
          { executionType: "heuristic" },
          async () => {
            throw new Error("step failed");
          },
        );
      }),
    ).rejects.toThrow("step failed");
    const spans = await getSpans();
    const stepSpan = spans.find((s) => s.name === "bad-step");
    expect(stepSpan).toBeDefined();
    expect(stepSpan!.attributes[PipelineAttributes.SUCCESS]).toBe(false);
    expect(stepSpan!.status.code).toBe(SpanStatusCode.ERROR);
    expect(stepSpan!.events.length).toBeGreaterThanOrEqual(1);
  });
});

describe("traceLLMCall", () => {
  it("creates a CLIENT span with gen_ai.* attributes and span name '{operation} {model}'", async () => {
    await tracePipeline("llm-pipeline", async (pipeline) => {
      return traceLLMCall(
        pipeline,
        "generate",
        { provider: "openai", model: "gpt-4o", operationName: "chat" },
        async (captureUsage) => {
          captureUsage(10, 20, "stop");
          return "hi";
        },
      );
    });
    const spans = await getSpans();
    const llmSpan = spans.find((s) => s.name === "chat gpt-4o");
    expect(llmSpan).toBeDefined();
    expect(llmSpan!.kind).toBe(SpanKind.CLIENT);
    expect(llmSpan!.attributes[GenAIAttributes.PROVIDER_NAME]).toBe("openai");
    expect(llmSpan!.attributes[GenAIAttributes.SYSTEM]).toBe("openai");
    expect(llmSpan!.attributes[GenAIAttributes.REQUEST_MODEL]).toBe("gpt-4o");
    expect(llmSpan!.attributes[GenAIAttributes.OPERATION_NAME]).toBe("chat");
    expect(llmSpan!.attributes[PipelineAttributes.STAGE]).toBe("generate");
    expect(llmSpan!.attributes[PipelineAttributes.EXECUTION_TYPE]).toBe("llm");
  });

  it("captureUsage sets gen_ai.usage.input_tokens, output_tokens, and response.finish_reasons", async () => {
    await tracePipeline("p", async (pipeline) => {
      return traceLLMCall(
        pipeline,
        "call",
        { provider: "anthropic", model: "claude-3" },
        async (captureUsage) => {
          captureUsage(100, 250, "end_turn");
          return "";
        },
      );
    });
    const spans = await getSpans();
    const llmSpan = spans.find((s) => s.name === "chat claude-3");
    expect(llmSpan).toBeDefined();
    expect(llmSpan!.attributes[GenAIAttributes.USAGE_INPUT_TOKENS]).toBe(100);
    expect(llmSpan!.attributes[GenAIAttributes.USAGE_OUTPUT_TOKENS]).toBe(250);
    expect(llmSpan!.attributes[GenAIAttributes.RESPONSE_FINISH_REASONS]).toEqual(
      ["end_turn"],
    );
  });

  it("sets error status and pipeline.success false when fn throws", async () => {
    await expect(
      tracePipeline("p", async (pipeline) => {
        return traceLLMCall(
          pipeline,
          "fail-call",
          { provider: "openai", model: "gpt-4" },
          async () => {
            throw new Error("API error");
          },
        );
      }),
    ).rejects.toThrow("API error");
    const spans = await getSpans();
    const llmSpan = spans.find((s) => s.name === "chat gpt-4");
    expect(llmSpan).toBeDefined();
    expect(llmSpan!.attributes[PipelineAttributes.SUCCESS]).toBe(false);
    expect(llmSpan!.status.code).toBe(SpanStatusCode.ERROR);
  });
});

describe("async context propagation", () => {
  it("child spans share the correct parent", async () => {
    await tracePipeline("root", async (pipeline) => {
      await traceStep(
        pipeline,
        "step-a",
        { executionType: "programmatic" },
        async () => undefined,
      );
      await traceStep(
        pipeline,
        "step-b",
        { executionType: "heuristic" },
        async () => undefined,
      );
      return "done";
    });
    const spans = await getSpans();
    expect(spans).toHaveLength(3);
    const root = spans.find((s) => s.name === "root");
    const stepA = spans.find((s) => s.name === "step-a");
    const stepB = spans.find((s) => s.name === "step-b");
    expect(root).toBeDefined();
    expect(stepA).toBeDefined();
    expect(stepB).toBeDefined();
    const rootCtx = root!.spanContext();
    expect(stepA!.parentSpanContext?.traceId).toBe(rootCtx.traceId);
    expect(stepA!.parentSpanContext?.spanId).toBe(rootCtx.spanId);
    expect(stepB!.parentSpanContext?.traceId).toBe(rootCtx.traceId);
    expect(stepB!.parentSpanContext?.spanId).toBe(rootCtx.spanId);
    expect(stepA!.parentSpanContext?.spanId).toBe(stepB!.parentSpanContext?.spanId);
  });
});
