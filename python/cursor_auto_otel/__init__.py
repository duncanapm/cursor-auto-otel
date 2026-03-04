from __future__ import annotations

from contextlib import contextmanager
from dataclasses import dataclass
from typing import Callable, Generator, Optional

from opentelemetry import trace
from opentelemetry.trace import SpanKind, StatusCode, Span

from .attributes import GenAIAttributes, PipelineAttributes

__all__ = [
    "trace_pipeline",
    "trace_step",
    "trace_llm_call",
    "setup_tracing",
    "PipelineContext",
    "GenAIAttributes",
    "PipelineAttributes",
]

_TRACER_NAME = "cursor-auto-otel"


def _get_tracer() -> trace.Tracer:
    return trace.get_tracer(_TRACER_NAME)


@dataclass(frozen=True)
class PipelineContext:
    span: Span
    name: str


@contextmanager
def trace_pipeline(name: str) -> Generator[PipelineContext, None, None]:
    tracer = _get_tracer()
    with tracer.start_as_current_span(name, kind=SpanKind.INTERNAL) as span:
        span.set_attribute(PipelineAttributes.NAME, name)
        pipeline = PipelineContext(span=span, name=name)
        try:
            yield pipeline
            span.set_attribute(PipelineAttributes.SUCCESS, True)
        except Exception as exc:
            span.set_attribute(PipelineAttributes.SUCCESS, False)
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            raise


@contextmanager
def trace_step(
    pipeline: PipelineContext,
    stage_name: str,
    *,
    execution_type: str,
) -> Generator[None, None, None]:
    tracer = _get_tracer()
    ctx = trace.set_span_in_context(pipeline.span)
    with tracer.start_as_current_span(
        stage_name, kind=SpanKind.INTERNAL, context=ctx
    ) as span:
        span.set_attribute(PipelineAttributes.STAGE, stage_name)
        span.set_attribute(PipelineAttributes.EXECUTION_TYPE, execution_type)
        span.set_attribute(PipelineAttributes.NAME, pipeline.name)
        try:
            yield
            span.set_attribute(PipelineAttributes.SUCCESS, True)
        except Exception as exc:
            span.set_attribute(PipelineAttributes.SUCCESS, False)
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            raise


CaptureUsage = Callable[[int, int, Optional[str]], None]


@contextmanager
def trace_llm_call(
    pipeline: PipelineContext,
    stage_name: str,
    *,
    provider: str,
    model: str,
    operation_name: str = "chat",
    max_tokens: Optional[int] = None,
) -> Generator[CaptureUsage, None, None]:
    tracer = _get_tracer()
    ctx = trace.set_span_in_context(pipeline.span)
    span_name = f"{operation_name} {model}"

    with tracer.start_as_current_span(
        span_name, kind=SpanKind.CLIENT, context=ctx
    ) as span:
        span.set_attribute(PipelineAttributes.STAGE, stage_name)
        span.set_attribute(PipelineAttributes.EXECUTION_TYPE, "llm")
        span.set_attribute(PipelineAttributes.NAME, pipeline.name)
        span.set_attribute(GenAIAttributes.PROVIDER_NAME, provider)
        span.set_attribute(GenAIAttributes.SYSTEM, provider)
        span.set_attribute(GenAIAttributes.REQUEST_MODEL, model)
        span.set_attribute(GenAIAttributes.OPERATION_NAME, operation_name)
        if max_tokens is not None:
            span.set_attribute(GenAIAttributes.REQUEST_MAX_TOKENS, max_tokens)

        def capture_usage(
            input_tokens: int,
            output_tokens: int,
            finish_reason: Optional[str] = None,
        ) -> None:
            span.set_attribute(GenAIAttributes.USAGE_INPUT_TOKENS, input_tokens)
            span.set_attribute(GenAIAttributes.USAGE_OUTPUT_TOKENS, output_tokens)
            if finish_reason:
                span.set_attribute(
                    GenAIAttributes.RESPONSE_FINISH_REASONS, [finish_reason]
                )

        try:
            yield capture_usage
            span.set_attribute(PipelineAttributes.SUCCESS, True)
        except Exception as exc:
            span.set_attribute(PipelineAttributes.SUCCESS, False)
            span.record_exception(exc)
            span.set_status(StatusCode.ERROR, str(exc))
            raise


def setup_tracing(service_name: str) -> None:
    from opentelemetry.sdk.trace import TracerProvider
    from opentelemetry.sdk.trace.export import BatchSpanProcessor
    from opentelemetry.exporter.otlp.proto.http.trace_exporter import OTLPSpanExporter
    from opentelemetry.sdk.resources import Resource, SERVICE_NAME

    resource = Resource.create({SERVICE_NAME: service_name})
    provider = TracerProvider(resource=resource)
    provider.add_span_processor(BatchSpanProcessor(OTLPSpanExporter()))
    trace.set_tracer_provider(provider)
