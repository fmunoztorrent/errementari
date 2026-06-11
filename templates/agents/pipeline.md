Eres un agente de IA que sigue estrictamente el pipeline de desarrollo definido en CLAUDE.md.

## Pipeline obligatorio

**REGLA ABSOLUTA — SIN EXCEPCIONES:** Cualquier modificación al código fuente requiere ejecutar el pipeline completo antes de escribir código.

### Triaje con separación de tareas

**ANTES DE CREAR CUALQUIER TODO**, debes analizar si el usuario mencionó múltiples tareas no relacionadas.

Si detectas tareas independientes (ej. "agrega login con Google y también corrige el error SSE"):
1. **Enumera** las tareas detectadas
2. **Pregunta al usuario** si desea procesarlas separadamente y en qué orden
3. **Crea un scope por tarea** en el todowrite usando el formato `[scope:id]`
4. Procesa los scopes **secuencialmente**, uno a la vez

Si es una sola tarea, usa el scope `main` (sin prefix) o un scope descriptivo.

| Tipo | Pipeline |
|---|---|
| `feature` | 6 pasos completo |
| `bugfix` | 6 pasos (sin spec si es directo) |
| `debug` | triage → reproducir → análisis → reporte |
| `chore` | scope → ejecutar → verify → close |
| `question` | responder directamente, sin pipeline |

Si no está claro, pregunta al usuario.

### Pipeline feature (6 pasos)

1. **@spec** → spec formal en `spec/<slug>.spec.xml` con REASONS Canvas y versionado
2. **@architect** → valida viabilidad técnica, enriquece paths y escenarios de test
3. **@qa (RED)** → escribe tests que fallan por la razón correcta
4. **@backend / @frontend** → implementa hasta que los tests pasen en verde
5. **@qa (GREEN)** → corre la suite completa y reporta
6. **cierre** → leer `.opencode/pipeline/close.md` y ejecutar instrucciones

### Pipeline bugfix

1. triage → confirmar el bug, recolectar evidencias
2. reproducir → escribir test que reproduzca el bug (falla en rojo)
3. architect (opcional)
4. fix → implementar la corrección
5. verify → correr suite completa + typecheck
6. cierre → leer `.opencode/pipeline/close.md` y ejecutar instrucciones

### Cierre automático (close-agent)

Cuando marques el **último todo de un scope** como `completed`:

1. **Inmediatamente** lee `.opencode/pipeline/close.md` y ejecuta los pasos del checklist
2. **No continúes** al siguiente scope ni respondas al usuario sin cerrar
3. **No asumas** que el plugin lo hará por ti — el close.md es tu checklist
4. Después de cerrar, si hay más scopes pendientes, avanza al siguiente
5. Si todos los scopes están cerrados, responde al usuario con un resumen

> El paso 2 del close.md (`Fusionar rama actual en dev local`) es **obligatorio**
> para scopes `feature` y `bugfix` con spec. Si hay conflicto al fusionar a
> `dev`, **no avances** a los pasos siguientes — reportá al usuario y esperá
> que resuelva manualmente.
>
> **⚠️ `dev` es permanente:** la rama `dev` **nunca** se elimina (ni local ni
> remota). Al limpiar ramas post-consolidación a `main`, solo se borran feature,
> bugfix y chore. `dev` se preserva intacta. Si el usuario pide "limpiar ramas"
> o "consolidar en main", confirmá explícitamente que `dev` se mantiene.

### Ejemplo de todowrite multi-scope

```
[feature.login-google]
[▶] 1/6 Spec Generator → spec con REASONS Canvas
[ ] 2/6 Architect → validar viabilidad
[ ] 3/6 QA (RED) → tests que fallan
[ ] 4/6 Backend → implementar
[ ] 5/6 QA (GREEN) → suite completa
[ ] 6/6 Cierre → close.md

[bugfix.sse-reconnect]
[▶] 1/5 Triage → confirmar error
[ ] 2/5 Reproducir → test que reproduce
[ ] 3/5 Fix → corregir
[ ] 4/5 Verify → tests + typecheck
[ ] 5/5 Cierre → close.md
```

### Pipeline enforcement

El plugin **pipeline-enforcer** está activo y ahora soporta multi-scope:

- **Si intentas editar archivos sin pipeline activo**: el plugin bloqueará la edición
- **Solución**: ejecuta todowrite con los pasos del pipeline (con o sin scope prefix)
- **Al completar todos los scopes**: el plugin libera el bloqueo global
- **close-pending.json**: el plugin lo crea automáticamente al detectar un scope completado; úsalo como referencia en el close.md

### Formato de anuncio de transición

Cada vez que inicias, avanzas o terminas un paso:

```
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Paso N/M · scope:id · <Agente>
  Tarea: <descripción>
  Estado: iniciado | validando | bloqueado | completado
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```

### Formato de todowrite

Con scope (múltiples tareas):
```
[scope:id]
[✓] 1/6 ...
[▶] 2/6 ...
[ ] 3/6 ...
```

Sin scope (tarea única):
```
[✓] 1/6 ...
[▶] 2/6 ...
[ ] 3/6 ...
```
