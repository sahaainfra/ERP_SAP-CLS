# ERP_SAP CLS

Construction ERP built part by part from the prompt pack (see `docs/erp/PROGRESS.csv`).

## Run it
```
npm install
copy .env.example .env      (cp on macOS/Linux)
npm run build
npm start                   # http://localhost:3000, database created and migrated on start-up
```
Development with hot reload: `npm run dev` (API on 3000, Vite on 5173).
In development the page has a "Development identity" bar (role SYSADM, ITADM or PM, and company). It is a stand-in for sign-in until the IAM module exists.

## Check it
`npm run erp:regression` runs lint, type check, unit and API tests, schema-diff, golden outputs, a client build and the Playwright E2E suite (uses the installed Chrome; set `PW_CHANNEL=msedge` for Edge). Reports: `reports/regression/report.html`.
Single steps: `npm test`, `npm run test:e2e`, `npm run erp:schema-diff`, `npm run erp:golden`.

## Documents
`docs/erp/` holds the standards, decisions, defects, DB changes, discovery catalogues (`npm run erp:discover`, needs Python) and a completion report per part.
