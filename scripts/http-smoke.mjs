#!/usr/bin/env node

import { setTimeout as sleep } from "node:timers/promises";

const baseUrl = process.env.BASE_URL;
if (!baseUrl) {
  process.stderr.write("error: BASE_URL is required (e.g. https://wangchao-web-production.up.railway.app)\n");
  process.exit(2);
}

const routes = [
  { path: "/api/health", expectStatus: 200, expectJson: true },
  { path: "/", expectStatus: 200 },
  { path: "/topics", expectStatus: 200 },
  { path: "/sources", expectStatus: 200 },
  { path: "/briefings", expectStatus: 200 },
  { path: "/saved", expectStatus: 200 },
  { path: "/preferences", expectStatus: 200 },
];

let passed = 0;
let failed = 0;
const failures = [];

for (const route of routes) {
  const url = `${baseUrl}${route.path}`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "wangchao-http-smoke" },
      redirect: "manual",
      signal: AbortSignal.timeout(10000),
    });

    if (response.status !== route.expectStatus) {
      failed++;
      failures.push(`${route.path}: expected ${route.expectStatus}, got ${response.status}`);
      process.stdout.write(`FAIL  ${route.path} → ${response.status} (expected ${route.expectStatus})\n`);
      continue;
    }

    if (route.expectJson) {
      const body = await response.json();
      if (body.status !== "ok") {
        failed++;
        failures.push(`${route.path}: health status is ${body.status}`);
        process.stdout.write(`FAIL  ${route.path} → status=${body.status}\n`);
        continue;
      }
    }

    passed++;
    process.stdout.write(`OK    ${route.path} → ${response.status}\n`);
  } catch (error) {
    failed++;
    const message = error instanceof Error ? error.message : String(error);
    failures.push(`${route.path}: ${message}`);
    process.stdout.write(`FAIL  ${route.path} → ${message}\n`);
  }
  await sleep(100);
}

process.stdout.write(`\n${passed}/${routes.length} passed, ${failed} failed\n`);

if (failures.length > 0) {
  process.stderr.write(`\nFailures:\n${failures.map((f) => `  - ${f}`).join("\n")}\n`);
  process.exit(1);
}
