---
name: spdd-generate
description: Reads the REASONS Canvas and generates code task by task, strictly following the Operations, Norms, and Safeguards defined in the prompt. Use for every feature, bugfix, or chore that modifies application code.
disable-model-invocation: false
---

# SPDD Generate

Read the REASONS Canvas and generate code Operation by Operation.

## When to use

After `/errementari:spdd-reasons-canvas` (and architect validation for features). This replaces ad-hoc implementation with Canvas-driven code generation.

## Input

- The Canvas file: `spdd/prompt/<id>-canvas.md`
- The existing codebase
- RED tests (from QA step, for TDD cycle)

## Process

### Per Operation (O-1, O-2, ...)

1. **Read the Operation section** from the Canvas
2. **Generate code** for the specified file/method
3. **Apply Norms**: check naming, structure, error handling
4. **Verify Safeguards**: ensure no constraint is violated
5. **TDD cycle**: RED test → generate code → GREEN
6. **Commit**: one commit per Operation (atomic, revertible)

### Rules

- **No features beyond the Canvas**: do not add anything not specified in Operations
- **No improvisation**: if something is missing, stop and flag it — update the Canvas first via `/errementari:spdd-prompt-update`
- **Respect all Safeguards**: if a safeguard would be violated by the generated code, flag it immediately
- **Follow Norms**: naming conventions, file structure, error handling patterns must match exactly

### Changing logic mid-implementation

If a business rule or logic needs correction:

1. **DO NOT edit the Canvas manually**
2. Run `/errementari:spdd-prompt-update` with the correction
3. Re-run `/errementari:spdd-generate`
4. The affected Operations are regenerated; unaffected code is left untouched

**Golden rule: the Canvas leads, the code follows.**

## Exit

- All Operations implemented
- All tests GREEN
- All Safeguards verified
- Announce: `── SPDD Generate complete · O(<N>) Operations implemented · <M> tests passing ──`
- Proceed to QA GREEN (feature) or Verify (bugfix/chore)
