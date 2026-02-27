// GenAI semantic convention attributes
// https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/
export const GenAIAttributes = {
  PROVIDER_NAME: "gen_ai.provider.name",
  REQUEST_MODEL: "gen_ai.request.model",
  RESPONSE_MODEL: "gen_ai.response.model",
  OPERATION_NAME: "gen_ai.operation.name",
  USAGE_INPUT_TOKENS: "gen_ai.usage.input_tokens",
  USAGE_OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  RESPONSE_FINISH_REASONS: "gen_ai.response.finish_reasons",
  RESPONSE_ID: "gen_ai.response.id",
  REQUEST_MAX_TOKENS: "gen_ai.request.max_tokens",
  REQUEST_TEMPERATURE: "gen_ai.request.temperature",
  REQUEST_TOP_P: "gen_ai.request.top_p",
} as const;

export const PipelineAttributes = {
  NAME: "pipeline.name",
  STAGE: "pipeline.stage",
  EXECUTION_TYPE: "pipeline.execution_type",
  SUCCESS: "pipeline.success",
} as const;

export type ExecutionType = "llm" | "heuristic" | "programmatic";

export type GenAIProviderName =
  | "openai"
  | "anthropic"
  | "aws.bedrock"
  | "azure.ai.openai"
  | "cohere"
  | "deepseek"
  | "gcp.gemini"
  | "gcp.vertex_ai"
  | "groq"
  | "mistral_ai"
  | "perplexity"
  | (string & {});
