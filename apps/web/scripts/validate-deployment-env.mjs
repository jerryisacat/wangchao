import { getDeploymentConfiguration } from "../src/lib/deployment-mode.ts";

const configuration = getDeploymentConfiguration(process.env);

if (!configuration.ready) {
  process.stderr.write(
    `Deployment configuration invalid: ${configuration.issues.join(", ")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(
    `Deployment configuration valid: mode=${configuration.mode}, auth=${configuration.authEnabled ? "enabled" : "disabled"}\n`,
  );
}
