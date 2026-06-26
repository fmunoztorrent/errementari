import { resolve } from "path";
import { readManifest } from "../render.js";

export function statusCommand(targetDir?: string) {
  const target = targetDir ? resolve(targetDir) : process.cwd();

  const manifest = readManifest(target);

  if (!manifest) {
    console.log("No Errementari harness found in this project.");
    console.log("Run 'errementari init' to install.");
    return;
  }

  console.log("");
  console.log("═══════════════════════════════════════════");
  console.log("  Errementari Status");
  console.log("═══════════════════════════════════════════");
  console.log("");
  console.log(`  Version:    v${manifest.version}`);
  console.log(`  Installed:  ${manifest.installed_at}`);
  console.log(`  Total files: ${Object.keys(manifest.files).length}`);
  console.log("");

  const count = (type: string) =>
    Object.values(manifest.files).filter((e) => e.type === type).length;

  console.log(`  Generic:    ${count("generic")} files (pipeline scripts, plugins)`);
  console.log(`  Templates:  ${count("template")} files (rendered from .hbs)`);
  console.log(`  Static:     ${count("static")} files (copied as-is, e.g. agent defs)`);
  console.log(`  Stubs:      ${count("stub")} files (starter files, yours after install)`);
  console.log("");
  console.log("  Manifest: .errementari.json");
  console.log("");
}
