// Provider abstraction (FR-03). A module asks for an operation on a connector ("send" on the connector "mail.main"); the
// provider registered for that connector's type and provider name does the work. Switching from one email service to
// another is a change of connector, not of module code.

export const CONNECTOR_TYPES = ['email', 'sms', 'whatsapp', 'gsp', 'bank', 'biometric', 'maps', 'ocr', 'ai', 'storage'];
export const ENVIRONMENTS = ['development', 'staging', 'production'];

/** What every provider of a type must be able to do. Later parts add to this as they build their module. */
export const TYPE_INTERFACES = Object.freeze({
  email: { operations: ['send'], label: 'Email', description: 'send(to, subject, text)' },
  sms: { operations: [], label: 'SMS', description: 'Text messages (part 04.07)' },
  whatsapp: { operations: [], label: 'WhatsApp', description: 'WhatsApp messages (part 04.07)' },
  gsp: { operations: [], label: 'GST provider / e-invoice', description: 'GST and e-invoice (part 23.07)' },
  bank: { operations: [], label: 'Bank', description: 'Bank files and statements (part 29.02)' },
  biometric: { operations: [], label: 'Biometric', description: 'Attendance devices (part 29.02)' },
  maps: { operations: [], label: 'Maps', description: 'Maps and geocoding' },
  ocr: { operations: [], label: 'OCR', description: 'Document reading' },
  ai: { operations: [], label: 'AI', description: 'AI gateway (part 28.01)' },
  storage: { operations: [], label: 'Storage', description: 'External object storage' },
});

/** Types whose connectors need the CFO as a further approver (banking and GST, section 9 of the part). */
export const CFO_TYPES = new Set(['bank', 'gsp']);

/** A failure from a provider. `retryable` failures (timeouts, network errors, 5xx, 429) are tried again; the rest are not. */
export class ProviderError extends Error {
  constructor(message, { retryable = false, httpStatus = null, timeout = false, response = null } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.retryable = retryable;
    this.httpStatus = httpStatus;
    this.timeout = timeout;
    this.response = response;
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOCAL_HOST = /^(localhost|127\.0\.0\.1|\[::1\])$/;
const PRIVATE_HOST = /^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|0\.|localhost$|\[)/;

/** Only https endpoints; plain http to this machine is allowed outside production so tests and local sandboxes work. */
export function endpointProblem(url, environment) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return 'The base URL is not a valid address.';
  }
  const production = environment === 'production';
  if (u.protocol === 'https:') return production && PRIVATE_HOST.test(u.hostname) ? 'A production connector cannot point at a private or local address.' : null;
  if (u.protocol === 'http:' && !production && LOCAL_HOST.test(u.hostname)) return null;
  return 'The base URL must start with https:// (plain http is accepted only for localhost outside production).';
}

/** One JSON request to a provider with the timeout signal and the standard classification of the answer. */
export async function httpJson(ctx, /** @type {{ method?: string, path: string, body?: any, headers?: Record<string, string> }} */ { method = 'POST', path, body, headers = {} }) {
  const base = ctx.config.baseUrl.replace(/\/+$/, '');
  const url = `${base}${path.startsWith('/') ? path : `/${path}`}`;
  let res;
  try {
    res = await ctx.fetch(url, {
      method,
      signal: ctx.signal,
      headers: { 'content-type': 'application/json', accept: 'application/json', ...(ctx.idempotencyKey ? { 'idempotency-key': ctx.idempotencyKey } : {}), 'x-correlation-id': ctx.correlationId ?? '', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw new ProviderError('The provider did not answer in time.', { retryable: true, timeout: true });
    throw new ProviderError(`Cannot reach the provider: ${err?.cause?.code ?? err?.message ?? 'network error'}.`, { retryable: true });
  }
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text ? { raw: text.slice(0, 500) } : null;
  }
  if (res.ok) return { httpStatus: res.status, data };
  const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
  throw new ProviderError(`The provider answered HTTP ${res.status}.`, { retryable, httpStatus: res.status, response: data });
}

const bearer = (ctx) => (ctx.secrets.api_key ? { authorization: `Bearer ${ctx.secrets.api_key}` } : {});

const sandboxMailbox = [];
/** What the sandbox email provider has "sent" (newest last), for the sample message and for tests. */
export const sandboxMessages = () => sandboxMailbox.slice();

const emailProblems = (p) => {
  const problems = [];
  if (!p || typeof p !== 'object') return [{ field: 'payload', message: 'Send an object with to, subject and text.' }];
  const list = [].concat(p.to ?? []);
  if (list.length === 0 || list.length > 50 || !list.every((a) => typeof a === 'string' && EMAIL.test(a))) problems.push({ field: 'to', message: 'Give one to 50 valid email addresses.' });
  if (typeof p.subject !== 'string' || !p.subject.trim() || p.subject.length > 300) problems.push({ field: 'subject', message: 'Give a subject of at most 300 characters.' });
  if (typeof p.text !== 'string' || !p.text.trim() || p.text.length > 100_000) problems.push({ field: 'text', message: 'Give the message text.' });
  return problems;
};

/** @typedef {{ name: string, label: string, required?: boolean, help?: string }} Field */
/**
 * @typedef {object} Provider
 * @property {string} type
 * @property {string} provider
 * @property {string} label
 * @property {string} description
 * @property {Field[]} configFields
 * @property {Field[]} secrets
 * @property {Record<string, { validate?: (payload: any) => any[], run: (ctx: any, payload: any) => Promise<any> }>} operations
 * @property {(ctx: any) => Promise<any>} health
 * @property {{ operation: string, payload: (actor: any) => any } | null} [sample]
 * @property {(config: any, environment: string) => string[]} [validateConfig]
 */

export function createProviderRegistry() {
  /** @type {Map<string, Provider>} */
  const map = new Map();
  const registry = {
    register(p) {
      if (!CONNECTOR_TYPES.includes(p.type)) throw new Error(`Unknown connector type ${p.type}`);
      for (const op of TYPE_INTERFACES[p.type].operations) {
        if (!p.operations?.[op]) throw new Error(`Provider ${p.type}/${p.provider} must implement ${op}`);
      }
      map.set(`${p.type}/${p.provider}`, { sample: null, ...p });
      return registry;
    },
    get: (type, provider) => map.get(`${type}/${provider}`) ?? null,
    list: () => [...map.values()],
    forType: (type) => [...map.values()].filter((p) => p.type === type),
  };
  return registry;
}

/** The providers that ship with the platform: a sandbox email service, a real HTTP email API, and a generic HTTP JSON API for the other types. */
export function registerBuiltinProviders(registry) {
  registry.register({
    type: 'email',
    provider: 'sandbox',
    label: 'Sandbox (no mail leaves the system)',
    description: 'Accepts messages and keeps them in memory. For set-up, training and tests.',
    configFields: [{ name: 'fromAddress', label: 'From address', required: true }],
    secrets: [{ name: 'api_key', label: 'API key (optional)', required: false }],
    validateConfig: (c) => (EMAIL.test(String(c.fromAddress ?? '')) ? [] : ['fromAddress must be a valid email address.']),
    operations: {
      send: {
        validate: emailProblems,
        async run(ctx, payload) {
          const message = { id: `sbx-${sandboxMailbox.length + 1}-${Date.now().toString(36)}`, from: ctx.config.fromAddress, to: [].concat(payload.to), subject: payload.subject, at: new Date().toISOString(), connector: ctx.connector.code };
          sandboxMailbox.push(message);
          if (sandboxMailbox.length > 200) sandboxMailbox.shift();
          return { httpStatus: 200, data: { messageId: message.id, accepted: message.to.length } };
        },
      },
    },
    async health(ctx) {
      return { message: `Sandbox ready, sending as ${ctx.config.fromAddress}.` };
    },
    sample: { operation: 'send', payload: (actor) => ({ to: [`${String(actor.user).replace(/[^a-z0-9._-]/gi, '') || 'admin'}@example.com`], subject: 'Test message from the integration hub', text: 'This message was sent through the provider abstraction to prove the connector works.' }) },
  });

  registry.register({
    type: 'email',
    provider: 'http_api',
    label: 'HTTP email API',
    description: 'Posts JSON to an email service (base URL + send path) with a bearer API key.',
    configFields: [
      { name: 'baseUrl', label: 'Base URL', required: true, help: 'https://... for the email service' },
      { name: 'sendPath', label: 'Send path', help: 'Default /send' },
      { name: 'healthPath', label: 'Health path', help: 'Default /health' },
      { name: 'fromAddress', label: 'From address', required: true },
    ],
    secrets: [{ name: 'api_key', label: 'API key', required: true }],
    validateConfig: (c, env) => [...(EMAIL.test(String(c.fromAddress ?? '')) ? [] : ['fromAddress must be a valid email address.']), ...[endpointProblem(String(c.baseUrl ?? ''), env)].filter(Boolean)],
    operations: {
      send: {
        validate: emailProblems,
        run: (ctx, payload) => httpJson(ctx, { path: ctx.config.sendPath || '/send', headers: bearer(ctx), body: { from: ctx.config.fromAddress, to: [].concat(payload.to), subject: payload.subject, text: payload.text } }),
      },
    },
    health: async (ctx) => {
      const out = await httpJson(ctx, { method: 'GET', path: ctx.config.healthPath || '/health', headers: bearer(ctx) });
      return { message: `Provider answered HTTP ${out.httpStatus}.` };
    },
    sample: { operation: 'send', payload: (actor) => ({ to: [`${String(actor.user).replace(/[^a-z0-9._-]/gi, '') || 'admin'}@example.com`], subject: 'Test message from the integration hub', text: 'This message was sent through the provider abstraction to prove the connector works.' }) },
  });

  for (const type of CONNECTOR_TYPES.filter((t) => t !== 'email')) {
    registry.register({
      type,
      provider: 'http_json',
      label: 'Generic HTTP JSON API',
      description: 'Calls any JSON API with a bearer API key. Later parts add dedicated providers for their service.',
      configFields: [
        { name: 'baseUrl', label: 'Base URL', required: true },
        { name: 'healthPath', label: 'Health path', help: 'Default /health' },
      ],
      secrets: [{ name: 'api_key', label: 'API key', required: true }],
      validateConfig: (c, env) => [endpointProblem(String(c.baseUrl ?? ''), env)].filter(Boolean),
      operations: {
        request: {
          validate: (p) => (p && typeof p === 'object' && typeof p.path === 'string' && p.path.startsWith('/') ? [] : [{ field: 'path', message: 'Give a path that starts with /.' }]),
          run: (ctx, p) => httpJson(ctx, { method: p.method ?? 'POST', path: p.path, body: p.body, headers: bearer(ctx) }),
        },
      },
      health: async (ctx) => {
        const out = await httpJson(ctx, { method: 'GET', path: ctx.config.healthPath || '/health', headers: bearer(ctx) });
        return { message: `Provider answered HTTP ${out.httpStatus}.` };
      },
    });
  }
  return registry;
}
