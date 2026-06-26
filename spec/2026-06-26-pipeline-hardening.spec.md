# Spec: Pipeline Hardening — fix init, add missing files, Vite conventions

**Fecha:** 2026-06-26  
**Stack inferido:** TypeScript + Node.js + Handlebars templates  
**Estado:** Draft  

---

## Contexto

Errementari v2.0.0 genera un harness en el proyecto del usuario mediante `init`. El proceso de `init` crea **wrappers** en `.opencode/pipeline/` que delegan a `node_modules/errementari/pipeline/*`. Sin embargo, `errementari` no está publicado en npm, por lo que los wrappers siempre fallan con "Plugin not installed". Además, los archivos instruccionales `.md` (`close.md`, `start.md`, `validate-empirica.md`) nunca se copian al proyecto generado. Finalmente, no se documentan convenciones para proyectos Vite (como `noEmit` y `import.meta.glob` para SSR).

Este spec aborda las 6 mejoras identificadas durante la ejecución real de un pipeline feature con Errementari.

**Ambigüedades identificadas:**
- ¿Se publica Errementari en npm (opción A3) o se mantiene solo como instalación local (A1)? Ambas. Se publica y además se robustece la instalación local.

---

## Historias de Usuario

### US-01: Archivos `.md` del pipeline se copian al proyecto `[Must]`

> Como **desarrollador usando Errementari**, quiero que `start.md`, `close.md` y `validate-empirica.md` existan en `.opencode/pipeline/` después de `init`, para que los agentes puedan leer las instrucciones del pipeline sin depender de `node_modules/errementari`.

**Criterios de aceptación:**
- [ ] `errementari init` copia `pipeline/start.md`, `pipeline/close.md`, `pipeline/validate-empirica.md` a `.opencode/pipeline/`
- [ ] Los archivos copiados son idénticos a los del source de Errementari
- [ ] `upgrade` actualiza estos archivos si no fueron modificados por el usuario
- [ ] CLAUDE.md generado referencia correctamente `.opencode/pipeline/start.md` y `.opencode/pipeline/close.md`

**Notas:** Actualmente `render.ts` solo genera wrappers `.sh`. Estos `.md` deben copiarse como archivos estáticos.

---

### US-02: `init` instala Errementari como dependencia local sin requerir npm registry `[Must]`

> Como **desarrollador usando Errementari desde un checkout local**, quiero que `errementari init` instale el plugin correctamente aunque no esté publicado en npm, para que los wrappers del pipeline funcionen.

**Criterios de aceptación:**
- [ ] `init` detecta si `errementari` está disponible en npm; si no, instala desde el path local del source
- [ ] `.opencode/package.json` referencia `errementari` con `file:` o el path correcto cuando no hay registry
- [ ] Después de `init`, `node_modules/errementari/pipeline/` existe y contiene los scripts del pipeline
- [ ] Los wrappers en `.opencode/pipeline/` ejecutan correctamente (encuentran el plugin)
- [ ] El mensaje de error cuando el plugin no está instalado sugiere `npm link` como alternativa

**Notas:** El approach A1 (copiar archivos reales) + A3 (publicar en npm) + A4 (fallback a path local) se combinan aquí. El template `opencode-package.json` debe actualizarse.

---

### US-03: Convención `noEmit` para proyectos Vite `[Should]`

> Como **desarrollador usando Errementari en un proyecto Vite**, quiero que el harness generado documente que `tsc` es solo typecheck y que `tsconfig.json` debe tener `noEmit: true`, para evitar que archivos `.js` compilados interfieran con el bundler de Vite.

**Criterios de aceptación:**
- [ ] `detect.ts` ya detecta `usesVite` — se usa esta flag en el template CLAUDE.md.hbs
- [ ] CLAUDE.md generado incluye una entrada condicional para proyectos Vite sobre `noEmit`
- [ ] La convención menciona explícitamente que `tsc -b` sin `--noEmit` genera `.js` que interfieren con Vite

**Notas:** No se modifica el `tsconfig.json` del proyecto automáticamente. Solo se documenta la convención.

---

### US-04: Detección de SSG y convención `import.meta.glob` `[Should]`

> Como **desarrollador usando Errementari en un proyecto Vite+SSG**, quiero que el harness detecte el uso de SSG (`vite-react-ssg`, `vite-plugin-ssr`, `astro`) y documente el patrón `import.meta.glob` como alternativa a `node:fs` para carga de datos.

**Criterios de aceptación:**
- [ ] `detect.ts` agrega campo `usesSSG: boolean` a `ProjectContext`
- [ ] Detecta SSG si el proyecto tiene `vite-react-ssg`, `vite-plugin-ssr`, `vite-ssg`, o `astro` en dependencias
- [ ] CLAUDE.md generado incluye entrada condicional sobre el patrón `import.meta.glob` vs `node:fs`
- [ ] La entrada menciona el guard `if (!import.meta.env.SSR)` para React Router loaders

**Notas:** Similar a US-03, solo documentación, no modifica archivos del proyecto.

---

### US-05: `coordination.json` inicial y limpieza `[Could]`

> Como **desarrollador usando Errementari**, quiero que `.opencode/pipeline/coordination.json` se cree como `{}` durante `init` para que las herramientas de coordinación no fallen al leerlo.

**Criterios de aceptación:**
- [ ] `init` crea `.opencode/pipeline/coordination.json` con contenido `{}`
- [ ] El archivo se agrega a `.errementari.json` manifest
- [ ] `upgrade` no sobrescribe si el usuario lo modificó

**Notas:** `start.md` referencia este archivo como shared session state.

---

### US-06: Mensaje de error del wrapper con instrucciones accionables `[Could]`

> Como **desarrollador cuyo `npm install --prefix .opencode` falló**, quiero que el mensaje de error de los wrappers me diga exactamente cómo instalar Errementari desde un checkout local, para poder resolver el problema sin leer el código fuente.

**Criterios de aceptación:**
- [ ] El mensaje "Plugin not installed" incluye alternativas: `npm link` + path local
- [ ] El mensaje menciona `npm install --prefix .opencode /path/to/errementari`

---

## Dependencias entre USTs

| UST | Depende de | ¿Paralelizable? |
|-----|-----------|-----------------|
| US-01 | — | sí (capa 1) |
| US-02 | — | sí (capa 1) |
| US-03 | — | sí (capa 1) |
| US-04 | — | sí (capa 1) |
| US-05 | — | sí (capa 1) |
| US-06 | — | sí (capa 1) |

---

## Escenarios BDD

```gherkin
Feature: Pipeline hardening for Errementari init

  Background:
    Given Errementari source is at a known path
    And a target project directory exists with package.json

  Scenario: init copies pipeline .md files
    When I run "errementari init /tmp/test-project -y"
    Then ".opencode/pipeline/start.md" exists
    And ".opencode/pipeline/close.md" exists
    And ".opencode/pipeline/validate-empirica.md" exists

  Scenario: init installs errementari from local path when not on npm
    Given errementari is NOT published on npm
    When I run "errementari init /tmp/test-project -y"
    Then ".opencode/node_modules/errementari" exists
    And ".opencode/node_modules/errementari/pipeline/pre-spec.sh" is executable

  Scenario: CLAUDE.md documents noEmit for Vite projects
    Given the target project has vite.config.ts
    When I run "errementari init /tmp/test-project -y"
    Then CLAUDE.md contains "noEmit" or "tsc is typecheck-only"

  Scenario: CLAUDE.md documents import.meta.glob for SSG projects
    Given the target project has vite-react-ssg in dependencies
    When I run "errementari init /tmp/test-project -y"
    Then CLAUDE.md contains "import.meta.glob"

  Scenario: init creates coordination.json
    When I run "errementari init /tmp/test-project -y"
    Then ".opencode/pipeline/coordination.json" exists with content "{}"
```

---

## Plan de Tests TDD

### US-01 — Archivos .md del pipeline

**Unitarios**
- [ ] [RED]   Test: `getTemplateMappings()` incluye mappings para start.md, close.md, validate-empirica.md
- [ ] [GREEN] Agregar mappings en `render.ts`

**Integración**
- [ ] `errementari init --dry-run` lista los archivos .md

### US-02 — Instalación local sin npm

**Unitarios**
- [ ] [RED]   Test: `init` detecta que errementari no está en npm y usa path local
- [ ] [GREEN] Implementar fallback en `init.ts`

### US-03 — Convención noEmit

**Unitarios**
- [ ] [RED]   Test: template CLAUDE.md.hbs incluye sección `noEmit` cuando `usesVite` es true
- [ ] [GREEN] Agregar bloque condicional en el template

### US-04 — Detección SSG

**Unitarios**
- [ ] [RED]   Test: `detect()` retorna `usesSSG: true` cuando `vite-react-ssg` está en deps
- [ ] [GREEN] Agregar detección en `detect.ts`

### US-05 — coordination.json

**Unitarios**
- [ ] [RED]   Test: `init` crea coordination.json con `{}`
- [ ] [GREEN] Agregar creación en `render.ts`

### US-06 — Mensaje de error

**Unitarios**
- [ ] [RED]   Test: mensaje de error del wrapper incluye "npm link" y path
- [ ] [GREEN] Actualizar `render.ts`

---

## Definition of Done

- [ ] `npm run typecheck` pasa
- [ ] `npm test` pasa
- [ ] `npm run build` completa
- [ ] `errementari init --dry-run /tmp/test-vite` muestra todos los archivos nuevos
- [ ] Los wrappers funcionan después de `init` en un proyecto real
- [ ] CHANGELOG.md actualizado con entradas para esta versión
