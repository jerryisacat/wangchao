import { Check, KeyRound, Sparkles } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { PLAN_REGISTRY, PLAN_ORDER, type Plan } from "@wangchao/core";

export const dynamic = "force-dynamic";

interface PlanTier {
  name: string;
  label: string;
  price: string;
  period: string;
  features: string[];
  plan: Plan;
  requiresByok: boolean;
}

function buildPlanTiers(hasByok: boolean): PlanTier[] {
  return PLAN_ORDER.filter((plan) => plan !== "FREE").map((plan) => {
    const entry = PLAN_REGISTRY[plan];
    const isYearly = entry.pricing.yearlyPriceUsd !== null;
    const price = isYearly
      ? `$${entry.pricing.yearlyPriceUsd}`
      : `$${entry.pricing.monthlyPriceUsd}`;
    const period = isYearly ? "/年" : "/月";
    const f = entry.features;
    const features: string[] = [];
    if (f.topics !== null) features.push(`${f.topics} 个主题`);
    else features.push("主题不限");
    if (f.sources !== null) features.push(`${f.sources} 个信源`);
    else features.push("信源不限");
    features.push(f.aiCalls);
    if (f.exports !== null) features.push(`每月 ${f.exports} 次导出`);
    else features.push("导出不限");
    features.push(f.aiSource);
    return {
      name: entry.displayName,
      label: entry.displayName,
      price,
      period,
      features,
      plan,
      requiresByok: plan === "PLUS" && !hasByok,
    };
  });
}

export default async function PricingPage({
  searchParams,
}: {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}) {
  const { getSessionWorkspace } = await import("@/lib/session");
  const { getByokCredentialView, getPrismaClient } = await import(
    "@wangchao/db"
  );
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();

  const byokCredential = await getByokCredentialView(prisma, {
    organizationId: workspace.organizationId,
  });

  const PLAN_TIERS: PlanTier[] = [
    {
      name: "Free",
      label: "免费",
      period: "永久免费",
      price: "$0",
      plan: "FREE",
      features: [
        "1 个主题",
        "3 个信源",
        "每天 100 次官方 AI 调用",
        "每月 10 次导出",
        "官方 AI 来源",
      ],
      requiresByok: false,
    },
    ...buildPlanTiers(byokCredential.hasKey),
  ];

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: workspace.organizationId },
    select: {
      plan: true,
      status: true,
      isSelfHosted: true,
    },
  });

  const currentPlan = subscription?.plan ?? "FREE";
  const isSelfHosted = subscription?.isSelfHosted ?? false;

  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const notice = readParam(resolvedSearchParams.notice);

  return (
    <>
      <PageHeader eyebrow="订阅" title="定价方案">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">← 返回情报流</Link>
        </Button>
      </PageHeader>

      {notice ? (
        <StatusBanner
          icon={<Check aria-hidden="true" size={16} />}
          message={notice}
          tone="notice"
        />
      ) : null}

      {isSelfHosted ? (
        <Card variant="work">
          <CardContent>
            <div className="flex items-center gap-3 py-8 text-center">
              <Sparkles aria-hidden="true" size={20} />
              <div>
                <h2 className="text-base font-bold">自用模式 - 所有功能已解锁</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  当前工作区已开启自用模式，跳过所有配额检查和支付流程。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
          {PLAN_TIERS.map((tier) => {
            const isCurrent = currentPlan === tier.plan;
            const isFeatured = tier.plan === "PLUS";
            return (
              <Card
                className={isFeatured ? "md:-translate-y-4 ring-2 ring-primary shadow-lg" : undefined}
                data-current={isCurrent ? "true" : undefined}
                key={tier.plan}
                variant="work"
              >
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>
                      <span className="inline-flex items-center gap-2">
                        {tier.label}
                      </span>
                    </CardTitle>
                    {isCurrent ? (
                      <Badge variant="success">当前方案</Badge>
                    ) : null}
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-3xl font-medium tabular-nums">{tier.price}</span>
                    <span className="text-sm text-muted-foreground">{tier.period}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="grid gap-2 p-0 m-0 list-none">
                    {tier.features.map((feature) => (
                      <li
                        className="flex items-start gap-2 text-sm leading-relaxed"
                        key={feature}
                      >
                        <Check
                          aria-hidden="true"
                          className="mt-0.5 shrink-0 text-success"
                          size={14}
                        />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  {isCurrent ? (
                    <Button
                      className="mt-4 w-full"
                      disabled
                      size="sm"
                      variant="secondary"
                    >
                      当前方案
                    </Button>
                  ) : tier.plan === "FREE" ? (
                    <Button
                      asChild
                      className="mt-4 w-full"
                      size="sm"
                      variant="ghost"
                    >
                      <Link href="/usage">查看用量</Link>
                    </Button>
                  ) : tier.requiresByok ? (
                    <div className="mt-4">
                      <Button
                        asChild
                        className="w-full"
                        size="sm"
                        variant="secondary"
                      >
                        <Link href="/admin/settings?byok_required=true">
                          <KeyRound aria-hidden="true" size={14} />
                          配置 BYOK 后升级
                        </Link>
                      </Button>
                      <p className="mt-2 text-xs text-muted-foreground">
                        Plus 计划需先配置 BYOK 才能升级。
                      </p>
                    </div>
                  ) : (
                    <form
                      action="/api/billing/ccpayment/create-invoice"
                      className="mt-4"
                      method="POST"
                    >
                      <input type="hidden" name="plan" value={tier.plan} />
                      <Button
                        className="w-full"
                        size="sm"
                        type="submit"
                        variant="primary"
                      >
                        升级到 {tier.label}
                      </Button>
                    </form>
                  )}
                </CardContent>
               </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function readParam(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim().slice(0, 80) : "";
}
