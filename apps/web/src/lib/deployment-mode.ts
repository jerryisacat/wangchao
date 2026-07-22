export type DeploymentMode = "commercial" | "self-hosted";

export type DeploymentConfigurationIssue =
  | "AUTH_SECRET_MISSING"
  | "AUTH_SECRET_TOO_SHORT"
  | "AUTH_URL_INSECURE"
  | "AUTH_URL_INVALID"
  | "AUTH_URL_MISSING"
  | "DEPLOYMENT_MODE_INVALID";

interface DeploymentEnvironment {
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  NODE_ENV?: string;
  WANGCHAO_DEPLOYMENT_MODE?: string;
}

export interface DeploymentConfiguration {
  authEnabled: boolean;
  issues: DeploymentConfigurationIssue[];
  mode: DeploymentMode | null;
  ready: boolean;
}

const MIN_COMMERCIAL_AUTH_SECRET_LENGTH = 32;

export function getDeploymentConfiguration(
  environment: DeploymentEnvironment = process.env,
): DeploymentConfiguration {
  const rawMode = environment.WANGCHAO_DEPLOYMENT_MODE?.trim() || "self-hosted";
  const mode = isDeploymentMode(rawMode) ? rawMode : null;
  const secret = environment.BETTER_AUTH_SECRET?.trim() ?? "";
  const authEnabled = mode !== "self-hosted" || secret.length > 0;
  const issues: DeploymentConfigurationIssue[] = [];

  if (!mode) {
    issues.push("DEPLOYMENT_MODE_INVALID");
  }

  if (mode === "commercial") {
    if (!secret) {
      issues.push("AUTH_SECRET_MISSING");
    } else if (secret.length < MIN_COMMERCIAL_AUTH_SECRET_LENGTH) {
      issues.push("AUTH_SECRET_TOO_SHORT");
    }

    issues.push(...validateCommercialAuthUrl(environment));
  }

  return {
    authEnabled,
    issues,
    mode,
    ready: issues.length === 0,
  };
}

export function assertDeploymentConfiguration(
  environment: DeploymentEnvironment = process.env,
): DeploymentConfiguration {
  const configuration = getDeploymentConfiguration(environment);
  if (!configuration.ready) {
    throw new Error(`DEPLOYMENT_CONFIGURATION_INVALID:${configuration.issues.join(",")}`);
  }
  return configuration;
}

function isDeploymentMode(value: string): value is DeploymentMode {
  return value === "commercial" || value === "self-hosted";
}

function validateCommercialAuthUrl(
  environment: DeploymentEnvironment,
): DeploymentConfigurationIssue[] {
  const rawUrl = environment.BETTER_AUTH_URL?.trim();
  if (!rawUrl) return ["AUTH_URL_MISSING"];

  try {
    const url = new URL(rawUrl);
    const isLocalDevelopmentUrl =
      environment.NODE_ENV !== "production" &&
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");

    if (url.protocol !== "https:" && !isLocalDevelopmentUrl) {
      return ["AUTH_URL_INSECURE"];
    }
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== "" && url.pathname !== "/")
    ) {
      return ["AUTH_URL_INVALID"];
    }
    return [];
  } catch {
    return ["AUTH_URL_INVALID"];
  }
}
