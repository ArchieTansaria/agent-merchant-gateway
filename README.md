# AI Commerce Readiness Agent

A small first vertical slice for auditing a demo merchant catalog before it is
used in autonomous commerce. It ingests a merchant data snapshot, applies
deterministic readiness checks, and renders an explainable score dashboard.

## Run locally

```sh
npm install
npm run build
npm start
```

Open `http://localhost:4173` in a browser. The dashboard audits the included
demo data and shows every score deduction, affected entity, field, severity,
and machine-readable issue type.

## Verification

```sh
npm test
npm run typecheck
npm run build
```
