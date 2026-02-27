# Simple pipeline example

Express server with one POST route that runs a traced support pipeline: simulated DB lookup, LLM classification, and LLM response generation. The HTTP request span (from OTel auto-instrumentation) is the root; pipeline and step spans are nested beneath it.

## Run instructions

1. **From the repo root**, start Jaeger (optional; traces will export to it if running):

   ```bash
   docker compose up -d
   ```

2. **Set the OTLP endpoint** (defaults to Jaeger on 4318):

   ```bash
   export OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
   ```

3. **Install and start the example**:

   ```bash
   cd examples/simple-pipeline
   npm install
   npm start
   ```

4. **Send a request**:

   ```bash
   curl -X POST http://localhost:3000/api/support -H "Content-Type: application/json" -d '{"message":"I need to reset my password"}'
   ```

5. **View traces** in Jaeger: http://localhost:16686 — select service `simple-pipeline-example` and find the trace for your request.

## Expected trace hierarchy

With auto-instrumentation enabled, the HTTP server span is the root. The pipeline and its steps appear as children:

```
POST /api/support (SERVER)
  └── customer-support-pipeline (INTERNAL)
       ├── lookup-customer (INTERNAL, programmatic)
       ├── classify-intent (CLIENT, llm)
       └── generate-response (CLIENT, llm)
```

- **POST /api/support** — from `@opentelemetry/auto-instrumentations-node` (HTTP).
- **customer-support-pipeline** — root span from `tracePipeline()`.
- **lookup-customer** — `traceStep(..., { executionType: "programmatic" })` (simulated DB).
- **classify-intent** — `traceLLMCall(..., { provider: "openai", model: "gpt-4o-mini" })`.
- **generate-response** — `traceLLMCall(..., { provider: "openai", model: "gpt-4o" })`.
