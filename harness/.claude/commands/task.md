---
name: task
description: Invoca el pipeline automático para cualquier tipo de tarea (feature, bugfix, debug, chore). El agente principal clasifica y ejecuta el flujo completo con todowrite + anuncios de transición.
---

Usa este comando para que el pipeline se ejecute explícitamente:

- `/task implementar login con Google` → pipeline feature
- `/task bug: el SSE no reconecta` → pipeline bugfix
- `/task debug: typecheck falla en sse-server` → pipeline debug
- `/task cambiar LOG_LEVEL a debug en bff` → pipeline chore
- `/task qué estructura tiene el BFF` → respuesta directa sin pipeline

El agente principal clasifica la tarea, crea el todowrite con los pasos del pipeline correspondiente, anuncia cada transición de agente y ejecuta secuencialmente invocando los sub-agentes que correspondan. Si no se usa el comando, el triaje automático en CLAUDE.md también dispara el pipeline.
