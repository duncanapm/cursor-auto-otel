# cursor-auto-otel — Cursor Rule (AI Enforcement Specification)

This document defines the deterministic enforcement behaviour for OpenTelemetry instrumentation in generated code. It is AI-facing and describes what generated code MUST and MUST NOT do. Language is normative only; no philosophy or marketing.

**Project language detection:** From the repository, infer language as follows: presence of `package.json` → TypeScript/Node.js; presence of `pyproject.toml` or `requirements.txt` → Python. Apply the corresponding language rules.

---

## 1. Tracer initialisation requirements

1.1. The tracer provider MUST be initialised exactly once at application startup, before any span is created.

1.2. The OTLP exporter MUST use the endpoint from the environment. The generator MUST NOT hardcode `OTEL_EXPORTER_OTLP_ENDPOINT` or any OTLP URL in source code.

1.3. The service name MUST be set via resource attributes (e.g. `ATTR_SERVICE_NAME` / `SERVICE_NAME`), using configuration or environment (e.g. `OTEL_SERVICE_NAME`), not a single literal used only in one place.

1.4. The tracer provider MUST NOT be registered more than once, and MUST NOT be registered after the first span is created.

1.5. **AWS Lambda with ADOT layer:** When the application runs in AWS Lambda with the ADOT Lambda Layer (detect via `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument`), the generator MUST NOT register a tracer provider; the layer provides it. The generator MUST only create spans (handlers, pipelines, LLM) using `trace.getTracer()` (TypeScript) or `trace.get_tracer()` (Python). All other requirements (span wrapping, error recording, attributes) still apply.

---

## 2. Span wrapping requirements

2.1. **Handler (entry point):** Every request or job entry point (HTTP handler, queue consumer, cron job, event handler, or equivalent) MUST be wrapped in a single root span. The generator MUST NOT leave the handler’s main logic outside a span.

2.2. **Span end guarantee:** The root span MUST be ended in all code paths. In TypeScript (callback-based `startActiveSpan`), the callback MUST call `span.end()` in a `finally` block. In Python, using `with tracer.start_as_current_span(...)` satisfies this. The generator MUST NOT start a span without a guaranteed path to `end()` or context-manager exit.

2.3. **Pipeline:** Any multi-step processing flow (pipeline) MUST have a root span and MUST create a child span for each distinct stage. Each stage span MUST have kind `INTERNAL` and MUST set the attributes in section 4.

2.4. **LLM/GenAI call:** Every call to an LLM or GenAI API (OpenAI, Anthropic, Bedrock, etc.) MUST be wrapped in a span. The span MUST have kind `CLIENT` and MUST satisfy the requirements in section 5.

2.5. **Span naming:** Root handler span names MUST be short, stable identifiers (e.g. `http GET /users`, `job processOrder`, `event order.created`). The generator MUST NOT use variable or user-defined data (e.g. user id, request id) as the primary span name.

---

## 3. Error recording requirements

3.1. On catch of an exception, the generator MUST call `span.recordException(error)` (TypeScript) or `span.record_exception(exc)` (Python) on the active span.

3.2. On catch, the generator MUST set span status to ERROR (`SpanStatusCode.ERROR` / `StatusCode.ERROR`) with a message.

3.3. After recording the exception and setting status, the generator MUST rethrow (TypeScript) or re-raise (Python) so that callers see the failure. The generator MUST NOT swallow exceptions solely to avoid breaking the trace.

3.4. For pipeline spans, on failure the generator MUST set `pipeline.success` to false on the failing stage and on the pipeline root when a stage fails.

---

## 4. Pipeline and stage span attributes

Each pipeline root and each stage span MUST set the following attributes. All are REQUIRED.

| Attribute | Type | Requirement |
|-----------|------|-------------|
| `pipeline.name` | string | REQUIRED |
| `pipeline.stage` | string | REQUIRED (stage spans only; root may use same value as pipeline.name or a dedicated root name) |
| `pipeline.execution_type` | string | REQUIRED — exactly one of `"llm"`, `"heuristic"`, `"programmatic"` |
| `pipeline.success` | boolean | REQUIRED — set on both success and failure paths |

Execution type semantics: `"llm"` = stage invokes an LLM/GenAI API; `"heuristic"` = rules, scoring, regex, or configurable logic; `"programmatic"` = validation, transformation, DB, or other non-LLM code.

Pipeline and stage spans MUST use `SpanKind.INTERNAL`.

---

## 5. LLM instrumentation requirements

5.1. Every LLM or GenAI API call MUST be wrapped in a span with kind `CLIENT`.

5.2. The span name MUST be `{gen_ai.operation.name} {gen_ai.request.model}` (e.g. `chat gpt-4o`, `chat claude-sonnet-4-20250514`).

5.3. Required attributes:

| Attribute | Requirement |
|-----------|-------------|
| `gen_ai.operation.name` | REQUIRED (e.g. `chat`, `text_completion`, `embeddings`) |
| `gen_ai.provider.name` | REQUIRED (e.g. `openai`, `anthropic`, `aws.bedrock`) |
| `gen_ai.request.model` | REQUIRED when the model is known; omit only if the API does not expose it |

5.4. When the API returns usage information, the generator MUST set `gen_ai.usage.input_tokens` and `gen_ai.usage.output_tokens` on the span.

5.5. On failure of the LLM call, the generator MUST record the exception on the span, set span status to ERROR, and end the span (e.g. in a `finally` block).

---

## 6. Async context propagation requirements

6.1. When a child span is started after an `await` (or after any async boundary), the current context MUST be passed so the child is attached to the correct parent.

6.2. The generator MUST NOT call `startActiveSpan` (or equivalent) with only the default context when a parent span exists in the current scope.

6.3. TypeScript: Use `trace.setSpan(context.active(), parentSpan)` to obtain a context and pass it as the third argument to `tracer.startActiveSpan(name, options, context, callback)` for child spans created after an await.

6.4. Python: Use `trace.set_span_in_context(span)` to obtain a context and pass it as `context=...` to `tracer.start_as_current_span(..., context=ctx)` when creating child spans across async boundaries.

---

## 7. Canonical span pattern (handler)

Generated handlers MUST follow this structure. Replace the span name with a stable identifier (e.g. `http GET /users`, `job processOrder`).

**TypeScript:**

```typescript
import { trace, context, SpanKind, SpanStatusCode } from "@opentelemetry/api";

const tracer = trace.getTracer("my-service");

async function myHandler(req: Request): Promise<Response> {
  return tracer.startActiveSpan("http GET /users", { kind: SpanKind.SERVER }, async (span) => {
    try {
      const result = await doWork(req);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (e) {
      span.recordException(e as Error);
      span.setStatus({ code: SpanStatusCode.ERROR, message: (e as Error).message });
      throw e;
    } finally {
      span.end();
    }
  });
}
```

**Python:**

```python
from opentelemetry import trace
from opentelemetry.trace import SpanKind, StatusCode

tracer = trace.get_tracer("my-service")

def my_handler(request):
    with tracer.start_as_current_span("http GET /users", kind=SpanKind.SERVER) as span:
        try:
            result = do_work(request)
            span.set_status(StatusCode.OK)
            return result
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            raise
```

---

## 8. Forbidden anti-patterns

The generator MUST NOT produce code that:

- Hardcodes the OTLP endpoint or any OTLP URL in source code.
- Runs handler logic (HTTP, job, event) without a root span.
- Starts a span in TypeScript and omits `span.end()` in a `finally` block (or equivalent guaranteed cleanup).
- Catches an error and does not call `recordException` / `record_exception` and set span status to ERROR.
- Catches an error and swallows it (fails to rethrow/re-raise) to avoid recording it on the span.
- Starts a child span after an await without passing the current context.
- Invokes an LLM/GenAI API without wrapping the call in a span with the required GenAI attributes and correct span name.
- Uses high-cardinality values (e.g. request id, user id) as the primary span name.
- Registers the tracer provider more than once or after the first span is created.

---

## 9. Generation checklist (validation gate)

Before completing code generation that adds or modifies request handlers, pipelines, or LLM calls, the generator MUST verify:

- [ ] Tracer is initialised once at application startup; OTLP endpoint is from environment only.
- [ ] Every added or modified handler (HTTP, job, event) is wrapped in a root span; span name follows the naming convention.
- [ ] Every handler span is ended in a `finally` block (TypeScript) or `with` (Python); no path skips `span.end()`.
- [ ] On error, every affected span has `recordException` / `record_exception` and status set to ERROR; errors are rethrown/re-raised.
- [ ] Pipeline stages have a root span and one span per stage with `pipeline.name`, `pipeline.stage`, `pipeline.execution_type`, and `pipeline.success` set.
- [ ] Every LLM/GenAI call is wrapped in a span with kind CLIENT and required attributes (`gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model` where available); token usage set when returned.
- [ ] Child spans created after an `await` or across async boundaries use the current context so the trace tree is correct.
- [ ] No forbidden anti-patterns are present (no hardcoded OTLP, no unended spans, no swallowed errors, no LLM call without span, no duplicate tracer registration).

If any item is not satisfied, the generator MUST update the code to satisfy it before considering the task complete.
