import { Check, Sparkles } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";

export const dynamic = "force-dynamic";

interface PlanTier {
  name: string;
  label: string;
  price: string;
  period: string;
  features: string[];
  plan: "FREE" | "PLUS" | "PRO";
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
  {
    name: "Plus",
    label: "Plus",
    period: "/年",
    price: "$9.99",
    plan: "PLUS",
    features: [
      "5 个主题",
      "25 个信源",
      "AI 调用不限（自费 BYOK）",
      "每月 50 次导出",
      "BYOK 必填",
    ],
  },
  {
    name: "Pro",
    label: "Pro",
    period: "/月",
    price: "$19.99",
    plan: "PRO",
    features: [
      "主题不限",
      "信源不限",
      "每月 20,000 次官方 AI 调用",
      "导出不限",
      "官方 AI + BYOK 备援",
    ],
  },
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
