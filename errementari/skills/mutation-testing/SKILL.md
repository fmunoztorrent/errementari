---
name: mutation-testing
description: Ejecuta Stryker Mutator para validar la calidad de los tests. 
  Detecta mutantes sobrevivientes que indican tests débiles o incompletos.
  Usar durante QA FASE GREEN para decidir si avanzar a cierre o volver a RED.
---

# Mutation Testing (StrykerJS)

## Ejecución

```bash
# Todos los servicios backend
pnpm test:mutation

# Un servicio específico
cd apps/authorization-service && pnpm test:mutation
cd apps/sse-server && pnpm test:mutation
cd apps/bff && pnpm test:mutation
```

## Reportes

- **HTML**: `reports/mutation.html` en cada servicio
- **Consola**: `progress` + `clear-text` (output en terminal)

## Thresholds

| Score | Significado | Acción |
|---|---|---|
| ≥ 80% | OK | Avanzar a cierre |
| 50-79% | Warning | Reportar, no bloquear |
| < 50% | Peligro | Volver a QA RED: reforzar tests |

## Interpretación de resultados

- **Killed**: mutante detectado por al menos un test ✅
- **Survived**: ningún test detectó el mutante ❌ → tests insuficientes
- **NoCoverage**: el código mutado no tiene cobertura de tests
- **CompileError**: el mutante genera error de TypeScript → ignorado (válido)

## Contrato QA GREEN → RED

Al finalizar FASE GREEN, QA ejecuta `pnpm test:mutation`. Si el score está por debajo del threshold bajo (50), no avanza a cierre: reporta los mutantes sobrevivientes y vuelve a FASE RED para que se refuercen los tests.
