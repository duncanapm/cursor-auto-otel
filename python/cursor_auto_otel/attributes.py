# https://opentelemetry.io/docs/specs/semconv/gen-ai/gen-ai-spans/


class GenAIAttributes:
    PROVIDER_NAME = "gen_ai.provider.name"
    # Deprecated in OTEL spec; set to same value as provider for backend compatibility (e.g. Dash0).
    SYSTEM = "gen_ai.system"
    REQUEST_MODEL = "gen_ai.request.model"
    RESPONSE_MODEL = "gen_ai.response.model"
    OPERATION_NAME = "gen_ai.operation.name"
    USAGE_INPUT_TOKENS = "gen_ai.usage.input_tokens"
    USAGE_OUTPUT_TOKENS = "gen_ai.usage.output_tokens"
    RESPONSE_FINISH_REASONS = "gen_ai.response.finish_reasons"
    RESPONSE_ID = "gen_ai.response.id"
    REQUEST_MAX_TOKENS = "gen_ai.request.max_tokens"
    REQUEST_TEMPERATURE = "gen_ai.request.temperature"
    REQUEST_TOP_P = "gen_ai.request.top_p"


class PipelineAttributes:
    NAME = "pipeline.name"
    STAGE = "pipeline.stage"
    EXECUTION_TYPE = "pipeline.execution_type"
    SUCCESS = "pipeline.success"
