import { Activity, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { PLAN_REGISTRY, type Plan as CorePlan } from "@wangchao/core";

export const dynamic = "force-dynamic";

interface PlanLimits {
  aiCallsDaily: number | null;
  aiCallsMonthly: number | null;
  exportsMonthly: number | null;
  topics: number | null;
  sources: number | null;
  label: string;
  badge: "muted" | "default" | "accent";
}

const PLAN_LIMITS: Record<"FREE" | "PLUS" | "PRO", PlanLimits> = {
  FREE: {
    aiCallsDaily: PLAN_REGISTRY.FREE.limits.maxAiCallsPerDay,
    aiCallsMonthly: PLAN_REGISTRY.FREE.limits.maxAiCallsPerMonth,
    exportsMonthly: PLAN_REGISTRY.FREE.limits.maxExportsPerMonth,
    topics: PLAN_REGISTRY.FREE.limits.maxTopics,
    sources: PLAN_REGISTRY.FREE.limits.maxSources,
    label: PLAN_REGISTRY.FREE.displayName,
    badge: "muted",
  },
  PLUS: {
    aiCallsDaily: PLAN_REGISTRY.PLUS.limits.maxAiCallsPerDay,
    aiCallsMonthly: PLAN_REGISTRY.PLUS.limits.maxAiCallsPerMonth,
    exportsMonthly: PLAN_REGISTRY.PLUS.limits.maxExportsPerMonth,
    topics: PLAN_REGISTRY.PLUS.limits.maxTopics,
    sources: PLAN_REGISTRY.PLUS.limits.maxSources,
    label: PLAN_REGISTRY.PLUS.displayName,
    badge: "default",
  },
  PRO: {
    aiCallsDaily: PLAN_REGISTRY.PRO.limits.maxAiCallsPerDay,
    aiCallsMonthly: PLAN_REGISTRY.PRO.limits.maxAiCallsPerMonth,
    exportsMonthly: PLAN_REGISTRY.PRO.limits.maxExportsPerMonth,
    topics: PLAN_REGISTRY.PRO.limits.maxTopics,
    sources: PLAN_REGISTRY.PRO.limits.maxSources,
    label: PLAN_REGISTRY.PRO.displayName,
    badge: "accent",
  },
};

type Plan = CorePlan;

export default async function UsagePage() {
  const { getSessionWorkspace } = await import("@/lib/session");
  const {
    getPrismaClient,
    listUsageSummary,
  } = await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();

  const subscription = await prisma.subscription.findUnique({
    where: { organizationId: workspace.organizationId },
    select: {
      plan: true,
      isSelfHosted: true,
    },
  });

  const plan = subscription?.plan ?? "FREE";
  const isSelfHosted = subscription?.isSelfHosted ?? false;
  const limits = PLAN_LIMITS[plan];

  const now = new Date();
  const startOfDay = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate(),
  );
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [todaySummary, monthSummary, topicCount, sourceCount] =
    await Promise.all([
      listUsageSummary(prisma, { organizationId: workspace.organizationId }, startOfDay),
      listUsageSummary(prisma, { organizationId: workspace.organizationId }, startOfMonth),
      prisma.topic.count({
        where: {
          organizationId: workspace.organizationId,
          status: { not: "ARCHIVED" },
        },
      }),
      prisma.source.count({
        where: {
          organizationId: workspace.organizationId,
          status: { in: ["CANDIDATE", "ACTIVE", "MUTED"] },
        },
      }),
    ]);

  const aiCallsToday =
    todaySummary.find((s) => s.type === "AI_CALL")?.quantity ?? 0;
  const aiCallsThisMonth =
    monthSummary.find((s) => s.type === "AI_CALL")?.quantity ?? 0;
  const exportsThisMonth =
    monthSummary.find((s) => s.type === "EXPORT")?.quantity ?? 0;
  const instantPushThisMonth =
    monthSummary.find((s) => s.type === "INSTANT_PUSH")?.quantity ?? 0;

  return (
    <>
      <PageHeader eyebrow="用量" title="用量仪表板">
        <Button asChild size="sm" variant="ghost">
          <Link href="/pricing">
            查看定价
            <ArrowUpRight aria-hidden="true" size={14} />
          </Link>
        </Button>
      </PageHeader>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[16px] border border-border bg-card p-4">
        <div>
          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            当前方案
          </span>
          <strong className="mt-1 block text-sm font-medium">
            {isSelfHosted ? "自用模式" : limits.label}
          </strong>
        </div>
        <Badge variant={isSelfHosted ? "success" : limits.badge}>
          {isSelfHosted ? "自用" : limits.label}
        </Badge>
      </div>

      <Card variant="work">
        <CardHeader>
          <CardTitle>即时推送（本月）</CardTitle>
        </CardHeader>
        <CardContent>
          <UsageMeter current={instantPushThisMonth} label="成功推送" limit={null} unit="次" />
        </CardContent>
      </Card>

      {isSelfHosted ? (
        <Card variant="work">
          <CardContent>
            <div className="flex items-center gap-3 py-8 text-center">
              <Activity aria-hidden="true" size={20} />
              <div>
                <h2 className="text-base font-bold">自用模式 - 用量不限</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  当前工作区已开启自用模式，所有配额检查已跳过。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Card variant="work">
            <CardHeader>
              <CardTitle>主题</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageMeter
                current={topicCount}
                label="已使用主题数"
                limit={limits.topics}
                unit="个"
              />
            </CardContent>
          </Card>

          <Card variant="work">
            <CardHeader>
              <CardTitle>信源</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageMeter
                current={sourceCount}
                label="已使用信源数"
                limit={limits.sources}
                unit="个"
              />
            </CardContent>
          </Card>

          <Card variant="work">
            <CardHeader>
              <CardTitle>AI 调用（今日）</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageMeter
                current={aiCallsToday}
                label="今日 AI 调用"
                limit={limits.aiCallsDaily}
                unit="次"
              />
            </CardContent>
          </Card>

          <Card variant="work">
            <CardHeader>
              <CardTitle>AI 调用（本月）</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageMeter
                current={aiCallsThisMonth}
                label="本月 AI 调用"
                limit={limits.aiCallsMonthly}
                unit="次"
              />
            </CardContent>
          </Card>

          <Card variant="work">
            <CardHeader>
              <CardTitle>导出（本月）</CardTitle>
            </CardHeader>
            <CardContent>
              <UsageMeter
                current={exportsThisMonth}
                label="本月导出"
                limit={limits.exportsMonthly}
                unit="次"
              />
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function UsageMeter({
  current,
  label,
  limit,
  unit,
}: {
  current: number;
  label: string;
  limit: number | null;
  unit: string;
}) {
  const percentage =
    limit !== null && limit > 0
      ? Math.min(100, Math.round((current / limit) * 100))
      : 0;

  const isOverage = limit !== null && current > limit;

  return (
    <div className="grid gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm text-muted-foreground">{label}</span>
        <span className="text-sm font-medium tabular-nums">
          {current}
          {limit !== null ? ` / ${limit}` : ""}
          {unit}
        </span>
      </div>
      {limit !== null ? (
        <div
          aria-label={`${label} ${percentage}%`}
          aria-valuemax={100}
          aria-valuemin={0}
          aria-valuenow={percentage}
          className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
          role="progressbar"
        >
          <span
            className={`block h-full rounded-full ${isOverage ? "bg-destructive" : "bg-primary"}`}
            style={{ inlineSize: `${percentage}%` }}
          />
        </div>
      ) : (
        <Badge variant="accent">不限</Badge>
      )}
    </div>
  );
}
