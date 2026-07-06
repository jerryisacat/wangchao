import {
  Check,
  CircleAlert,
  Clock3,
  Plus,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  createCandidateSourceAction,
  updateSourceGovernanceAction,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { getTopicSourceWorkspace } from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

interface SourcesPageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function SourcesPage({ searchParams }: SourcesPageProps) {
  const workspace = await getTopicSourceWorkspace();
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const notice = readParam(resolvedSearchParams.notice);
  const actionError = readParam(resolvedSearchParams.error);
  const activeTopic = workspace.topics[0];

  return (
    <>
      <PageHeader eyebrow="信源治理" title="信源管理">
        <Link className="ui-button ui-button-ghost ui-button-sm" href="/">
          ← 返回情报流
        </Link>
      </PageHeader>

      {notice ? (
        <StatusBanner
          icon={<Check aria-hidden="true" size={16} />}
          message={notice}
          tone="notice"
        />
      ) : null}
      {actionError ? (
        <StatusBanner
          icon={<CircleAlert aria-hidden="true" size={16} />}
          message={actionError}
          tone="error"
        />
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        {activeTopic ? (
          <Card variant="work">
            <CardHeader>
              <CardTitle>添加候选信源</CardTitle>
            </CardHeader>
            <CardContent>
              <form action={createCandidateSourceAction} className="candidate-form">
                <input name="topicId" type="hidden" value={activeTopic.id} />
                <label>
                  <span>候选源名称</span>
                  <input
                    name="candidateSourceName"
                    placeholder="示例 RSS 源"
                    required
                  />
                </label>
                <label>
                  <span>RSS URL</span>
                  <input
                    name="candidateSourceUrl"
                    placeholder="https://example.com/feed.xml"
                    required
                    type="url"
                  />
                </label>
                <label>
                  <span>观察备注</span>
                  <input
                    name="candidateSourceDescription"
                    placeholder="来源、推荐理由或观察目标。"
                  />
                </label>
                <Button size="sm" type="submit" variant="primary">
                  <Plus aria-hidden="true" size={14} />
                  加入候选
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <Card variant="work">
          <CardHeader>
            <CardTitle>信源质量报告</CardTitle>
          </CardHeader>
          <CardContent>
            {workspace.sourceGovernance.length === 0 ? (
              <EmptyState
                description="暂无信源需要治理。"
                icon={<ShieldCheck aria-hidden="true" size={18} />}
                title="无信源数据"
              />
            ) : (
              <div className="source-quality-list">
                {workspace.sourceGovernance.map((source) => (
                  <article className="source-quality-row" key={source.sourceId}>
                    <div>
                      <div className="source-quality-title">
                        <h3>{source.name}</h3>
                        <Badge tone={sourceTone(source.status)}>
                          {formatSourceStatus(source.status)}
                        </Badge>
                      </div>
                      <div className="source-quality-score">
                        {Math.round(source.qualityScore)}
                      </div>
                      <div className="source-quality-metrics">
                        <span>命中 {formatPercent(source.hitRate)}</span>
                        <span>噪声 {formatPercent(source.noiseRate)}</span>
                        <span>重复 {formatPercent(source.duplicateRate)}</span>
                        <span>事件 {source.eventCount}</span>
                      </div>
                      <p>
                        {source.topicName} · 建议 {formatRecommendation(source.recommendation)} · 最近{" "}
                        {source.lastFetchedAt
                          ? formatDateTime(source.lastFetchedAt)
                          : "未抓取"}
                      </p>
                    </div>
                    <div className="source-governance-actions">
                      <form action={updateSourceGovernanceAction}>
                        <input name="sourceId" type="hidden" value={source.sourceId} />
                        <input name="reason" type="hidden" value="governance:approve" />
                        <button
                          aria-label="批准"
                          className="icon-action"
                          name="action"
                          title="批准"
                          type="submit"
                          value="approve"
                        >
                          <Check aria-hidden="true" size={13} />
                        </button>
                      </form>
                      <form action={updateSourceGovernanceAction}>
                        <input name="sourceId" type="hidden" value={source.sourceId} />
                        <input name="reason" type="hidden" value="governance:observe" />
                        <button
                          aria-label="观察"
                          className="icon-action"
                          name="action"
                          title="观察"
                          type="submit"
                          value="observe"
                        >
                          <Clock3 aria-hidden="true" size={13} />
                        </button>
                      </form>
                      <form action={updateSourceGovernanceAction}>
                        <input name="sourceId" type="hidden" value={source.sourceId} />
                        <input name="reason" type="hidden" value="governance:mute" />
                        <button
                          aria-label="静音"
                          className="icon-action"
                          name="action"
                          title="静音"
                          type="submit"
                          value="mute"
                        >
                          <ShieldCheck aria-hidden="true" size={13} />
                        </button>
                      </form>
                      <form action={updateSourceGovernanceAction}>
                        <input name="sourceId" type="hidden" value={source.sourceId} />
                        <input name="reason" type="hidden" value="governance:reject" />
                        <button
                          aria-label="拒绝"
                          className="icon-action"
                          name="action"
                          title="拒绝"
                          type="submit"
                          value="reject"
                        >
                          <X aria-hidden="true" size={13} />
                        </button>
                      </form>
                    </div>
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

function readParam(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim().slice(0, 80) : "";
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}

function formatPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function sourceTone(
  status: string,
): "default" | "muted" | "success" | "warning" | "danger" | "accent" {
  if (status === "ACTIVE") return "success";
  if (status === "CANDIDATE") return "warning";
  if (status === "REJECTED") return "danger";
  return "muted";
}

function formatSourceStatus(value: string): string {
  const labels: Record<string, string> = {
    ACTIVE: "活跃",
    CANDIDATE: "候选",
    MUTED: "静音",
    REJECTED: "已拒绝",
  };
  return labels[value] ?? value;
}

function formatRecommendation(value: string): string {
  const labels: Record<string, string> = {
    APPROVE: "批准",
    MUTE: "静音",
    OBSERVE: "观察",
    REJECT: "拒绝",
  };
  return labels[value] ?? value;
}
