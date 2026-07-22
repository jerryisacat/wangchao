import { ArrowRight, Check, KeyRound, Sparkles } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBanner } from "@/components/common/status-banner";
import { getDeploymentConfiguration } from "@/lib/deployment-mode";
import { getOptionalSessionWorkspace } from "@/lib/session";
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

interface PricingContext {
  currentPlan: Plan | null;
  hasByok: boolean;
  hasWorkspace: boolean;
}

function buildPlanTiers(): PlanTier[] {
  return PLAN_ORDER.map((plan) => {
    const entry = PLAN_REGISTRY[plan];
    const isYearly = entry.pricing.yearlyPriceUsd !== null;
    const price = isYearly
      ? `$${entry.pricing.yearlyPriceUsd}`
      : `$${entry.pricing.monthlyPriceUsd}`;
    const period = plan === "FREE" ? "永久免费" : isYearly ? "/年" : "/月";
    const features: string[] = [];
    const feature = entry.features;

    features.push(feature.topics === null ? "主题不限" : `${feature.topics} 个主题`);
    features.push(feature.sources === null ? "信源不限" : `${feature.sources} 个信源`);
    features.push(feature.aiCalls);
    features.push(feature.exports === null ? "导出不限" : `每月 ${feature.exports} 次导出`);
    features.push(feature.aiSource);

    return {
      name: entry.displayName,
      label: plan === "FREE" ? "免费" : entry.displayName,
      price,
      period,
      features,
      plan,
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
  const deployment = getDeploymentConfiguration();
  const pricing = await loadPricingContext();
  const tiers = buildPlanTiers();
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const notice = readParam(resolvedSearchParams.notice);
  const isSelfHosted = deployment.mode === "self-hosted";

  return (
    <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-8 px-[max(16px,env(safe-area-inset-left))] py-10 pr-[max(16px,env(safe-area-inset-right))] sm:px-6 sm:py-16 lg:px-8">
      <header className="mx-auto grid max-w-[760px] gap-4 text-center">
        <Badge className="mx-auto" variant="secondary">简单透明的方案</Badge>
        <h1 className="text-balance text-[clamp(2.5rem,6vw,4.75rem)] font-medium leading-[0.98] tracking-[-0.045em]">
          从一个主题开始，<br />按你的关注持续生长。
        </h1>
        <p className="mx-auto max-w-[620px] text-base leading-relaxed text-muted-foreground sm:text-lg">
          免费体验核心情报闭环；需要更多主题、信源和调用时再升级。自托管版本保持开源可控。
        </p>
      </header>

      {notice ? (
        <StatusBanner
          icon={<Check aria-hidden="true" size={16} />}
          message={notice}
          tone="notice"
        />
      ) : null}

      {isSelfHosted ? (
        <Card className="mx-auto w-full max-w-[760px]" variant="work">
          <CardContent className="flex flex-col items-center gap-3 py-10 text-center sm:flex-row sm:text-left">
            <span className="grid size-12 shrink-0 place-items-center rounded-full bg-secondary text-primary">
              <Sparkles aria-hidden="true" size={22} />
            </span>
            <div className="flex-1">
              <h2 className="text-lg font-bold">自托管模式已解锁全部功能</h2>
              <p className="mt-1 text-sm leading-relaxed text-muted-foreground">
                当前部署无需订阅即可使用；你仍可在工作区设置自己的 AI 与搜索凭证。
              </p>
            </div>
            <Button asChild variant="primary">
              <Link href="/app" prefetch={false}>
                进入工作台
                <ArrowRight aria-hidden="true" size={15} />
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-5 md:grid-cols-3 md:items-stretch">
          {tiers.map((tier) => {
            const isCurrent = pricing.currentPlan === tier.plan;
            const isFeatured = tier.plan === "PLUS";
            const needsByok = tier.plan === "PLUS" && !pricing.hasByok;

            return (
              <Card
                className={
                  isFeatured
                    ? "relative ring-2 ring-primary shadow-lg md:-translate-y-3"
                    : "relative"
                }
                data-current={isCurrent ? "true" : undefined}
                key={tier.plan}
                variant="work"
              >
                {isFeatured ? (
                  <Badge className="absolute right-5 top-5" variant="default">推荐</Badge>
                ) : null}
                <CardHeader>
                  <div className="flex min-h-7 items-center gap-2">
                    <CardTitle>{tier.label}</CardTitle>
                    {isCurrent ? <Badge variant="success">当前方案</Badge> : null}
                  </div>
                  <div className="mt-3 flex items-baseline gap-1">
                    <span className="text-4xl font-medium tabular-nums tracking-tight">{tier.price}</span>
                    <span className="text-sm text-muted-foreground">{tier.period}</span>
                  </div>
                </CardHeader>
                <CardContent className="flex h-full flex-col">
                  <ul className="m-0 grid list-none gap-2.5 p-0">
                    {tier.features.map((feature) => (
                      <li className="flex items-start gap-2 text-sm leading-relaxed" key={feature}>
                        <Check aria-hidden="true" className="mt-0.5 shrink-0 text-success" size={15} />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto pt-6">
                    {isCurrent ? (
                      <Button className="w-full" disabled variant="secondary">当前方案</Button>
                    ) : !pricing.hasWorkspace ? (
                      <Button asChild className="w-full" variant={isFeatured ? "primary" : "secondary"}>
                        <Link href={`/register?next=${encodeURIComponent("/pricing")}`} prefetch={false}>
                          免费开始
                          <ArrowRight aria-hidden="true" size={15} />
                        </Link>
                      </Button>
                    ) : tier.plan === "FREE" ? (
                      <Button asChild className="w-full" variant="ghost">
                        <Link href="/usage" prefetch={false}>查看用量</Link>
                      </Button>
                    ) : needsByok ? (
                      <Button asChild className="w-full" variant="secondary">
                        <Link href="/admin/settings?byok_required=true" prefetch={false}>
                          <KeyRound aria-hidden="true" size={15} />
                          配置 BYOK 后升级
                        </Link>
                      </Button>
                    ) : (
                      <form action="/api/billing/ccpayment/create-invoice" method="POST">
                        <input name="plan" type="hidden" value={tier.plan} />
                        <Button className="w-full" type="submit" variant="primary">
                          升级到 {tier.label}
                        </Button>
                      </form>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <div className="text-center">
        <Button asChild variant="ghost">
          <Link href="/" prefetch={false}>返回产品首页</Link>
        </Button>
      </div>
    </div>
  );
}

async function loadPricingContext(): Promise<PricingContext> {
  try {
    const workspace = await getOptionalSessionWorkspace();
    if (!workspace) {
      return { currentPlan: null, hasByok: false, hasWorkspace: false };
    }

    const { getByokCredentialView, getPrismaClient } = await import("@wangchao/db");
    const prisma = getPrismaClient();
    const [byokCredential, subscription] = await Promise.all([
      getByokCredentialView(prisma, { organizationId: workspace.organizationId }),
      prisma.subscription.findUnique({
        where: { organizationId: workspace.organizationId },
        select: { plan: true },
      }),
    ]);

    return {
      currentPlan: subscription?.plan ?? "FREE",
      hasByok: byokCredential.hasKey,
      hasWorkspace: true,
    };
  } catch {
    return { currentPlan: null, hasByok: false, hasWorkspace: false };
  }
}

function readParam(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim().slice(0, 80) : "";
}
