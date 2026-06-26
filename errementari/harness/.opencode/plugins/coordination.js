// ─────────────────────────────────────────────────────────────────────────────
// Coordinación de sesiones Claude Code ↔ opencode (lado opencode).
//
// Comparte la lógica con el hook de Claude Code: ambos delegan en
// .opencode/pipeline/coordination.sh, que mantiene el estado en
// coordination.json y bloquea operaciones git destructivas cuando el working
// tree (compartido entre ambas herramientas) está sucio.
//
// Este plugin:
//   • registra la sesión 'opencode' al cargar y hace heartbeat en cada bash
//   • intercepta el tool `bash` y delega en `coordination.sh guard-git`
//     — si guard-git devuelve 2, lanza un Error y opencode bloquea el comando.
// ─────────────────────────────────────────────────────────────────────────────
import { spawnSync } from "child_process"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const COORD_SH = join(__dirname, "..", "pipeline", "coordination.sh")

function runCoord(args, opts = {}) {
  try {
    return spawnSync("bash", [COORD_SH, ...args], {
      encoding: "utf-8",
      timeout: 8000,
      ...opts,
    })
  } catch (e) {
    return { status: 0, stderr: "" } // nunca rompemos el flujo por fallo del helper
  }
}

export default async () => {
  // Alta de la sesión opencode (best-effort, no bloquea)
  runCoord(["register", "opencode"])

  return {
    "tool.execute.before": async (input) => {
      if (input?.tool !== "bash") return

      // Heartbeat (no bloquea)
      runCoord(["heartbeat", "opencode"])

      const command =
        input?.args?.command ?? input?.args?.cmd ?? input?.args?.script ?? ""
      if (!command) return

      const res = runCoord(["guard-git", command])
      if (res && res.status === 2) {
        throw new Error(
          (res.stderr || "").trim() ||
            "[coordination] Operación git destructiva bloqueada: el working tree compartido tiene cambios sin commitear."
        )
      }
    },
  }
}
