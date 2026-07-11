import {
  AlertTriangle,
  Check,
  CheckSquare,
  CircleAlert,
  Clock3,
  Plus,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import {
  batchUpdateSourceGovernanceAction,
  createCandidateSourceAction,
  runSourceDiscoveryAction,
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
              <div className="source-discovery-toolbar">
                <form action={runSourceDiscoveryAction}>
                  <Button size="sm" type="submit" variant="primary">
                    <Search aria-hidden="true" size={14} />
                    发现新源
                  </Button>
                </form>
              </div>
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
                <Button size="sm" type="submit" variant="secondary">
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
              <>
                <div className="source-batch-toolbar">
                  <form action={batchUpdateSourceGovernanceAction}>
                    <CheckSquare
                      aria-hidden="true"
                      size={14}
                      style={{ marginRight: 6 }}
                    />
                    <span className="source-batch-label">批量治理</span>
                    <input
                      name="sourceIds"
                      placeholder="粘贴 sourceId，逗号分隔"
                      required
                      className="source-batch-input"
                    />
                    <input
                      name="reason"
                      type="hidden"
                      value="batch-governance"
                    />
                    <button
                      className="icon-action"
                      name="action"
                      title="批量批准"
                      type="submit"
                      value="approve"
                    >
                      <Check aria-hidden="true" size={13} />
                      <span>批量批准</span>
                    </button>
                    <button
                      className="icon-action"
                      name="action"
                      title="批量观察"
                      type="submit"
                      value="observe"
                    >
                      <Clock3 aria-hidden="true" size={13} />
                      <span>批量观察</span>
                    </button>
                    <button
                      className="icon-action"
                      name="action"
                      title="批量静音"
                      type="submit"
                      value="mute"
                    >
                      <ShieldCheck aria-hidden="true" size={13} />
                      <span>批量静音</span>
                    </button>
                    <button
                      className="icon-action"
                      name="action"
                      title="批量拒绝"
                      type="submit"
                      value="reject"
                    >
                      <X aria-hidden="true" size={13} />
                      <span>批量拒绝</span>
                    </button>
                  </form>
                </div>
                <div className="source-quality-list">
                  {workspace.sourceGovernance.map((source) => (
                    <article className="source-quality-row" key={source.sourceId}>
                      <div>
                        <div className="source-quality-title">
                          <h3>{source.name}</h3>
                          <Badge variant={sourceTone(source.status)}>
                            {formatSourceStatus(source.status)}
                          </Badge>
                        </div>
                        <div className="source-quality-score">
                          {Math.round(source.qualityScore)}
                        </div>
                        {source.recommendationReason ? (
                          <p className="source-recommendation">
                            {source.recommendationReason}
                          </p>
                        ) : null}
                        <div className="source-quality-metrics">
                          <span>命中 {formatPercent(source.hitRate)}</span>
                          <span>噪声 {formatPercent(source.noiseRate)}</span>
                          <span>重复 {formatPercent(source.duplicateRate)}</span>
                          <span>事件 {source.eventCount}</span>
                          {source.discoveryChannel ? (
                            <span>{formatDiscoveryChannel(source.discoveryChannel)}</span>
                          ) : null}
                        </div>
                        {source.consecutiveFailures > 0 ? (
                          <p className="source-error-hint">
                            连续失败 {source.consecutiveFailures} 次 ·{" "}
                            {source.lastErrorAt
                              ? formatDateTime(source.lastErrorAt)
                              : "时间未知"}
                            {source.lastError ? `: ${source.lastError}` : ""}
                          </p>
                        ) : null}
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
                            <span>批准</span>
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
                            <span>观察</span>
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
                            <span>静音</span>
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
                            <span>拒绝</span>
                          </button>
                        </form>
                      </div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {workspace.expiredCandidates.length > 0 ? (
          <Card variant="work">
            <CardHeader>
              <CardTitle>
                <AlertTriangle
                  aria-hidden="true"
                  size={16}
                  style={{ marginRight: 6, verticalAlign: "middle" }}
                />
                过期候选源复审（{workspace.expiredCandidates.length}）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="source-quality-list">
                {workspace.expiredCandidates.map((candidate) => (
                  <article
                    className="source-quality-row"
                    key={candidate.sourceId}
                  >
                    <div>
                      <div className="source-quality-title">
                        <h3>{candidate.name}</h3>
                        <Badge variant="warning">待复审</Badge>
                      </div>
                      <p>主题: {candidate.topicName}</p>
                      <p>
                        过期时间:{" "}
                        {candidate.observeExpiresAt
                          ? formatDateTime(candidate.observeExpiresAt)
                          : "未知"}
                      </p>
                      {candidate.recommendationReason ? (
                        <p className="source-recommendation">
                          {candidate.recommendationReason}
                        </p>
                      ) : null}
                      {candidate.lastError ? (
                        <p className="source-error-hint">
                          错误: {candidate.lastError}
                        </p>
                      ) : null}
                    </div>
                    <div className="source-governance-actions">
                      <form action={updateSourceGovernanceAction}>
                        <input
                          name="sourceId"
                          type="hidden"
                          value={candidate.sourceId}
                        />
                        <input
                          name="reason"
                          type="hidden"
                          value="expiry-review:approve"
                        />
                        <button
                          className="icon-action"
                          name="action"
                          title="批准"
                          type="submit"
                          value="approve"
                        >
                          <Check aria-hidden="true" size={13} />
                          <span>批准</span>
                        </button>
                      </form>
                      <form action={updateSourceGovernanceAction}>
                        <input
                          name="sourceId"
                          type="hidden"
                          value={candidate.sourceId}
                        />
                        <input
                          name="reason"
                          type="hidden"
                          value="expiry-review:reject"
                        />
                        <button
                          className="icon-action"
                          name="action"
                          title="拒绝"
                          type="submit"
                          value="reject"
                        >
                          <X aria-hidden="true" size={13} />
                          <span>拒绝</span>
                        </button>
                      </form>
                    </div>
                  </article>
                ))}
              </div>
            </CardContent>
          </Card>
        ) : null}
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

function formatDiscoveryChannel(value: string): string {
  const labels: Record<string, string> = {
    "backlink-from-highscore": "高分反查",
    "keyword-search": "关键词搜索",
    "outlink-network": "外链网络",
  };
  return labels[value] ?? value;
}
