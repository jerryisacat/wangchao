import { Check, Sparkles } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { PLAN_REGISTRY, PLAN_ORDER, type Plan } from "@wangchao/core";

export const dynamic = "force-dynamic";

interface PlanTier {
  name: string;
  label: string;
  price: string;
  period: string;
  features: string[];
  plan: Plan;
}

function buildPlanTiers(): PlanTier[] {
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
    };
  });
}

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
  },
  ...buildPlanTiers(),
];

export default async function PricingPage() {
  const { getSessionWorkspace } = await import("@/lib/session");
  const { getPrismaClient } = await import(
    "@wangchao/db"
  );
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();

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

  return (
    <>
      <PageHeader eyebrow="订阅" title="定价方案">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">← 返回情报流</Link>
        </Button>
      </PageHeader>

      {isSelfHosted ? (
        <Card variant="work">
          <CardContent>
            <div className="flex items-center gap-3 py-8 text-center">
              <Sparkles aria-hidden="true" size={20} />
              <div>
                <h2 className="text-base font-bold">自用模式 — 所有功能已解锁</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  当前工作区已开启自用模式，跳过所有配额检查和支付流程。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="pricing-grid">
          {PLAN_TIERS.map((tier) => {
            const isCurrent = currentPlan === tier.plan;
            return (
              <Card
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
                  <div className="pricing-price">
                    <span className="pricing-price-value">{tier.price}</span>
                    <span className="pricing-price-period">{tier.period}</span>
                  </div>
                </CardHeader>
                <CardContent>
                  <ul className="pricing-features">
                    {tier.features.map((feature) => (
                      <li key={feature}>
                        <Check
                          aria-hidden="true"
                          className="text-success"
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
