# cursor-auto-otel

[![CI](https://github.com/duncanapm/cursor-auto-otel/actions/workflows/ci.yml/badge.svg)](https://github.com/duncanapm/cursor-auto-otel/actions/workflows/ci.yml)

cursor-auto-otel makes Cursor generate **OpenTelemetry-instrumented code** by default. Add the rule; set an env var; every handler, pipeline, and LLM call Cursor writes is traced.

It does **not** instrument Cursor itself — it teaches Cursor to emit code that, when you run it, produces standard OTel traces and sends them to any OTLP backend (Jaeger, Grafana Cloud, Datadog, Honeycomb, etc.). Supported runtimes: **TypeScript/Node.js** and **Python**.

## What Gets Traced

| Layer | What | Example Span Names | Key Attributes |
|-------|------|-------------------|----------------|
| Infrastructure (via auto-instrumentation) | HTTP, gRPC, DB clients | `GET /api/users`, `DynamoDB.GetItem` | Standard OTel HTTP/DB semantic conventions |
| Pipeline structure | Multi-step processing flows | `customer-support-pipeline`, `classify-intent` | `pipeline.name`, `pipeline.stage`, `pipeline.execution_type`, `pipeline.success` |
| GenAI / LLM calls | OpenAI, Anthropic, Bedrock, etc. | `chat gpt-4o`, `chat claude-sonnet-4-20250514` | `gen_ai.provider.name`, `gen_ai.system`, `gen_ai.request.model`, `gen_ai.usage.input_tokens` |

Infrastructure spans come free from auto-instrumentation. Rows 2 and 3 are what cursor-auto-otel adds.

---

## Documentation

| Document | Audience | Purpose |
|----------|----------|---------|
| **[HUMAN_INSTRUCTIONS.md](HUMAN_INSTRUCTIONS.md)** | Engineers | What cursor-auto-otel is, why it exists, guarantees and limitations, installation, verification, troubleshooting. |
| **[CURSOR_RULE.md](CURSOR_RULE.md)** | AI / Cursor | Deterministic enforcement specification (MUST/MUST NOT, tracer init, span wrapping, error recording, LLM instrumentation, async context, canonical pattern, forbidden anti-patterns, generation checklist). |

The Cursor rule file [.cursor/rules/auto-otel.mdc](.cursor/rules/auto-otel.mdc) is a concise enforcement layer that aligns with **CURSOR_RULE.md**; use it in your project so Cursor applies the behaviour when generating code.

---

## Quick start

1. Copy the rule:  
   `mkdir -p .cursor/rules && curl -o .cursor/rules/auto-otel.mdc https://raw.githubusercontent.com/duncanapm/cursor-auto-otel/main/.cursor/rules/auto-otel.mdc`
2. Set OTLP endpoint:  
   `export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318`
3. Optionally install the helper:  
   `npm install cursor-auto-otel @opentelemetry/api` or `pip install cursor-auto-otel`

For full setup, verification steps, and troubleshooting, see **[HUMAN_INSTRUCTIONS.md](HUMAN_INSTRUCTIONS.md)**.

### AWS Lambda

Use the [AWS Distro for OpenTelemetry (ADOT) Lambda Layer](https://aws-otel.github.io/docs/getting-started/lambda). The layer provides the tracer and export; your code does not bundle OpenTelemetry. Set `AWS_LAMBDA_EXEC_WRAPPER=/opt/otel-instrument` and enable **Lambda active tracing** (X-Ray). Traces appear in CloudWatch/X-Ray. For export to a custom OTLP endpoint (e.g. Jaeger), see [HUMAN_INSTRUCTIONS.md § AWS Lambda](HUMAN_INSTRUCTIONS.md#aws-lambda).

---

## License

MIT
