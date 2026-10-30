# API_CATALOGUE

Read from `src/server/app.js` and every `src/server/modules/<code>/<resource>/routes.js`.
Validation is "yes" when the controller method calls a validator before the service.

| Method | Path | Access | Server-side validation |
|---|---|---|---|
| GET | /api/health | none (public) | no |
| GET | /health/live | none (public) | no |
| GET | /health/ready | administrators or monitoring token | no |
| GET | /api/v1/core/about | permission core.about.view | no |
| GET | /api/v1/core/architecture | permission core.arch.view | no |
| GET | /api/v1/core/feature-flags | permission core.flag.view | yes |
| GET | /api/v1/core/feature-flags/evaluate | any authenticated user | yes |
| PATCH | /api/v1/core/feature-flags/:key | permission core.flag.configure | yes |
| POST | /api/v1/core/integrity/run | permission core.integrity.run | no |
| GET | /api/v1/core/integrity/summary | permission core.integrity.view | no |
| GET | /api/v1/core/integrity/runs | permission core.integrity.view | yes |
| GET | /api/v1/core/session | any authenticated user | no |
