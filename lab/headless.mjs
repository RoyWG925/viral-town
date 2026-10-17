// Shared setup for every headless lab browser: be a polite neighbour on the owner's machine.
// - run at below-normal priority (the browser and its renderers inherit it on Windows)
// - only one headless browser at a time across all lab scripts (a lock file; stale after 15 min)
// - fewer raster threads for the software renderer
import { setPriority, constants, cpus } from "node:os";
import { execSync } from "node:child_process";
import { existsSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const LOCK = join("lab", ".headless.lock");

export async function politeHeadless() {
  try {
    setPriority(constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {}
  // at most half the cores: the browser and its renderers inherit this process's affinity on Windows
  try {
    const half = Math.max(1, Math.floor(cpus().length / 2));
    if (process.platform === "win32") execSync(`powershell -NoProfile -Command "(Get-Process -Id ${process.pid}).ProcessorAffinity = ${(2 ** half - 1)}"`, { stdio: "ignore" });
  } catch {}
  for (;;) {
    const stale = existsSync(LOCK) && Date.now() - statSync(LOCK).mtimeMs > 15 * 60_000;
    if (!existsSync(LOCK) || stale) {
      try {
        writeFileSync(LOCK, String(process.pid), { flag: stale ? "w" : "wx" });
        break;
      } catch {}
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  const release = () => {
    try {
      unlinkSync(LOCK);
    } catch {}
  };
  process.on("exit", release);
  process.on("SIGINT", () => (release(), process.exit(130)));
  process.on("SIGTERM", () => (release(), process.exit(143)));
}

/** extra chromium flags that keep the software renderer from taking every core */
export const LIGHT_ARGS = ["--num-raster-threads=1", "--renderer-process-limit=1", "--disable-background-timer-throttling"];
