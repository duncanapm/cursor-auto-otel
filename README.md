# cursor-auto-otel

Add one file to your project. Set one env var. Every piece of code Cursor writes is traced.

**cursor-auto-otel** is a [Cursor rule](https://docs.cursor.com/context/rules-for-ai) that makes the AI coding assistant produce OpenTelemetry-instrumented code by default. Standard infrastructure traces, AI pipeline structure, and GenAI LLM call tracing — all using standard OTel, sending to any backend.

## Quick Start

1. **Copy the rule** into your project:

```bash
mkdir -p .cursor/rules
cp node_modules/cursor-auto-otel/.cursor/rules/auto-otel.mdc .cursor/rules/
```

2. **Install the helper** (optional — you can also use raw OTel APIs):

```bash
npm install cursor-auto-otel @opentelemetry/api
```

3. **Set the OTLP endpoint:**

```bash
export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
```

4. **Start coding.** Every piece of code Cursor writes will include OTel instrumentation.

## Try It Locally

```bash
# Start Jaeger
docker compose up -d

# Run the example pipeline
cd examples/simple-pipeline
npm install
npm start

# Open Jaeger UI
open http://localhost:16686
```

Search for the `simple-pipeline-example` service to see the traces.

## What Gets Traced

| Layer | What | Example Span Names | Key Attributes |
|---|---|---|---|
| Auto / Infrastructure | HTTP, gRPC, AWS SDK, DB clients | `GET /api/users`, `DynamoDB.GetItem` | Standard OTel HTTP/DB attributes |
| Pipeline Structure | Multi-step processing pipelines | `customer-support-pipeline`, `classify-intent` | `pipeline.stage`, `pipeline.execution_type`, `pipeline.success` |
| GenAI LLM Calls | OpenAI, Anthropic, Bedrock, etc. | `chat gpt-4o`, `chat claude-sonnet-4-20250514` | `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` |

## Helper Library API

The `cursor-auto-otel` npm package exports thin wrappers around the OTel API:

- **`setupTracing(serviceName)`** — configure a tracer provider with OTLP exporter
- **`tracePipeline(name, fn)`** — create a root span for a pipeline execution
- **`traceStep(pipeline, stageName, { executionType }, fn)`** — create a child span for a pipeline stage
- **`traceLLMCall(pipeline, stageName, { provider, model }, fn)`** — create a child span following GenAI semantic conventions

The helper is optional. The Cursor rule teaches Cursor to write correct OTel instrumentation with or without it.

## Backends

The traces go wherever you point `OTEL_EXPORTER_OTLP_ENDPOINT`:

- **Jaeger** (local) — `http://localhost:4318` — `docker compose up`
- **Grafana Cloud** — `https://otlp-gateway-<region>.grafana.net/otlp` with basic auth headers
- **Datadog** — run the Datadog Agent with OTLP ingest enabled on port 4318
- **Dynatrace** — `https://{env-id}.live.dynatrace.com/api/v2/otlp` with API token
- **Honeycomb** — `https://api.honeycomb.io` with `x-honeycomb-team` header

## AWS Lambda

Use the [AWS Distro for OpenTelemetry (ADOT) Lambda Layer](https://aws-otel.github.io/docs/getting-started/lambda) as your OTel collector. The layer handles exporting — your code just needs the tracer provider and instrumentation, which this rule provides.

## How the Rule Works

Cursor rules (`.mdc` files in `.cursor/rules/`) are instructions that Cursor follows when writing code. With `alwaysApply: true`, the rule is active in every conversation. When you ask Cursor to write a new service, add an API endpoint, or build an AI pipeline, it reads the rule and includes the correct OpenTelemetry setup, span creation, attribute assignment, and error handling — automatically. You get production-grade observability without thinking about it.

## Contributing

Issues and PRs welcome. If you use a different language (Python, Go, Java), consider contributing a rule variant.

## License

MIT
