import { Activity, ArrowLeft, Users } from "lucide-react";
import Link from "next/link";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getWorkspaceAudit, type UsageSummary } from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

export default async function WorkspaceUsagePage() {
  const audit = await getWorkspaceAudit();
  const usageRecords = audit.usageSummary.reduce(
    (total, usage) => total + usage.count,
    0,
  );

  return (
    <>
      <PageHeader eyebrow="工作区设置" title="工作区成员与用量">
        <Button asChild size="sm" variant="ghost">
          <Link href="/admin/settings">
            <ArrowLeft aria-hidden="true" size={14} />
            API Key 设置
          </Link>
        </Button>
      </PageHeader>

      <div className="tenant-card workspace-audit-tenant">
        <div>
          <span>当前工作区</span>
          <strong>{audit.tenant.organizationName}</strong>
          <p>{audit.tenant.organizationSlug}</p>
        </div>
        <Badge variant="success">{formatRole(audit.tenant.role)}</Badge>
      </div>

      <div className="workspace-audit-stats">
        <div className="workspace-audit-stat">
          <Users aria-hidden="true" size={18} />
          <span className="workspace-audit-stat-value">{audit.memberships.length}</span>
          <span className="workspace-audit-stat-label">成员</span>
        </div>
        <div className="workspace-audit-stat">
          <Activity aria-hidden="true" size={18} />
          <span className="workspace-audit-stat-value">{usageRecords}</span>
          <span className="workspace-audit-stat-label">近 30 天用量记录</span>
        </div>
        <div className="workspace-audit-stat">
          <Activity aria-hidden="true" size={18} />
          <span className="workspace-audit-stat-value">{audit.usageSummary.length}</span>
          <span className="workspace-audit-stat-label">计量维度</span>
        </div>
      </div>

      <div className="workspace-audit-grid">
        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <h2 className="m-0 text-base">成员</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="membership-list">
              {audit.memberships.map((membership) => (
                <article className="membership-row" key={membership.userId}>
                  <div>
                    <h3>{membership.name || membership.email}</h3>
                    <p>{membership.email}</p>
                  </div>
                  <Badge variant={roleTone(membership.role)}>
                    {formatRole(membership.role)}
                  </Badge>
                </article>
              ))}
            </div>
          </CardContent>
        </Card>

        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <h2 className="m-0 text-base">近 30 天用量</h2>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="workspace-audit-period">
              统计起点 {formatDate(audit.usageSince)}；数量按各自单位展示，不跨单位相加。
            </p>
            {audit.usageSummary.length === 0 ? (
              <EmptyState
                description="Worker、导出或管理动作执行后会在这里形成用量记录。"
                icon={<Activity aria-hidden="true" size={18} />}
                title="暂无用量"
              />
            ) : (
              <div className="usage-list">
                {audit.usageSummary.map((usage) => (
                  <article className="usage-row" key={`${usage.type}:${usage.unit}`}>
                    <div>
                      <h3>{formatUsageType(usage.type)}</h3>
                      <p>{usage.count} 条用量记录</p>
                    </div>
                    <strong className="workspace-usage-quantity">
                      {usage.quantity} {formatUsageUnit(usage.unit)}
                    </strong>
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function formatRole(role: "OWNER" | "ADMIN" | "MEMBER"): string {
  if (role === "OWNER") return "所有者";
  if (role === "ADMIN") return "管理员";
  return "成员";
}

function roleTone(role: "OWNER" | "ADMIN" | "MEMBER") {
  if (role === "OWNER") return "success" as const;
  if (role === "ADMIN") return "warning" as const;
  return "muted" as const;
}

function formatUsageType(type: UsageSummary["type"]): string {
  const labels: Record<UsageSummary["type"], string> = {
    AI_CALL: "AI 调用",
    BRIEFING: "简报生成",
    EXPORT: "内容导出",
    FETCH: "信源抓取",
    INSTANT_PUSH: "即时推送",
    SOURCE_DISCOVERY: "信源发现",
    SOURCE_GOVERNANCE: "信源质量观测",
    WEB_ACTION: "管理操作",
  };
  return labels[type];
}

function formatUsageUnit(unit: string): string {
  const labels: Record<string, string> = {
    action: "次操作",
    briefing: "份简报",
    call: "次调用",
    candidate: "个候选源",
    file: "个文件",
    item: "条条目",
    observation: "条观测",
  };
  return labels[unit] ?? unit;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}
