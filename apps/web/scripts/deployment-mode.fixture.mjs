import {
  assertDeploymentConfiguration,
  getDeploymentConfiguration,
} from "../src/lib/deployment-mode.ts";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const selfHosted = getDeploymentConfiguration({});
assert(selfHosted.mode === "self-hosted", "Self-hosted must remain the default mode.");
assert(!selfHosted.authEnabled, "Self-hosted mode must remain usable without auth.");
assert(selfHosted.ready, "Default self-hosted configuration must remain valid.");

const authenticatedSelfHosted = getDeploymentConfiguration({
  BETTER_AUTH_SECRET: "legacy-secret",
});
assert(
  authenticatedSelfHosted.authEnabled && authenticatedSelfHosted.ready,
  "Existing self-hosted auth activation must remain backward compatible.",
);

const missingCommercialConfig = getDeploymentConfiguration({
  WANGCHAO_DEPLOYMENT_MODE: "commercial",
});
assert(missingCommercialConfig.authEnabled, "Commercial mode must fail closed.");
assert(!missingCommercialConfig.ready, "Commercial mode must require auth configuration.");
assert(
  missingCommercialConfig.issues.includes("AUTH_SECRET_MISSING") &&
    missingCommercialConfig.issues.includes("AUTH_URL_MISSING"),
  "Commercial mode must report missing secret and URL.",
);

const weakSecret = getDeploymentConfiguration({
  BETTER_AUTH_SECRET: "too-short",
  BETTER_AUTH_URL: "https://wangchao.example",
  NODE_ENV: "production",
  WANGCHAO_DEPLOYMENT_MODE: "commercial",
});
assert(
  weakSecret.issues.includes("AUTH_SECRET_TOO_SHORT"),
  "Commercial mode must reject weak auth secrets.",
);

const insecureUrl = getDeploymentConfiguration({
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://wangchao.example",
  NODE_ENV: "production",
  WANGCHAO_DEPLOYMENT_MODE: "commercial",
});
assert(
  insecureUrl.issues.includes("AUTH_URL_INSECURE"),
  "Commercial production mode must require HTTPS.",
);

const localCommercial = getDeploymentConfiguration({
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "http://127.0.0.1:3000",
  NODE_ENV: "test",
  WANGCHAO_DEPLOYMENT_MODE: "commercial",
});
assert(localCommercial.ready, "Commercial test mode must allow an HTTP loopback URL.");

const productionCommercial = assertDeploymentConfiguration({
  BETTER_AUTH_SECRET: "a".repeat(32),
  BETTER_AUTH_URL: "https://wangchao.example",
  NODE_ENV: "production",
  WANGCHAO_DEPLOYMENT_MODE: "commercial",
});
assert(
  productionCommercial.authEnabled && productionCommercial.ready,
  "Valid commercial configuration must enable auth.",
);

const invalidMode = getDeploymentConfiguration({
  WANGCHAO_DEPLOYMENT_MODE: "public",
});
assert(invalidMode.authEnabled, "Unknown deployment modes must fail closed.");
assert(
  invalidMode.issues.includes("DEPLOYMENT_MODE_INVALID"),
  "Unknown deployment modes must be rejected.",
);
