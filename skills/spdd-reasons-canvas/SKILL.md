---
name: spdd-reasons-canvas
description: Generates the full REASONS Canvas — a 7-part structured prompt (Requirements, Entities, Approach, Structure, Operations, Norms, Safeguards) that serves as the single source of truth for code generation. Use after spdd-analysis.
disable-model-invocation: false
---

# SPDD REASONS Canvas

Generate the 7-part structured prompt that guides all subsequent code generation.

## When to use

After `/errementari:spdd-analysis` for every feature, bugfix, or chore that modifies application code. The Canvas is the **single source of truth** — code is generated FROM it, and refactors sync BACK to it.

## Input

- The analysis file: `spdd/analysis/<id>-analysis.md`
- The current codebase context (entities, existing patterns, conventions)
- BDD scenarios (.feature files) if already generated

## The 7-part canvas

Generate a file at `spdd/prompt/<id>-canvas.md`:

```markdown
# [Feat|Fix|Chore] <title>
<!-- canvas-id: <unique-id>  date: <YYYY-MM-DD>  status: draft -->

---

## R — Requirements

### Problem
<What problem are we solving?>

### Definition of Done
- [ ] Criterion 1
- [ ] Criterion 2

### Scope In
- What IS included

### Scope Out
- What is NOT included (deferred, out of scope)

---

## E — Entities

### Domain Model
| Entity | Attributes | Relationships |
|--------|-----------|---------------|

### State Transitions
```
[State A] ──(action)──▶ [State B]
```

### Business Invariants
1. Invariant — must always hold

---

## A — Approach

### Strategy
<High-level solution strategy>

### Design Decisions
| Decision | Rationale | Alternatives considered |
|----------|----------|------------------------|

### Patterns
- Pattern 1: where + why (e.g., Strategy pattern for billing plans)

---

## S — Structure

### Files to create
| File | Purpose | Depends on |
|------|---------|------------|

### Files to modify
| File | Change | Reason |
|------|--------|--------|

### Component Diagram
```
[API Controller]
    │
    ├──▶ [Service Layer]
    │        │
    │        ├──▶ [Domain Entity]
    │        └──▶ [Repository Interface]
    │
    └──▶ [DTO / Validation]
```

---

## O — Operations

<Concrete, testable implementation steps. One subsection per operation.>

### O-1: <Operation name>
- **File**: `<path/to/file.ts>`
- **Method**: `<method signature>`
- **Steps**:
  1. step description
  2. step description
- **Expected result**: <what should happen>
- **Error cases**: <what errors to handle>

### O-2: <Operation name>
...

---

## N — Norms

### Code conventions
- Naming: <conventions>
- File structure: <conventions>
- Error handling: <conventions>

### Testing norms
- 1 test per Operation
- RED → GREEN → REFACTOR
- Mutation score target: >= 80%

### Observable patterns
- Logging: <format, levels>
- Metrics: <what to track>

---

## S — Safeguards

### Non-negotiable constraints
1. Constraint — must never be violated

### Performance boundaries
- Max response time: <N>ms
- Max memory: <N>MB

### Security rules
- Input validation: <rules>
- Authorization: <rules>

### Breaking change prevention
- Backward compatibility: <what must be preserved>
- Migration path: <if applicable>
```

## Rules

1. **Operations must be precise**: method signatures, parameter types, expected results
2. **Norms are cross-cutting**: they apply to ALL Operations
3. **Safeguards are non-negotiable**: code that violates them must be rejected
4. **The Canvas is VERSIONED in git** — never edit manually, always use spdd-prompt-update

## Exit

- File written to `spdd/prompt/<id>-canvas.md`
- Announce: `── REASONS Canvas complete · <id> · 7 sections · O(<N> operations) ──`
- Proceed to architect validation (feature) or generate (bugfix/chore)
