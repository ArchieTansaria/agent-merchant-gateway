# AI Commerce Readiness Agent

A demonstrable readiness-agent workflow for a merchant catalog before it is
used in autonomous commerce. It audits a cloned merchant snapshot, generates
structured correction proposals, deterministically validates them, safely
applies only approved changes, queues merchant decisions, and re-audits.

The included demo begins at 60/100. Running **AI Improvements** applies three
safe corrections and raises the real audited score to 75/100. The remaining
commercial and policy decisions stay in the merchant review queue; resolving
them through the dashboard re-audits the catalog each time.

No external LLM is configured in this hackathon slice. The proposal provider
is deterministic and intentionally constrained, but has the same proposal-only
boundary an LLM integration would use. The validator is always the authority
on whether a correction can be applied.

## Run locally

```sh
npm install
npm run build
npm start
```

Open `http://localhost:4173` in a browser. The dashboard audits the included
demo data and run the full readiness workflow. Every change records its before
and after values, reason, confidence, timestamp, and status.

## Verification

```sh
npm test
npm run typecheck
npm run build
```
