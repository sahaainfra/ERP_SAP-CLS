# Commit message convention

`P<part>: <imperative summary> (module <code>)` — for example `P00.02: feature flags and regression harness (module prog)`.

- One part per commit series; a body explains why when it is not obvious.
- Deliberate golden-output changes or baseline updates say so in the subject and in `docs/erp/DECISIONS.md`.
- Never skip hooks; never commit `.env`, data files or reports.
