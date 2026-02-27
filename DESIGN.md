# Design

## What this project does

cursor-auto-otel is a **Cursor rule** (`.mdc` file) plus a thin helper library. The rule instructs Cursor to generate code that includes OpenTelemetry instrumentation at **generation time**. When you ask Cursor to add an API, a pipeline, or an LLM call, the rule ensures the resulting code creates the right spans, attributes, and error handling—without you writing the boilerplate.

## Why generation-time enforcement matters

Runtime auto-instrumentation (e.g. OTel’s Node auto-instrumentations) can trace HTTP, DB, and gRPC out of the box. It cannot:

- Introduce **custom spans** for your pipelines or stages.
- Attach **pipeline semantics** (e.g. stage name, execution type) to those spans.
- Apply **GenAI semantic conventions** (provider, model, token usage) to LLM calls.

Those require code that wraps your logic in spans and sets attributes. By encoding this in a Cursor rule, every new pipeline or LLM integration Cursor writes is instrumented by default. You get consistent observability without relying on developers to remember the patterns.

## Where this approach breaks down

- **Rule drift** — If the rule is not updated when OTel or GenAI conventions change, generated code can become outdated.
- **Developer override** — Developers can delete or bypass the generated instrumentation.
- **Non-Cursor editors** — The rule only affects Cursor; code written in other editors or by hand has no automatic instrumentation unless the team adopts the same patterns.

## Custom vs standard attributes

The **pipeline.*** attributes (`pipeline.name`, `pipeline.stage`, `pipeline.execution_type`, `pipeline.success`) are **custom** and are not part of the official OpenTelemetry semantic conventions. They are chosen for clarity and consistency across AI pipelines. GenAI attributes (`gen_ai.*`) follow the [OTel GenAI semantic conventions](https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/).

## Future ideas

- **Multi-language rules** — Separate or conditional rule content for Python, Go, Java so non-Node projects get the same structure.
- **MCP server integration** — An MCP server that exposes trace context or span creation so Cursor (or other tools) can interact with the tracer at edit time.
- **Span-level prompt/response capture** — Optional capture of prompts and responses on GenAI spans (with PII/sensitivity controls) for debugging and evaluation.
