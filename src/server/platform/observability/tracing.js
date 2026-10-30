import { randomBytes } from 'node:crypto';
import { currentContext, runWithContext } from './context.js';
import { redactText } from './redact.js';

// Distributed tracing (FR-03): a request becomes a trace; the work it does (database statements, events it publishes, the
// consumers and jobs that handle them later) are spans of the same trace, linked by W3C `traceparent`. The data model follows
// OpenTelemetry (trace ID, span ID, parent, kind, attributes, status) and a trace can be exported as OTLP/JSON, so a collector can
// ingest it; the OpenTelemetry SDK itself is not installed (defect D-046). Recent traces are kept in memory for the Operations page.

const MAX_TRACES = 300;
const MAX_SPANS_PER_TRACE = 120;
const hex = (bytes) => randomBytes(bytes).toString('hex');
const nowNs = () => process.hrtime.bigint();
const epochMs = () => Date.now();

export const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;
export const formatTraceparent = (traceId, spanId) => `00-${traceId}-${spanId}-01`;
export function parseTraceparent(header) {
  const m = TRACEPARENT.exec(header ?? '');
  return m && m[1] !== '0'.repeat(32) && m[2] !== '0'.repeat(16) ? { traceId: m[1], spanId: m[2] } : null;
}

export function createTracer({ maxTraces = MAX_TRACES } = {}) {
  /** @type {Map<string, { traceId: string, spans: any[], dropped: number, startedAt: number, correlationId: string | null }>} */
  const traces = new Map();

  const traceOf = (traceId, correlationId) => {
    let t = traces.get(traceId);
    if (!t) {
      t = { traceId, spans: [], dropped: 0, startedAt: epochMs(), correlationId: correlationId ?? null };
      traces.set(traceId, t);
      if (traces.size > maxTraces) traces.delete(traces.keys().next().value);
    }
    if (correlationId && !t.correlationId) t.correlationId = correlationId;
    return t;
  };

  /** Start a span. `parent` is { traceId, spanId } (a remote or local parent); without one the current span is the parent, or a new trace begins. */
  function startSpan(name, { kind = 'internal', attributes = {}, parent = null } = {}) {
    const ctx = currentContext();
    const p = parent ?? (ctx?.span ? { traceId: ctx.span.traceId, spanId: ctx.span.spanId } : null);
    const traceId = p?.traceId ?? hex(16);
    const span = { traceId, spanId: hex(8), parentId: p?.spanId ?? null, name: redactText(name).slice(0, 160), kind, attributes: { ...attributes }, events: [], status: 'unset', startMs: epochMs(), startNs: nowNs(), durationMs: null, ended: false };
    const t = traceOf(traceId, ctx?.correlationId);
    if (t.spans.length < MAX_SPANS_PER_TRACE) t.spans.push(span);
    else t.dropped += 1;
    span.end = ({ status = span.status === 'unset' ? 'ok' : span.status, attributes: extra = {} } = {}) => {
      if (span.ended) return span;
      span.ended = true;
      span.status = status;
      span.durationMs = Number(nowNs() - span.startNs) / 1e6;
      Object.assign(span.attributes, extra);
      return span;
    };
    span.addEvent = (eventName, attrs = {}) => span.events.push({ name: eventName, timeMs: epochMs(), attributes: attrs });
    return span;
  }

  /** Run `fn` (sync or async) as a span; the span is current inside it and ends with the outcome. */
  function withSpan(name, options, fn) {
    const span = startSpan(name, options);
    const done = (status, err) => span.end({ status, attributes: err ? { 'error.message': redactText(String(err.message ?? err)) } : {} });
    let result;
    try {
      result = runWithContext({ span }, fn);
    } catch (err) {
      done('error', err);
      throw err;
    }
    if (result && typeof result.then === 'function') return result.then((v) => (done('ok'), v), (err) => (done('error', err), Promise.reject(err)));
    done('ok');
    return result;
  }

  const present = (t) => {
    const root = t.spans.find((s) => s.parentId === null || !t.spans.some((x) => x.spanId === s.parentId)) ?? t.spans[0];
    const ended = t.spans.filter((s) => s.ended);
    const durationMs = ended.length ? Math.max(...ended.map((s) => s.startMs - t.startedAt + (s.durationMs ?? 0))) : 0;
    return {
      traceId: t.traceId,
      correlationId: t.correlationId,
      name: root?.name ?? '(empty)',
      startedAt: new Date(t.startedAt).toISOString(),
      durationMs: Math.round(durationMs * 10) / 10,
      spanCount: t.spans.length + t.dropped,
      droppedSpans: t.dropped,
      status: t.spans.some((s) => s.status === 'error') ? 'error' : 'ok',
    };
  };

  const spanOut = (s, t0) => ({
    spanId: s.spanId,
    parentId: s.parentId,
    name: s.name,
    kind: s.kind,
    status: s.status,
    offsetMs: Math.round((s.startMs - t0) * 10) / 10,
    durationMs: s.durationMs === null ? null : Math.round(s.durationMs * 10) / 10,
    attributes: s.attributes,
    events: s.events,
  });

  return {
    startSpan,
    withSpan,
    recent: (limit = 50) => [...traces.values()].slice(-limit).reverse().map(present),
    get(traceId) {
      const t = traces.get(traceId);
      return t ? { ...present(t), spans: t.spans.map((s) => spanOut(s, t.startedAt)) } : null;
    },
    byCorrelation: (correlationId) => [...traces.values()].filter((t) => t.correlationId === correlationId).map((t) => ({ ...present(t), spans: t.spans.map((s) => spanOut(s, t.startedAt)) })),
    /** OTLP/JSON for one trace (the shape an OpenTelemetry collector accepts at /v1/traces). */
    otlp(traceId, { serviceName = 'erp-sap-cls' } = {}) {
      const t = traces.get(traceId);
      if (!t) return null;
      const kinds = { internal: 1, server: 2, client: 3, producer: 4, consumer: 5 };
      const value = (v) => (typeof v === 'number' ? (Number.isInteger(v) ? { intValue: String(v) } : { doubleValue: v }) : typeof v === 'boolean' ? { boolValue: v } : { stringValue: String(v) });
      return {
        resourceSpans: [{
          resource: { attributes: [{ key: 'service.name', value: { stringValue: serviceName } }] },
          scopeSpans: [{
            scope: { name: 'erp.core' },
            spans: t.spans.map((s) => ({
              traceId: s.traceId,
              spanId: s.spanId,
              ...(s.parentId ? { parentSpanId: s.parentId } : {}),
              name: s.name,
              kind: kinds[s.kind] ?? 1,
              startTimeUnixNano: String(BigInt(Math.round(s.startMs)) * 1_000_000n),
              endTimeUnixNano: String(BigInt(Math.round(s.startMs + (s.durationMs ?? 0))) * 1_000_000n),
              attributes: Object.entries(s.attributes).map(([key, v]) => ({ key, value: value(v) })),
              events: s.events.map((e) => ({ timeUnixNano: String(BigInt(e.timeMs) * 1_000_000n), name: e.name, attributes: Object.entries(e.attributes).map(([key, v]) => ({ key, value: value(v) })) })),
              status: { code: s.status === 'error' ? 2 : s.status === 'ok' ? 1 : 0 },
            })),
          }],
        }],
      };
    },
    size: () => traces.size,
    clear: () => traces.clear(),
  };
}

export const tracer = createTracer();
