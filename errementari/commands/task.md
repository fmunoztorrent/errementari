---
name: task
description: Invokes the automatic pipeline for any task type (feature, bugfix, debug, chore). The main agent classifies and runs the full flow with todowrite + transition announcements.
---

Use this command to run the pipeline explicitly:

- `/task implement Google login` → feature pipeline (SDD + BDD + TDD + SPDD)
- `/task bug: SSE doesn't reconnect` → bugfix pipeline (TDD + SPDD)
- `/task chore: change LOG_LEVEL in bff` → chore pipeline (SPDD if app code)
- `/task debug: typecheck fails in sse-server` → debug pipeline (read-only)
- `/task what's the BFF structure` → direct answer, no pipeline

The main agent classifies the task and creates the todowrite with the corresponding pipeline steps. For any task that modifies application code, SPDD is mandatory: spdd-analysis → spdd-reasons-canvas → spdd-generate → spdd-sync.
