# cursor-auto-otel — Human Instructions

## What is cursor-auto-otel?

**cursor-auto-otel** is a Cursor rule and optional helper library that causes the AI assistant to generate OpenTelemetry-instrumented code when you ask it to build or modify services, APIs, pipelines, or LLM integrations. It does not instrument Cursor itself; it instructs Cursor to emit code that includes tracing from the start.

The project provides:

- A **Cursor rule** (`.cursor/rules/auto-otel.mdc`) that the AI follows when writing code, so new handlers, pipelines, and LLM calls are wrapped in spans with the correct attributes and error handling.
- An optional **helper library** (npm: `cursor-auto-otel`, PyPI: `cursor-auto-otel`) with utilities such as `tracePipeline`, `traceStep`, and `traceLLMCall` (TypeScript) or `trace_pipeline`, `trace_step`, and `trace_llm_call` (Python) to reduce boilerplate. The rule works with or without the helpers.

Supported runtimes: **TypeScript/Node.js** and **Python**.

---

## Why it exists

Observability is most effective when it is built in at code creation time, not added later. cursor-auto-otel encodes OpenTelemetry patterns into the instructions Cursor uses when generating code, so that:

- Every request or job entry point has a root span.
- Multi-step pipelines have a root span and one span per stage, with consistent attributes.
- Every LLM/GenAI API call is wrapped in a span that follows OTel GenAI semantic conventions.
- Errors are recorded on spans and status is set to ERROR; spans are always ended (e.g. in a `finally` block).

This gives you consistent traces, correct parent-child relationships, and reliable error visibility without having to remember to add instrumentation manually.

---

## What it guarantees

When the rule is applied and Cursor generates code according to it:

- **Tracer initialisation**: The rule requires a single tracer provider initialisation at application startup, with the OTLP endpoint taken from the environment (no hardcoded URLs).
- **Handler coverage**: Every HTTP handler, job, or event entry point is wrapped in a root span with a stable, low-cardinality name.
- **Pipeline structure**: Multi-step pipelines get a root span and one span per stage, with required attributes (`pipeline.name`, `pipeline.stage`, `pipeline.execution_type`, `pipeline.success`).
- **LLM call instrumentation**: Every call to an LLM or GenAI API is wrapped in a span with kind CLIENT and required GenAI attributes (e.g. `gen_ai.operation.name`, `gen_ai.provider.name`, `gen_ai.request.model`), and token usage is set when the API returns it.
- **Error handling**: Exceptions are recorded on the span, span status is set to ERROR, and the error is rethrown so the trace reflects failures.
- **Span lifecycle**: Spans are ended in a `finally` block (TypeScript) or equivalent (e.g. `with` in Python), so no span is left open on success or failure.
- **Context propagation**: When child spans are created after an `await` or across async boundaries, the current context is passed so the trace tree remains correct.

These guarantees depend on Cursor actually applying the rule when generating code. The rule is deterministic and written so the model can follow it consistently.

---

## What it does NOT do

- **It does not instrument Cursor IDE or Cursor’s own processes.** It only affects the code that Cursor generates for your project.
- **It does not run or enforce instrumentation at runtime.** It instructs the AI to emit code that, when run, produces traces. Runtime behaviour depends on your app and your OTLP backend.
- **It does not guarantee that every line of existing code is instrumented.** It applies to code that Cursor adds or modifies while the rule is active. Legacy code is not automatically changed.
- **It does not replace a backend.** You must configure an OTLP endpoint (e.g. Jaeger, Grafana Cloud, Datadog, Honeycomb) and ensure your process can reach it.
- **It does not define retry, sampling, or export policies.** Those are configured in your tracer/collector setup, not by this rule.

---

## Installation

### 1. Add the Cursor rule

Copy the rule into your repo so Cursor applies it when writing code:

```bash
mkdir -p .cursor/rules
curl -o .cursor/rules/auto-otel.mdc https://raw.githubusercontent.com/duncanapm/cursor-auto-otel/main/.cursor/rules/auto-otel.mdc
```

Or clone the repo and copy `.cursor/rules/auto-otel.mdc` into your project’s `.cursor/rules/` directory.

### 2. Install the helper library (optional)

You can use raw OpenTelemetry APIs; the rule describes both. If you use the helpers:

**TypeScript / Node.js**

```bash
npm install cursor-auto-otel @opentelemetry/api
```

For full SDK and auto-instrumentation, you will also need the packages listed in the rule (e.g. `@opentelemetry/sdk-trace-node`, `@opentelemetry/exporter-trace-otlp-http`, and optionally `@opentelemetry/auto-instrumentations-node`).

**Python**

```bash
pip install cursor-auto-otel
```

For SDK and OTLP export, install the optional dependency:

```bash
pip install "cursor-auto-otel[sdk]"
```

### 3. Configure the OTLP endpoint

Set the environment variable before starting your application:

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

Use the URL of your OTLP receiver (Jaeger, Grafana Cloud, Datadog Agent, etc.). Do not hardcode this value in source code.

---

## AWS Lambda

When your instrumented code runs on **AWS Lambda**, use the **AWS Distro for OpenTelemetry (ADOT) Lambda Layer** so the layer provides the tracer and exporter. Your deployment package should **not** bundle OpenTelemetry SDK/exporter packages when using the layer.

### Setup

1. **Add the ADOT Lambda Layer** to your function (region- and runtime-specific ARN). See [ADOT Lambda documentation](https://aws-otel.github.io/docs/getting-started/lambda) for current layer ARNs (e.g. Python: `AWSOpenTelemetryDistroPython` or the legacy `aws-otel-python-amd64-ver-*`).
2. **Set** `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument` so the layer’s wrapper runs and OpenTelemetry is on the path.
3. **Enable Lambda active tracing** (X-Ray) so traces are exported and visible in CloudWatch.

### Tracer initialisation with the layer

When the ADOT layer is active (`AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument`), the **layer** registers the tracer provider. Your code must **not** call `trace.set_tracer_provider()` or otherwise register a provider. Your code should only **create spans** (e.g. root span per request, pipeline stages, LLM spans) using `trace.getTracer()` / `trace.get_tracer()`. If you initialise a provider as well, you can get duplicate or wrong behaviour.

### Where traces go

- **Optimized ADOT layers** (e.g. `AWSOpenTelemetryDistroPython`): export only to **AWS X-Ray**. Traces appear in CloudWatch / X-Ray. No custom OTLP endpoint.
- **Legacy ADOT layers** (with embedded collector, e.g. `aws-otel-python-amd64-ver-1-32-0`): support a **custom collector config** via `OPENTELEMETRY_COLLECTOR_CONFIG_URI`. With a custom config you can export to both X-Ray and a custom OTLP endpoint (e.g. Jaeger). See [ADOT Lambda custom configuration](https://aws-otel.github.io/docs/getting-started/lambda/lambda-custom-configuration).

### Lambda environment size limit

Lambda has a **4 KB limit** on environment variables. Adding `OPENTELEMETRY_COLLECTOR_CONFIG_URI` (and using the legacy layer) can push you over if you already have many or large env vars. If that happens, move one or more secrets to AWS Systems Manager Parameter Store (SSM) and reference them in your config instead of inline env.

---

## Verification (how to confirm spans are generated)

1. **Start an OTLP backend** that you can query (e.g. Jaeger, Grafana Cloud). For local Jaeger with the project’s Docker setup:

   ```bash
   docker compose up -d
   ```

2. **Set the endpoint and run your app:**

   ```bash
   export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   # Then start your app (e.g. npm start, python main.py)
   ```

3. **Trigger the code path** that you instrumented (e.g. send an HTTP request to a handler, run a job, or invoke a pipeline that calls an LLM).

4. **Inspect traces** in the backend UI (e.g. Jaeger at `http://localhost:16686`). Find your service name and confirm:
   - A root span exists for the request or job (e.g. `http GET /users`, `job processOrder`).
   - Child spans appear for pipeline stages or LLM calls where applicable.
   - Spans show the expected attributes (e.g. `pipeline.stage`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`).
   - On failure, the failing span has status ERROR and the exception is visible on the span.

5. **Run the example apps** in this repo (e.g. `examples/simple-pipeline` for TypeScript, `examples/simple-pipeline-python` for Python) and confirm traces appear in Jaeger for the `simple-pipeline-example` service.

If no traces appear, see Troubleshooting below.

---

## Troubleshooting

### No traces in the backend

- **OTLP endpoint**: Ensure `OTEL_EXPORTER_OTLP_ENDPOINT` is set and that the process can reach it (no firewall or TLS issues). For HTTP, the default is often `http://localhost:4318`.
- **Tracer initialisation**: The tracer provider must be registered once at application startup, before any spans are created. If initialisation runs in a branch that is never executed (e.g. a different entry point), no traces will be exported.
- **Service name**: Set `OTEL_SERVICE_NAME` or equivalent so your service appears under a recognisable name in the backend.
- **Backend compatibility**: The rule uses standard OTLP; ensure your backend accepts OTLP over HTTP (or gRPC if you configure that separately).

### Spans missing for some requests or jobs

- **Rule application**: The rule applies to code that Cursor generates. Handlers or pipelines written before the rule was added, or written without the rule (e.g. copy-pasted from elsewhere), may not be instrumented. Add a root span around those entry points or ask Cursor to refactor them with the rule in mind.
- **Async context**: If child spans are created after an `await` without passing the current context, they may attach to the wrong parent or appear as roots. Ensure context is passed when starting child spans across async boundaries.

### Duplicate or wrong parent-child structure

- **Context propagation**: After `await`, the active context must be passed explicitly when starting a child span (TypeScript: third argument to `startActiveSpan`; Python: `context=` to `start_as_current_span`). Otherwise the child may not be linked to the intended parent.
- **Single tracer provider**: Register the tracer provider only once at startup. Multiple registrations can lead to inconsistent or duplicate behaviour.

### Errors not visible on spans

- **Catch block**: In every `catch` (or `except`), the code must call `span.recordException` / `span.record_exception` and set span status to ERROR, then rethrow/re-raise. If the exception is swallowed without recording, the trace will not show the failure.
- **Rule compliance**: If the generated code does not follow the rule (e.g. missing `finally { span.end(); }` or missing error recording), fix the code or re-prompt with the rule in scope so Cursor regenerates compliant code.

### High cardinality or performance

- **Span names**: Use stable, low-cardinality names (e.g. `http GET /users`, not `http GET /users/12345`). Put identifiers (user id, request id) in attributes, not in the span name.
- **Sampling**: If the backend or SDK supports sampling, configure it to reduce volume while keeping error and key path coverage.

For the exact requirements the AI is instructed to follow (tracer init, span wrapping, error recording, LLM instrumentation, forbidden patterns, checklist), see **CURSOR_RULE.md**. For a short overview and links, see **README.md**.
