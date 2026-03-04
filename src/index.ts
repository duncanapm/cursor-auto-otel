import {
  trace,
  context,
  SpanKind,
  SpanStatusCode,
  type Span,
  type Tracer,
} from "@opentelemetry/api";
import {
  GenAIAttributes,
  PipelineAttributes,
  type ExecutionType,
  type GenAIProviderName,
} from "./attributes.js";

export { GenAIAttributes, PipelineAttributes } from "./attributes.js";
export type { ExecutionType, GenAIProviderName } from "./attributes.js";

const TRACER_NAME = "cursor-auto-otel";

function getTracer(): Tracer {
  return trace.getTracer(TRACER_NAME);
}

export interface PipelineContext {
  readonly span: Span;
  readonly name: string;
}

export async function tracePipeline<T>(
  name: string,
  fn: (pipeline: PipelineContext) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  return tracer.startActiveSpan(name, { kind: SpanKind.INTERNAL }, async (span) => {
    span.setAttribute(PipelineAttributes.NAME, name);
    const pipeline: PipelineContext = { span, name };
    try {
      const result = await fn(pipeline);
      span.setAttribute(PipelineAttributes.SUCCESS, true);
      return result;
    } catch (error) {
      span.setAttribute(PipelineAttributes.SUCCESS, false);
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}

export interface TraceStepOptions {
  executionType: ExecutionType;
}

export async function traceStep<T>(
  pipeline: PipelineContext,
  stageName: string,
  options: TraceStepOptions,
  fn: () => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  const ctx = trace.setSpan(context.active(), pipeline.span);

  return tracer.startActiveSpan(
    stageName,
    { kind: SpanKind.INTERNAL },
    ctx,
    async (span) => {
      span.setAttribute(PipelineAttributes.STAGE, stageName);
      span.setAttribute(PipelineAttributes.EXECUTION_TYPE, options.executionType);
      span.setAttribute(PipelineAttributes.NAME, pipeline.name);
      try {
        const result = await fn();
        span.setAttribute(PipelineAttributes.SUCCESS, true);
        return result;
      } catch (error) {
        span.setAttribute(PipelineAttributes.SUCCESS, false);
        span.recordException(error as Error);
        span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
        throw error;
      } finally {
        span.end();
      }
    },
  );
}

export interface TraceLLMCallOptions {
  provider: GenAIProviderName;
  model: string;
  operationName?: string;
  maxTokens?: number;
}

export type CaptureUsage = (
  inputTokens: number,
  outputTokens: number,
  finishReason?: string,
) => void;

export async function traceLLMCall<T>(
  pipeline: PipelineContext,
  stageName: string,
  options: TraceLLMCallOptions,
  fn: (captureUsage: CaptureUsage) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  const ctx = trace.setSpan(context.active(), pipeline.span);
  const operationName = options.operationName ?? "chat";
  const spanName = `${operationName} ${options.model}`;

  return tracer.startActiveSpan(spanName, { kind: SpanKind.CLIENT }, ctx, async (span) => {
    span.setAttribute(PipelineAttributes.STAGE, stageName);
    span.setAttribute(PipelineAttributes.EXECUTION_TYPE, "llm");
    span.setAttribute(PipelineAttributes.NAME, pipeline.name);
    span.setAttribute(GenAIAttributes.PROVIDER_NAME, options.provider);
    span.setAttribute(GenAIAttributes.SYSTEM, options.provider);
    span.setAttribute(GenAIAttributes.REQUEST_MODEL, options.model);
    span.setAttribute(GenAIAttributes.OPERATION_NAME, operationName);
    if (options.maxTokens !== undefined) {
      span.setAttribute(GenAIAttributes.REQUEST_MAX_TOKENS, options.maxTokens);
    }

    const captureUsage: CaptureUsage = (inputTokens, outputTokens, finishReason?) => {
      span.setAttribute(GenAIAttributes.USAGE_INPUT_TOKENS, inputTokens);
      span.setAttribute(GenAIAttributes.USAGE_OUTPUT_TOKENS, outputTokens);
      if (finishReason) {
        span.setAttribute(GenAIAttributes.RESPONSE_FINISH_REASONS, [finishReason]);
      }
    };

    try {
      const result = await fn(captureUsage);
      span.setAttribute(PipelineAttributes.SUCCESS, true);
      return result;
    } catch (error) {
      span.setAttribute(PipelineAttributes.SUCCESS, false);
      span.recordException(error as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (error as Error).message });
      throw error;
    } finally {
      span.end();
    }
  });
}

export interface SetupTracingOptions {
  /**
   * When true (default), register Node auto-instrumentations (HTTP, gRPC, etc.).
   * Requires @opentelemetry/auto-instrumentations-node and @opentelemetry/instrumentation.
   */
  autoInstrumentations?: boolean;
}

/**
 * Returned by setupTracing. Use shutdown() before process exit to flush spans.
 * Sampling: the OTel SDK reads OTEL_TRACES_SAMPLER (default parentbased_always_on)
 * and OTEL_TRACES_SAMPLER_ARG (e.g. 0.1 for TraceIdRatio). For production, set
 * OTEL_TRACES_SAMPLER=parentbased_traceidratio and OTEL_TRACES_SAMPLER_ARG=0.1.
 */
export interface TracerProviderControl {
  shutdown(): Promise<void>;
}

let registeredControl: TracerProviderControl | null = null;

/**
 * Configures the global tracer provider with OTLP export. Idempotent (safe to call once).
 * Service name: pass as first argument or set OTEL_SERVICE_NAME. Sampling: set
 * OTEL_TRACES_SAMPLER and OTEL_TRACES_SAMPLER_ARG (see TracerProviderControl).
 */
export async function setupTracing(
  serviceName?: string,
  options?: SetupTracingOptions,
): Promise<TracerProviderControl> {
  const name =
    (serviceName?.trim() && serviceName.trim()) ||
    (typeof process !== "undefined" && process.env?.OTEL_SERVICE_NAME) ||
    "unknown-service";
  const autoInstrumentations = options?.autoInstrumentations !== false;

  if (registeredControl !== null) {
    if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
      console.warn(
        "[cursor-auto-otel] setupTracing already called; skipping duplicate registration.",
      );
    }
    return registeredControl;
  }

  const traceNodeMod = await import("@opentelemetry/sdk-trace-node");
  const traceBaseMod = await import("@opentelemetry/sdk-trace-base");
  const exporterMod = await import("@opentelemetry/exporter-trace-otlp-http");
  const resourcesMod = await import("@opentelemetry/resources");
  const semconvMod = await import("@opentelemetry/semantic-conventions");

  const resource = resourcesMod.resourceFromAttributes({
    [semconvMod.ATTR_SERVICE_NAME]: name,
  });
  const exporter = new exporterMod.OTLPTraceExporter();
  const provider = new traceNodeMod.NodeTracerProvider({
    resource,
    spanProcessors: [new traceBaseMod.BatchSpanProcessor(exporter)],
  });
  provider.register();

  const control: TracerProviderControl = {
    shutdown: () => provider.shutdown(),
  };
  registeredControl = control;

  if (
    typeof process !== "undefined" &&
    typeof process.on === "function"
  ) {
    const shutdown = () => {
      control
        .shutdown()
        .then(() => process.exit(0))
        .catch((err) => {
          console.warn("[cursor-auto-otel] shutdown error:", err);
          process.exit(1);
        });
    };
    process.on("SIGTERM", shutdown);
    process.on("SIGINT", shutdown);
  }

  if (autoInstrumentations) {
    try {
      const { getNodeAutoInstrumentations } = await import(
        "@opentelemetry/auto-instrumentations-node"
      );
      const { registerInstrumentations } = await import(
        "@opentelemetry/instrumentation"
      );
      registerInstrumentations({
        instrumentations: [getNodeAutoInstrumentations()],
      });
    } catch (err) {
      if (typeof process !== "undefined" && process.env?.NODE_ENV !== "test") {
        console.warn(
          "[cursor-auto-otel] auto-instrumentation skipped — install @opentelemetry/auto-instrumentations-node (and @opentelemetry/instrumentation) for automatic HTTP/DB tracing.",
          err instanceof Error ? err.message : err,
        );
      }
    }
  }

  return control;
}
