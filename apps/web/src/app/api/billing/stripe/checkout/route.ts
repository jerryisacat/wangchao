export async function POST(request: Request) {
  try {
    if (!process.env.DATABASE_URL) {
      return Response.json(
        { ok: false, message: "数据库连接未配置。" },
        { status: 503 },
      );
    }

    const { getSessionWorkspace } = await import("@/lib/session");
    const { assertMembershipRole, getPrismaClient } =
      await import("@wangchao/db");
    const prisma = getPrismaClient();
    const workspace = await getSessionWorkspace();
    await assertMembershipRole(
      prisma,
      {
        organizationId: workspace.organizationId,
        userId: workspace.userId,
      },
      ["OWNER", "ADMIN"],
    );

    const body = (await request.json().catch(() => ({}))) as {
      plan?: string;
    };
    const plan = body.plan;
    if (plan !== "PLUS" && plan !== "PRO") {
      return Response.json(
        { ok: false, message: "无效的订阅计划，仅支持 PLUS 或 PRO。" },
        { status: 400 },
      );
    }

    if (!process.env.STRIPE_SECRET_KEY) {
      return Response.json({
        ok: false,
        message: "Stripe 支付暂未启用。请使用加密货币支付或联系管理员。",
      });
    }

    return Response.json({
      ok: false,
      message: "Stripe 集成正在开发中，暂不可用。请使用加密货币支付。",
    });
  } catch (error) {
    process.stderr.write(
      `[stripe/checkout] ${error instanceof Error ? error.message : String(error)}\n`,
    );
    return Response.json(
      { ok: false, message: "操作未完成，请稍后重试。" },
      { status: 500 },
    );
  }
}
