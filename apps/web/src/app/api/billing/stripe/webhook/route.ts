export async function POST() {
  return Response.json(
    { ok: false, message: "Stripe webhook not configured" },
    { status: 501 },
  );
}
