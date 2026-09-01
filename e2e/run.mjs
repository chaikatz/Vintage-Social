// Serve the exported web build, run the launch test against it, shut down.
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

// Playwright is deliberately NOT a dependency of this project: it pulls a
// browser download that everyone installing the app would pay for, to run
// a harness only a maintainer runs. Install it when you need it.
try {
  createRequire(import.meta.url).resolve("playwright");
} catch {
  console.error(
    "The launch test needs Playwright, which this project does not depend on.\n" +
      "  npm i -D playwright && npx playwright install chromium\n",
  );
  process.exit(1);
}

if (!existsSync(new URL("../dist/index.html", import.meta.url))) {
  console.error("No web build found. Run `npm run build:web` first.");
  process.exit(1);
}

const server = spawn(process.execPath, [new URL("serve.mjs", import.meta.url).pathname], {
  stdio: ["ignore", "inherit", "inherit"],
});
const stop = () => server.kill();
process.on("exit", stop);

await new Promise((r) => setTimeout(r, 1500));
const test = spawn(process.execPath, [new URL("launch-test.mjs", import.meta.url).pathname], {
  stdio: "inherit",
  env: { ...process.env, SHOT_DIR: process.env.SHOT_DIR ?? "/tmp/vintage-launch-shots" },
});
test.on("exit", (code) => {
  stop();
  process.exit(code ?? 1);
});
