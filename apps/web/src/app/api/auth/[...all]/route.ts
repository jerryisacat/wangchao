import { toNextJsHandler } from "better-auth/next-js";
import { getAuth } from "@/lib/auth";

function requireAuthSecret(): Response | null {
  if (!process.env.BETTER_AUTH_SECRET) {
    return new Response("Auth not configured", { status: 503 });
  }
  return null;
}

export async function GET(req: Request) {
  const early = requireAuthSecret();
  if (early) return early;
  const handler = toNextJsHandler(await getAuth());
  return handler.GET(req);
}

export async function POST(req: Request) {
  const early = requireAuthSecret();
  if (early) return early;
  const handler = toNextJsHandler(await getAuth());
  return handler.POST(req);
}
