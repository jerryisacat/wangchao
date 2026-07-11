import { Activity, ArrowUpRight } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";

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
    aiCallsDaily: 100,
    aiCallsMonthly: null,
    exportsMonthly: 10,
    topics: 1,
    sources: 3,
    label: "Free",
    badge: "muted",
  },
  PLUS: {
    aiCallsDaily: null,
    aiCallsMonthly: null,
    exportsMonthly: 50,
    topics: 5,
    sources: 25,
    label: "Plus",
    badge: "default",
  },
  PRO: {
    aiCallsDaily: null,
    aiCallsMonthly: 20_000,
    exportsMonthly: null,
    topics: null,
    sources: null,
    label: "Pro",
    badge: "accent",
  },
};

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
          status: { not: "REJECTED" },
        },
      }),
    ]);

  const aiCallsToday =
    todaySummary.find((s) => s.type === "AI_CALL")?.quantity ?? 0;
  const aiCallsThisMonth =
    monthSummary.find((s) => s.type === "AI_CALL")?.quantity ?? 0;
  const exportsThisMonth =
    monthSummary.find((s) => s.type === "EXPORT")?.quantity ?? 0;

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

      <div className="usage-plan-banner tenant-card">
        <div>
          <span>当前方案</span>
          <strong>{isSelfHosted ? "自用模式" : limits.label}</strong>
        </div>
        <Badge variant={isSelfHosted ? "success" : limits.badge}>
          {isSelfHosted ? "自用" : limits.label}
        </Badge>
      </div>

      {isSelfHosted ? (
        <Card variant="work">
          <CardContent>
            <div className="flex items-center gap-3 py-8 text-center">
              <Activity aria-hidden="true" size={20} />
              <div>
                <h2 className="text-base font-bold">自用模式 — 用量不限</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  当前工作区已开启自用模式，所有配额检查已跳过。
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="usage-grid">
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

  return (
    <div className="usage-meter">
      <div className="usage-meter-head">
        <span className="usage-meter-label">{label}</span>
        <span className="usage-meter-value">
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
          className="confidence-meter"
          role="progressbar"
        >
          <span style={{ inlineSize: `${percentage}%` }} />
        </div>
      ) : (
        <Badge variant="accent">不限</Badge>
      )}
    </div>
  );
}
