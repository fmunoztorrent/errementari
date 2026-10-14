Feature: Local LLM summaries for learnings
  As a developer running gpt-oss:20b on Ollama
  I want learning summaries written by the local model
  So that skills and AGENTS.md get readable one-line summaries

  Background:
    Given a LEARNINGS.md whose last entry is for agent "backend" with slug "demo-slug"
    And the backend-learnings skill has no entry for "demo-slug"

  Scenario: Default provider keeps the heuristic and never calls the model
    Given ERRE_SUMMARY_PROVIDER is not set
    When the extraction runs
    Then no HTTP request is sent
    And "Lecciones recientes" contains the "**Lección**" line as summary

  Scenario: Ollama provider writes the model summary
    Given ERRE_SUMMARY_PROVIDER is "ollama"
    And Ollama answers with "Verificar que cada hook apunte a archivos instalados."
    When the extraction runs
    Then "Lecciones recientes" contains "Verificar que cada hook apunte a archivos instalados."

  Scenario Outline: Any model failure falls back to the heuristic
    Given ERRE_SUMMARY_PROVIDER is "ollama"
    And Ollama <failure>
    When the extraction runs
    Then "Lecciones recientes" contains the "**Lección**" line as summary
    And a warning is printed to stderr

    Examples:
      | failure                           |
      | is not running                    |
      | answers HTTP 500                  |
      | does not answer before the timeout |
      | answers with empty content        |

  Scenario: Model output is sanitized for the AGENTS.md table
    Given ERRE_SUMMARY_PROVIDER is "ollama"
    And Ollama answers with a two-line, 200-character text containing "|"
    When the extraction runs
    Then the summary is a single line of at most 120 characters without "|"

  Scenario: Remote endpoints are refused by default
    Given ERRE_SUMMARY_PROVIDER is "ollama"
    And ERRE_LLM_BASE_URL is "http://192.168.1.50:11434"
    When the extraction runs
    Then no HTTP request is sent
    And the heuristic summary is used

  Scenario: Reprocessing the same entry is a no-op
    Given the extraction already processed the last entry
    When the Stop hook runs the extraction again within the close window
    Then the model is not called
    And "demo-slug" is not promoted to "Reglas activas"

  Scenario: Generated Claude Code Stop hook goes through the pipeline CLI
    When I run "errementari init" on a new project
    Then ".claude/settings.json" has a Stop hook "node .opencode/pipeline/pipeline-cli.mjs extract-learnings"
    And that hook runs with "async": true
