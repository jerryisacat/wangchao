import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";
import { getDeploymentConfiguration } from "@/lib/deployment-mode";

function requireAuthConfiguration(): Response | null {
  const configuration = getDeploymentConfiguration();
  if (!configuration.authEnabled || !configuration.ready) {
    return new Response("Auth not configured", { status: 503 });
  }
  return null;
}

export async function GET(req: Request) {
  const early = requireAuthConfiguration();
  if (early) return early;
  const handler = toNextJsHandler(await getAuth());
  return handler.GET(req);
}

export async function POST(req: Request) {
  const early = requireAuthConfiguration();
  if (early) return early;
  const handler = toNextJsHandler(await getAuth());
  return handler.POST(req);
}
