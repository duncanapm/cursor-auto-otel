import random
import time

from cursor_auto_otel import setup_tracing, trace_pipeline, trace_step, trace_llm_call

setup_tracing("simple-pipeline-example")


def mock_llm_call(prompt: str) -> dict:
    time.sleep(0.08 + random.random() * 0.12)
    return {
        "text": f"Mock response to: {prompt[:50]}",
        "input_tokens": 42 + random.randint(0, 20),
        "output_tokens": 128 + random.randint(0, 50),
    }


user_message = "I need help resetting my password for my account"

with trace_pipeline("customer-support-pipeline") as pipeline:
    with trace_llm_call(
        pipeline,
        "classify-intent",
        provider="openai",
        model="gpt-4o-mini",
        operation_name="chat",
    ) as capture_usage:
        result = mock_llm_call(f'Classify the intent of: "{user_message}"')
        capture_usage(result["input_tokens"], result["output_tokens"], "stop")
        classification = {"intent": "password_reset", "confidence": 0.95}

    with trace_step(
        pipeline, "policy-check", execution_type="heuristic"
    ):
        time.sleep(0.005)
        blocked_intents = ["account_deletion", "refund_over_limit"]
        is_allowed = classification["intent"] not in blocked_intents

    if not is_allowed:
        reply = "This request requires human review."
    else:
        with trace_llm_call(
            pipeline,
            "generate-response",
            provider="openai",
            model="gpt-4o",
            operation_name="chat",
            max_tokens=512,
        ) as capture_usage:
            result = mock_llm_call(
                f"You are a support agent. The user intent is "
                f'"{classification["intent"]}" (confidence: {classification["confidence"]}). '
                f'Respond to: "{user_message}"'
            )
            capture_usage(result["input_tokens"], result["output_tokens"], "stop")
            reply = result["text"]

print(f"Pipeline result: {reply}")
print("Traces sent to http://localhost:4318 — view at http://localhost:16686")

time.sleep(2)
