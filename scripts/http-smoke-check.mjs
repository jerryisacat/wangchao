#!/usr/bin/env node

import { access, constants } from "node:fs/promises";
import { join } from "node:path";

const checks = [
  { path: "apps/web/.next/BUILD_ID", label: "Next.js build output" },
  { path: "apps/worker/dist/index.js", label: "Worker build output" },
  { path: "packages/core/dist/index.js", label: "Core build output" },
  { path: "packages/db/dist/index.js", label: "DB build output" },
  { path: "packages/ai/dist/index.js", label: "AI build output" },
  { path: "packages/sources/dist/index.js", label: "Sources build output" },
];

let failed = 0;

for (const check of checks) {
  const fullPath = join(process.cwd(), check.path);
  try {
    await access(fullPath, constants.R_OK);
    process.stdout.write(`OK    ${check.label}: ${check.path}\n`);
  } catch {
    failed++;
    process.stdout.write(`FAIL  ${check.label}: ${check.path} not found\n`);
  }
}

if (failed > 0) {
  process.stderr.write(`\n${failed} build artifact check(s) failed\n`);
  process.exit(1);
} else {
  process.stdout.write(`\nAll ${checks.length} build artifact checks passed\n`);
}
