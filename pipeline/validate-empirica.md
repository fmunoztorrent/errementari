# Empirical Validation (Step 5b/7)

This step runs AFTER QA GREEN (tests + typecheck + BDD scenarios) and BEFORE Close. It only activates if the feature touches any of the areas defined below.

## Traceability: empirical checks → spec

Before running checks, map each check to a UST from the spec:

```markdown
| Check ID | UST | BDD Scenario | Expected result |
|---|---|---|---|
| A.2 | US-03 | No red screen on app load | No JS errors in logcat |
| B.2 | US-01 | Happy path: GET /api/feature | HTTP 200 + valid JSON |
```

If a check fails, reference the UST it violates in the failure report.

## Activation rule

| The feature touches... | Checks to run... |
|---|---|
| `apps/mobile/` | A (Mobile UI) |
| New `@Get|@Post|@Put|@Delete` in controllers | B (REST endpoints) |
| SSE hooks or `apps/sse-server/` | C (SSE/Real-time) |
| `package.json`, `docker-compose.yml`, `Makefile` | D (Infra/Dependencies) |

## Bootstrap (run once)

```bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
DEVICE="$(adb devices | awk '/emulator-[0-9]+[[:space:]]+device/{print $1; exit}')"
ADB="adb${DEVICE:+ -s $DEVICE}"
# Automatic container engine detection
if command -v podman-compose >/dev/null 2>&1; then
  COMPOSE="podman-compose"
elif command -v podman >/dev/null 2>&1; then
  COMPOSE="podman compose"
else
  COMPOSE="docker compose"
fi
```

## A — Mobile UI

| Check | What it validates | Command | Failure signal |
|---|---|---|---|
| **A.1** Android build | APK compiles without Gradle errors | `cd apps/mobile && pnpm android` | `BUILD FAILED` |
| **A.2** No red screen | App loads without fatal JS errors | `adb logcat -d \| grep ReactNativeJS \| grep -v INFO \| grep -v "Running"` | `TypeError`, `Invariant Violation` |
| **A.3** UI elements | New components render | `uiautomator dump` → grep testID/text from the spec | Element missing from the dump |
| **A.4** SSE flow | SSE events reach the UI | `pnpm inject` → `sleep 5` → `uiautomator dump` → badge/card updated | Element does not appear after inject |
| **A.5** No regressions | Previous views intact | `uiautomator dump` → look for known cards, spinner | Previous elements broken/missing |

### Procedure A

```bash
# A.1 Build
cd $REPO_ROOT/apps/mobile && pnpm android
# Expected: BUILD SUCCESSFUL

# A.2 No red screen
$ADB logcat -d | grep ReactNativeJS | grep -v INFO | grep -v "Running"
# Expected: no output

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
# Verify the testIDs/texts from the spec appear

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

## B — REST endpoints

| Check | What it validates | Command | Failure signal |
|---|---|---|---|
| **B.1** Rebuild + restart | Compiled code is up to date | `nest build` + `pkill` + `node dist/main &` | `RoutesResolver` does not show the new route |
| **B.2** Happy path | Endpoint responds 2xx | `curl -s -o /dev/null -w "%{http_code}" <url>` | Not 200/201 |
| **B.3** Response schema | Correct structure | `curl -s <url> \| jq 'type'` | Not `"array"`/`"object"` |
| **B.4** Error handling | Invalid input → 4xx | `curl -s -o /dev/null -w "%{http_code}" <url>?bad=1` | 500 instead of 400/404 |
| **B.5** BFF proxy | BFF forwards correctly | `diff <(curl -s <bff_url>) <(curl -s <auth_svc_url>)` | Different responses |

### Procedure B

```bash
# B.1 Rebuild + restart for each modified service
SVC="authorization-service"  # or bff, sse-server
cd $REPO_ROOT/apps/$SVC
rm -f tsconfig*.tsbuildinfo
node_modules/.bin/nest build
pkill -f "node dist/main" 2>/dev/null
sleep 1
node dist/main > /tmp/$SVC.log 2>&1 &
sleep 3
# Verify the route is mapped
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

| Check | What it validates | Command | Failure signal |
|---|---|---|---|
| **C.1** Inject → arrival | Message → SSE → UI in <5s | `pnpm inject` → `uiautomator dump` | Element not visible after 5s |
| **C.2** Kafka LAG | Consumer group up to date | `kafka-consumer-groups --describe` | Persistent `LAG > 0` |
| **C.3** Reconnect | SSE reconnects after a cut | Kill BFF → restart → check banner | "Reconnecting..." never disappears |

## D — Infra / Dependencies

| Check | What it validates | Command | Failure signal |
|---|---|---|---|
| **D.1** Native compat | Dependency compatible with Kotlin | `grep kotlinVersion android/build.gradle` vs dep | Minimum version > project version |
| **D.2** Container health | Containers healthy | `$COMPOSE ps` | `exited`, `unhealthy` |
| **D.3** Port binding | No port conflicts | `lsof -i :3000 -i :3001 -i :3002 -P \| grep LISTEN` | Fewer than 3 LISTEN ports |

## Failure cycle

```
CHECK FAILS → go back to 3/6 QA RED
     The QA agent receives: the exact output of the failed check
     as the specification of the bug to reproduce

ALL CHECKS OK → 6/6 Close
```

## Report format

```
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Step 5b/6 · Empirical Validation
  Type: [A] Mobile UI + [B] REST endpoints
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─

[✓] A.1 Android build           BUILD SUCCESSFUL in 19s
[✓] A.2 No red screen           INFO lines only
[✓] A.3 UI elements             all testIDs present
[✓] B.1 Rebuild + restart       RoutesResolver shows the new route
[✓] B.2 Happy path              HTTP 200

── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
  Empirical Validation: 5/5 ✓
── ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
```
