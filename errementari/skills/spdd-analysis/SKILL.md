---
name: spdd-analysis
description: Extracts domain keywords from business requirements, scans relevant code, and produces a strategic analysis covering domain concepts, risks, and design direction. Use before generating a REASONS Canvas for any task that modifies application code.
disable-model-invocation: false
---

# SPDD Analysis

Extract domain keywords from the requirements, scan the relevant codebase, and produce a strategic analysis.

## When to use

This is the **first SPDD step** for every feature, bugfix, or chore that touches application code. Run it before `/errementari:spdd-reasons-canvas`.

## Input

The user provides: a user story, bug report, or chore description. This can be raw text or a reference to an existing requirements file.

## Process

### 1. Extract domain keywords

Identify nouns and verbs from the requirements that represent:
- **Domain entities**: core business objects (e.g., Customer, Plan, Bill, Token)
- **Business rules**: constraints and logic (e.g., "premium users have no quota", "overage uses model-specific rates")
- **Actions**: what the system must do (e.g., "calculate bill", "apply discount")

### 2. Scan relevant code

Search the codebase for files that reference the extracted keywords. Use Grep and Glob to find:
- Existing entities/models
- Related services/use-cases
- Current API endpoints
- Pending tests

### 3. Classify concepts

| Category | Examples |
|----------|----------|
| **Existing — keep** | Concepts already implemented correctly |
| **Existing — modify** | Concepts that need changes |
| **New** | Concepts not yet in the codebase |
| **Removed** | Concepts no longer needed |

### 4. Identify risks and edge cases

- Ambiguities in requirements
- Missing acceptance criteria
- Technical risks (performance, compatibility, breaking changes)
- Edge cases not covered

## Output

Write a file at `spdd/analysis/<id>-analysis.md` with this structure:

```markdown
# [Analysis] <title>
<!-- id: <unique-id>  date: <YYYY-MM-DD> -->

## Domain Concepts

### Existing — keep
| Concept | Location | Notes |
|---------|----------|-------|

### Existing — modify
| Concept | Current location | Required change |
|---------|-----------------|-----------------|

### New
| Concept | Suggested location | Description |
|---------|-------------------|-------------|

## Business Rules
1. **Rule name**: description + where it applies

## Strategic Approach
- **Direction**: high-level solution direction
- **Design decisions**: key choices and their rationale
- **Trade-offs**: accepted compromises

## Risks & Gaps
| Risk | Severity | Mitigation |
|------|----------|------------|

## Edge Cases
1. Scenario → expected behavior

## Acceptance Criteria Coverage
| AC | Covered? | Notes |
|----|---------|-------|

## References
- Related Canvas files: `spdd/prompt/<id>-canvas.md`
- Related specs: `spec/<date>-<slug>.spec.md`
```

## Exit

- File written to `spdd/analysis/<id>-analysis.md`
- Announce: `── SPDD Analysis complete · <id> · N concepts identified · M risks flagged ──`
- Proceed to `/errementari:spdd-reasons-canvas`
