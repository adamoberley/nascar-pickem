import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * loader.cjs hardcodes the function names the Firebase CLI sees during
 * discovery. If it drifts from index.ts, the missing function is silently
 * skipped at deploy time with no error — so keep the two in lockstep.
 */
function readSrc(file: string): string {
  return readFileSync(join(__dirname, file), "utf8");
}

function exportedFunctionNames(): string[] {
  const source = readSrc("index.ts");
  const names: string[] = [];
  for (const block of source.matchAll(/export\s*\{([^}]*)\}\s*from/g)) {
    for (const entry of block[1].split(",")) {
      const name = entry.trim().split(/\s+as\s+/).pop()?.trim();
      if (name) names.push(name);
    }
  }
  return names;
}

function loaderFunctionNames(): string[] {
  const source = readSrc("loader.cjs");
  const list = /const FUNCTION_NAMES = \[([^\]]*)\]/.exec(source);
  if (!list) throw new Error("FUNCTION_NAMES not found in loader.cjs");
  return [...list[1].matchAll(/"([^"]+)"/g)].map((match) => match[1]);
}

describe("loader.cjs discovery list", () => {
  it("matches the functions exported from index.ts", () => {
    const exported = exportedFunctionNames();
    expect(exported.length).toBeGreaterThan(0);
    expect([...loaderFunctionNames()].sort()).toEqual([...exported].sort());
  });
});
