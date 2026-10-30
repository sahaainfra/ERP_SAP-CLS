# API_CATALOGUE

Read from `src/server/app.js`.

| Method | Path | Access | Server-side validation |
|---|---|---|---|
| GET | /api/health | none (public) | no |
| GET | /api/v1/core/session | any authenticated user | no |
| GET | /api/v1/core/about | permission core.about.view | no |
| GET | /api/v1/core/feature-flags | permission core.flag.view | yes |
| GET | /api/v1/core/feature-flags/evaluate | any authenticated user | yes |
| PATCH | /api/v1/core/feature-flags/:key | permission core.flag.configure | yes |
