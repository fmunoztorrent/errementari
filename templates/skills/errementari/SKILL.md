---
name: errementari
description: Entry point del pipeline de desarrollo SPDD. Clasifica la tarea y delega al agente pipeline para ejecutar el flujo completo (spec → architect → QA → impl → close).
---

# errementari

Recibe la descripción de la tarea en `$ARGUMENTS` e invoca el agente `pipeline` para ejecutar el flujo completo.

## Acción

Lanza el agente `pipeline` pasándole `$ARGUMENTS` como descripción de la tarea. El agente se encarga de:

- Clasificar el tipo de tarea (feature / bugfix / debug / chore / question)
- Ejecutar el pipeline correspondiente
- Gestionar múltiples scopes si se detectan tareas independientes
