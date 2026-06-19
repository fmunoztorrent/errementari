#!/usr/bin/env node
import("../dist/cli.js").catch((e) => {
  if (e.code === "ERR_MODULE_NOT_FOUND") {
    console.error("Errementari is not built. Run 'npm install' (or 'npm run build') in the Errementari repo first.");
  } else {
    console.error(e);
  }
  process.exit(1);
});
