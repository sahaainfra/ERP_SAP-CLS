import { ProviderError, httpJson } from '../../platform/integrations/providers.js';

// Weather connectors for the integration hub (part 14.03, FR-01). There is no connector type of its own (the type list is fixed in the connector table), so a weather service is a connector of type
// "maps" (location services) with one of these providers; `site.weather.connector` names the connector the site module calls. Operation "weather": { siteId, lat, lng, date } -> { rainfallMm, tempMin, tempMax, humidityPct, windKmh }.
const hash = (s) => { let h = 2166136261; for (const c of String(s)) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; };
const validate = (p) => [...(p && typeof p.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(p.date) ? [] : [{ field: 'date', message: 'Give a date such as 2026-07-15.' }])];
const num = (v) => (v === undefined || v === null || v === '' ? null : Number(v));

export function registerWeatherProviders(registry) {
  if (registry.get('maps', 'weather_sandbox')) return;
  registry.register({
    type: 'maps', provider: 'weather_sandbox', label: 'Weather (sandbox)', description: 'Answers a weather observation worked out from the site and the date, so set-up and training need no outside service. The optional values below fix the answer.',
    configFields: [{ name: 'rainfallMm', label: 'Fixed rainfall (mm)' }, { name: 'tempMin', label: 'Fixed lowest temperature' }, { name: 'tempMax', label: 'Fixed highest temperature' }], secrets: [{ name: 'api_key', label: 'API key (optional)', required: false }],
    operations: {
      weather: {
        validate,
        async run(ctx, p) {
          const h = hash(`${p.siteId ?? p.siteCode ?? ''}|${p.date}`); const fixed = (k) => num(ctx.config[k]);
          const rain = fixed('rainfallMm') ?? ((h % 100) < 30 ? ((h >>> 8) % 400) / 10 : 0); const tmin = fixed('tempMin') ?? 18 + ((h >>> 4) % 8); const tmax = fixed('tempMax') ?? tmin + 6 + ((h >>> 12) % 6);
          return { httpStatus: 200, data: { rainfallMm: rain, tempMin: tmin, tempMax: tmax, humidityPct: rain > 0 ? 85 + ((h >>> 16) % 15) : 45 + ((h >>> 16) % 30), windKmh: 6 + ((h >>> 20) % 20) } };
        },
      },
    },
    async health() { return { message: 'Sandbox weather ready.' }; },
    sample: { operation: 'weather', payload: () => ({ siteId: 0, date: new Date().toISOString().slice(0, 10) }) },
  });
  registry.register({
    type: 'maps', provider: 'weather_http', label: 'Weather HTTP API', description: 'Reads a weather observation from a JSON service: GET {base URL}{path}?lat=&lng=&date= with a bearer key. The answer holds rainfallMm, tempMin, tempMax, humidityPct and windKmh.',
    configFields: [{ name: 'baseUrl', label: 'Base URL', required: true }, { name: 'weatherPath', label: 'Weather path', help: 'Default /weather' }, { name: 'healthPath', label: 'Health path', help: 'Default /health' }], secrets: [{ name: 'api_key', label: 'API key', required: true }],
    validateConfig: (c) => (/^https:\/\//i.test(String(c.baseUrl ?? '')) || /^http:\/\/(localhost|127\.0\.0\.1)/i.test(String(c.baseUrl ?? '')) ? [] : ['baseUrl must start with https://.']),
    operations: {
      weather: {
        validate,
        async run(ctx, p) {
          if (p.lat == null || p.lng == null) throw new ProviderError('The site has no position: set its latitude and longitude, or enter the weather by hand.', { retryable: false });
          const out = await httpJson(ctx, { method: 'GET', path: `${ctx.config.weatherPath || '/weather'}?lat=${encodeURIComponent(p.lat)}&lng=${encodeURIComponent(p.lng)}&date=${encodeURIComponent(p.date)}`, headers: ctx.secrets.api_key ? { authorization: `Bearer ${ctx.secrets.api_key}` } : {} });
          const d = out.data ?? {}; return { httpStatus: out.httpStatus, data: { rainfallMm: num(d.rainfallMm ?? d.rain_mm), tempMin: num(d.tempMin ?? d.temp_min), tempMax: num(d.tempMax ?? d.temp_max), humidityPct: num(d.humidityPct ?? d.humidity), windKmh: num(d.windKmh ?? d.wind_kmh) } };
        },
      },
    },
    async health(ctx) { const out = await httpJson(ctx, { method: 'GET', path: ctx.config.healthPath || '/health', headers: ctx.secrets.api_key ? { authorization: `Bearer ${ctx.secrets.api_key}` } : {} }); return { message: `Provider answered HTTP ${out.httpStatus}.` }; },
  });
}
