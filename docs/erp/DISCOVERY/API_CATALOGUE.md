# API_CATALOGUE

Read from `src/server/app.js` and every `src/server/modules/<code>/<resource>/routes.js`.
Validation is "yes" when the controller method calls a validator before the service.

| Method | Path | Access | Server-side validation |
|---|---|---|---|
| GET | /api/health | none (public) | no |
| GET | /health/live | none (public) | no |
| GET | /health/ready | administrators or monitoring token | no |
| GET | /metrics | none (public) | no |
| GET | /api/v1/core/about | permission core.about.view | no |
| GET | /api/v1/core/architecture | permission core.arch.view | no |
| GET | /api/v1/core/formulas | any authenticated user | no |
| POST | /api/v1/core/formulas | any authenticated user | no |
| GET | /api/v1/core/formulas/:code | any authenticated user | no |
| POST | /api/v1/core/formulas/:code/versions | any authenticated user | no |
| PATCH | /api/v1/core/formulas/:code/versions/:version | any authenticated user | no |
| GET | /api/v1/core/formulas/:code/versions/:version/check | any authenticated user | no |
| POST | /api/v1/core/formulas/:code/versions/:version/shadow | any authenticated user | no |
| POST | /api/v1/core/formulas/:code/versions/:version/shadow/stop | any authenticated user | no |
| POST | /api/v1/core/formulas/:code/versions/:version/activation-requests | any authenticated user | no |
| POST | /api/v1/core/formulas/:code/test | any authenticated user | no |
| POST | /api/v1/core/formulas/:code/compare | any authenticated user | no |
| GET | /api/v1/core/formulas/:code/shadow-summary | any authenticated user | no |
| GET | /api/v1/core/calc-traces | any authenticated user | no |
| GET | /api/v1/core/uoms | any authenticated user | no |
| POST | /api/v1/core/uoms | any authenticated user | no |
| GET | /api/v1/core/uom-conversions | any authenticated user | no |
| POST | /api/v1/core/uom-conversions | any authenticated user | no |
| DELETE | /api/v1/core/uom-conversions/:id | any authenticated user | no |
| POST | /api/v1/core/calc/convert | any authenticated user | no |
| GET | /api/v1/core/change-requests | permission core.requests.view | no |
| GET | /api/v1/core/change-requests/:id | permission core.requests.view | no |
| POST | /api/v1/core/change-requests/:id/act | permission core.requests.view | no |
| POST | /api/v1/core/change-requests/:id/resubmit | permission core.requests.view | no |
| POST | /api/v1/core/change-requests/:id/withdraw | permission core.requests.view | no |
| GET | /api/v1/core/events/metrics | permission core.events.view | no |
| GET | /api/v1/core/events/types | permission core.events.view | no |
| GET | /api/v1/core/events/consumers | permission core.events.view | no |
| GET | /api/v1/core/events/dlq | permission core.events.view | no |
| POST | /api/v1/core/events/dlq/:id/redrive | permission core.events.redrive | no |
| POST | /api/v1/core/events/dlq/:id/discard | permission core.events.redrive | no |
| POST | /api/v1/core/events/replay | permission core.events.replay | no |
| GET | /api/v1/core/events | permission core.events.view | no |
| GET | /api/v1/core/feature-flags | permission core.flag.view | yes |
| GET | /api/v1/core/feature-flags/evaluate | any authenticated user | yes |
| PATCH | /api/v1/core/feature-flags/:key | permission core.flag.configure | yes |
| GET | /api/v1/core/files/settings | permission core.files.admin | no |
| POST | /api/v1/core/files/settings/change-requests | permission core.files.configure | no |
| GET | /api/v1/core/files/overview | permission core.files.admin | no |
| GET | /api/v1/core/files/admin | permission core.files.admin | no |
| POST | /api/v1/core/files/uploads | any authenticated user | no |
| GET | /api/v1/core/files/uploads/:uploadId | any authenticated user | no |
| PUT | /api/v1/core/files/uploads/:uploadId | any authenticated user | no |
| POST | /api/v1/core/files/uploads/:uploadId/complete | any authenticated user | no |
| POST | /api/v1/core/files | any authenticated user | no |
| GET | /api/v1/core/files | any authenticated user | no |
| GET | /api/v1/core/files/:id | any authenticated user | no |
| GET | /api/v1/core/files/:id/url | any authenticated user | no |
| POST | /api/v1/core/files/:id/rescan | permission core.files.admin | no |
| DELETE | /api/v1/core/files/:id | any authenticated user | no |
| GET | /api/v1/core/core/files/:id/content | any authenticated user | no |
| GET | /api/v1/core/financial-years | permission core.fy.view | no |
| POST | /api/v1/core/financial-years | permission core.fy.configure | no |
| GET | /api/v1/core/financial-years/:id | permission core.fy.view | no |
| POST | /api/v1/core/financial-years/:id/close | permission core.period.manage | no |
| POST | /api/v1/core/periods/:id/status | permission core.period.manage | no |
| POST | /api/v1/core/period-reopen-requests | permission core.period.request_reopen | no |
| GET | /api/v1/core/holiday-calendars | any authenticated user | no |
| GET | /api/v1/core/holiday-calendars/:id | any authenticated user | no |
| GET | /api/v1/core/holidays/check | any authenticated user | no |
| POST | /api/v1/core/holiday-calendars | permission core.holiday.configure | no |
| PATCH | /api/v1/core/holiday-calendars/:id | permission core.holiday.configure | no |
| POST | /api/v1/core/holiday-calendars/:id/holidays | permission core.holiday.configure | no |
| POST | /api/v1/core/holiday-calendars/:id/import | permission core.holiday.configure | no |
| PATCH | /api/v1/core/holidays/:id | permission core.holiday.configure | no |
| DELETE | /api/v1/core/holidays/:id | permission core.holiday.configure | no |
| POST | /api/v1/core/integrity/run | permission core.integrity.run | no |
| GET | /api/v1/core/integrity/summary | permission core.integrity.view | no |
| GET | /api/v1/core/integrity/runs | permission core.integrity.view | yes |
| GET | /api/v1/core/jobs/types | permission core.jobs.view | no |
| GET | /api/v1/core/jobs | permission core.jobs.view | no |
| GET | /api/v1/core/jobs/:id | permission core.jobs.view | no |
| POST | /api/v1/core/jobs/:id/cancel | permission core.jobs.manage | no |
| POST | /api/v1/core/jobs/:id/retry | permission core.jobs.manage | no |
| GET | /api/v1/core/schedules/preview | permission core.schedule.view | no |
| GET | /api/v1/core/schedules | permission core.schedule.view | no |
| POST | /api/v1/core/schedules/:id/change-requests | permission core.schedule.manage | no |
| GET | /api/v1/core/document-types | permission core.numbering.view | no |
| POST | /api/v1/core/document-types | permission core.numbering.configure | no |
| PATCH | /api/v1/core/document-types/:id | permission core.numbering.configure | no |
| GET | /api/v1/core/number-series | permission core.numbering.view | no |
| POST | /api/v1/core/number-series | permission core.numbering.configure | no |
| GET | /api/v1/core/number-series/:id | permission core.numbering.view | no |
| PATCH | /api/v1/core/number-series/:id | permission core.numbering.configure | no |
| POST | /api/v1/core/number-series/:id/change-requests | permission core.numbering.configure | no |
| GET | /api/v1/core/numbering/preview | permission core.numbering.preview | no |
| POST | /api/v1/core/numbering/next | permission core.numbering.issue | yes |
| GET | /api/v1/core/numbering/issues | permission core.numbering.view | yes |
| GET | /api/v1/core/ops/summary | any authenticated user | no |
| GET | /api/v1/core/ops/slos | any authenticated user | no |
| GET | /api/v1/core/ops/alert-rules | any authenticated user | no |
| GET | /api/v1/core/ops/alerts | any authenticated user | no |
| POST | /api/v1/core/ops/alerts/:id/acknowledge | any authenticated user | no |
| POST | /api/v1/core/ops/evaluate | any authenticated user | no |
| POST | /api/v1/core/ops/slo-definitions/:journey/change-requests | any authenticated user | no |
| POST | /api/v1/core/ops/alert-rules/:code/change-requests | any authenticated user | no |
| GET | /api/v1/core/ops/traces | any authenticated user | no |
| GET | /api/v1/core/ops/traces/:traceId/otlp | any authenticated user | no |
| GET | /api/v1/core/ops/traces/:traceId | any authenticated user | no |
| GET | /api/v1/core/ops/follow | any authenticated user | no |
| POST | /api/v1/core/ops/client-events | any authenticated user | no |
| GET | /api/v1/core/ops/client-events | any authenticated user | no |
| GET | /api/v1/core/ops/baseline | any authenticated user | no |
| POST | /api/v1/core/ops/diagnostics/force-error | any authenticated user | no |
| GET | /api/v1/core/parameters/definitions | permission core.param.view | no |
| GET | /api/v1/core/parameters/resolve | permission core.param.view | no |
| GET | /api/v1/core/parameters | permission core.param.view | no |
| POST | /api/v1/core/parameters | any authenticated user | no |
| GET | /api/v1/core/sample-bills | any authenticated user | no |
| POST | /api/v1/core/sample-bills | any authenticated user | no |
| GET | /api/v1/core/sample-bills/:id | any authenticated user | no |
| PATCH | /api/v1/core/sample-bills/:id | any authenticated user | no |
| POST | /api/v1/core/sample-bills/:id/submit | any authenticated user | no |
| POST | /api/v1/core/sample-bills/:id/recalculate | any authenticated user | no |
| GET | /api/v1/core/sample-documents | permission core.sample.use | no |
| GET | /api/v1/core/sample-documents/number-preview | permission core.sample.use | no |
| POST | /api/v1/core/sample-documents | permission core.sample.use | no |
| POST | /api/v1/core/sample-documents/:id/submit | permission core.sample.use | no |
| POST | /api/v1/core/sample-documents/:id/cancel | permission core.sample.use | no |
| GET | /api/v1/core/session | any authenticated user | no |
| GET | /api/v1/core/display-settings | any authenticated user | no |
| GET | /api/v1/core/company-settings | permission core.settings.view | no |
| PUT | /api/v1/core/company-settings | permission core.settings.configure | yes |
