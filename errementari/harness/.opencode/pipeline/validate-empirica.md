# Validación Empírica (Paso 5b/6)

Este paso se ejecuta DESPUÉS de QA GREEN (tests + typecheck) y ANTES de Cierre. Solo se activa si la feature toca alguna de las áreas definidas abajo.

## Regla de activación

| La feature toca... | Se ejecutan checks tipo... |
|---|---|
| `apps/mobile/` | A (Mobile UI) |
| Nuevos `@Get|@Post|@Put|@Delete` en controllers | B (Endpoints REST) |
| Hooks SSE o `apps/sse-server/` | C (SSE/Real-time) |
| `package.json`, `docker-compose.yml`, `Makefile` | D (Infra/Dependencias) |

## Bootstrap (ejecutar una vez)

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
DEVICE="$(adb devices | awk '/emulator-[0-9]+[[:space:]]+device/{print $1; exit}')"
ADB="adb${DEVICE:+ -s $DEVICE}"
# Detección automática del motor de contenedores
if command -v podman-compose >/dev/null 2>&1; then
  COMPOSE="podman-compose"
elif command -v podman >/dev/null 2>&1; then
  COMPOSE="podman compose"
else
  COMPOSE="docker compose"
fi
```

## A — Mobile UI

| Check | Qué valida | Comando | Señal de fallo |
|---|---|---|---|
| **A.1** Build Android | APK compila sin errores Gradle | `cd apps/mobile && pnpm android` | `BUILD FAILED` |
| **A.2** No red screen | App carga sin errores JS fatales | `adb logcat -d \| grep ReactNativeJS \| grep -v INFO \| grep -v "Running"` | `TypeError`, `Invariant Violation` |
| **A.3** UI elements | Nuevos componentes renderizan | `uiautomator dump` → grep testID/text del spec | Elemento ausente en el dump |
| **A.4** SSE flow | Eventos SSE llegan a la UI | `pnpm inject` → `sleep 5` → `uiautomator dump` → badge/card actualizado | Elemento no aparece tras inject |
| **A.5** No regressions | Vistas previas intactas | `uiautomator dump` → buscar "Solicitudes", cards, spinner | Elementos previos rotos/ausentes |

### Procedimiento A

```bash
# A.1 Build
cd $REPO_ROOT/apps/mobile && pnpm android
# Esperado: BUILD SUCCESSFUL

# A.2 No red screen
$ADB logcat -d | grep ReactNativeJS | grep -v INFO | grep -v "Running"
# Esperado: sin output

# A.3 UI elements
$ADB shell uiautomator dump /sdcard/ui.xml && $ADB pull /sdcard/ui.xml /tmp/ui.xml
python3 -c "
import xml.etree.ElementTree as ET
tree = ET.parse('/tmp/ui.xml')
for n in tree.iter():
    text = n.get('text', '')
    desc = n.get('content-desc', '')
    if text or desc:
        print(f'{desc} | {text}')
"
# Verificar que los testID/text del spec aparecen

# A.4 SSE flow
cd $REPO_ROOT && pnpm inject --type DISCOUNT --store-id store-1 --pos-id test-validation
sleep 5
$ADB shell uiautomator dump /sdcard/ui.xml && $ADB pull /sdcard/ui.xml /tmp/ui.xml
python3 -c "
import xml.etree.ElementTree as ET
tree = ET.parse('/tmp/ui.xml')
for n in tree.iter():
    text = n.get('text', '')
    if 'test-validation' in text:
        print(f'SSE OK: card visible for test-validation')
        break
else:
    print('SSE FAIL: card not found')
"

# A.5 No regressions
python3 -c "
import xml.etree.ElementTree as ET
tree = ET.parse('/tmp/ui.xml')
texts = [n.get('text','') for n in tree.iter()]
checks = ['Solicitudes', '☰']
for c in checks:
    found = any(c in t for t in texts)
    print(f'{'✅' if found else '❌'} {c}')
"
```

## B — Endpoints REST

| Check | Qué valida | Comando | Señal de fallo |
|---|---|---|---|
| **B.1** Rebuild + restart | Código compilado está actualizado | `nest build` + `pkill` + `node dist/main &` | `RoutesResolver` no muestra nueva ruta |
| **B.2** Happy path | Endpoint responde 2xx | `curl -s -o /dev/null -w "%{http_code}" <url>` | No es 200/201 |
| **B.3** Response schema | Estructura correcta | `curl -s <url> \| jq 'type'` | No es `"array"`/`"object"` |
| **B.4** Error handling | Input inválido → 4xx | `curl -s -o /dev/null -w "%{http_code}" <url>?bad=1` | 500 en vez de 400/404 |
| **B.5** BFF proxy | BFF forwardea correctamente | `diff <(curl -s <bff_url>) <(curl -s <auth_svc_url>)` | Respuestas diferentes |

### Procedimiento B

```bash
# B.1 Rebuild + restart para cada servicio modificado
SVC="authorization-service"  # o bff, sse-server
cd $REPO_ROOT/apps/$SVC
rm -f tsconfig*.tsbuildinfo
node_modules/.bin/nest build
pkill -f "node dist/main" 2>/dev/null
sleep 1
node dist/main > /tmp/$SVC.log 2>&1 &
sleep 3
# Verificar ruta mapeada
grep "Mapped.*<ROUTE>" /tmp/$SVC.log

# B.2 Happy path
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "<URL>")
if [ "$HTTP_CODE" -lt 200 ] || [ "$HTTP_CODE" -ge 300 ]; then
  echo "FAIL: HTTP $HTTP_CODE"
fi

# B.3 Response schema
TYPE=$(curl -s "<URL>" | jq 'type')
if [ "$TYPE" != '"array"' ]; then
  echo "FAIL: expected array, got $TYPE"
fi
```

## C — SSE / Real-time

| Check | Qué valida | Comando | Señal de fallo |
|---|---|---|---|
| **C.1** Inject → arrival | Mensaje → SSE → UI en <5s | `pnpm inject` → `uiautomator dump` | Elemento no visible tras 5s |
| **C.2** Kafka LAG | Consumer group al día | `kafka-consumer-groups --describe` | `LAG > 0` persistente |
| **C.3** Reconnect | SSE reconecta tras corte | Kill BFF → restart → verificar banner | "Reconectando..." no desaparece |

## D — Infra / Dependencias

| Check | Qué valida | Comando | Señal de fallo |
|---|---|---|---|
| **D.1** Native compat | Dependencia compatible con Kotlin | `grep kotlinVersion android/build.gradle` vs dep | Versión mínima > versión proyecto |
| **D.2** Container health | Contenedores healthy | `$COMPOSE ps` | `exited`, `unhealthy` |
| **D.3** Port binding | Sin conflictos de puertos | `lsof -i :3000 -i :3001 -i :3002 -P \| grep LISTEN` | Menos de 3 puertos LISTEN |

## Ciclo de fallo

```
CHECK FALLA → volver a 3/6 QA RED
     Se entrega al agente QA: el output exacto del check fallido
     como especificación del bug a reproducir

TODOS CHECKS OK → 6/6 Cierre
```

## Formato de reporte

```
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Paso 5b/6 · Validación Empírica
  Tipo: [A] Mobile UI + [B] Endpoints REST
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

[✓] A.1 Build Android           BUILD SUCCESSFUL in 19s
[✓] A.2 No red screen           solo líneas INFO
[✓] A.3 UI elements              todos los testID presentes
[✓] B.1 Rebuild + restart       RoutesResolver muestra nueva ruta
[✓] B.2 Happy path              HTTP 200

── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Validación Empírica: 5/5 ✓
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```
