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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { decodeHtmlEntities } from "@/lib/display-text";
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

      <div className="grid gap-4">
        {activeTopic ? (
          <Card variant="work">
            <CardHeader>
              <CardTitle>添加候选信源</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-3 flex justify-start">
                <form action={runSourceDiscoveryAction}>
                  <Button size="sm" type="submit" variant="primary">
                    <Search aria-hidden="true" size={14} />
                    发现新源
                  </Button>
                </form>
              </div>
              <form action={createCandidateSourceAction} className="grid gap-3">
                <input name="topicId" type="hidden" value={activeTopic.id} />
                <div className="grid gap-2">
                  <Label htmlFor="candidateSourceName">候选源名称</Label>
                  <Input
                    id="candidateSourceName"
                    name="candidateSourceName"
                    placeholder="示例 RSS 源"
                    required
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="candidateSourceUrl">RSS URL</Label>
                  <Input
                    id="candidateSourceUrl"
                    name="candidateSourceUrl"
                    placeholder="https://example.com/feed.xml"
                    required
                    type="url"
                  />
                </div>
                <div className="grid gap-2">
                  <Label htmlFor="candidateSourceDescription">观察备注</Label>
                  <Input
                    id="candidateSourceDescription"
                    name="candidateSourceDescription"
                    placeholder="来源、推荐理由或观察目标。"
                  />
                </div>
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
                <div className="mb-3">
                  <form
                    action={batchUpdateSourceGovernanceAction}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <CheckSquare aria-hidden="true" size={14} />
                    <span className="whitespace-nowrap text-sm font-medium">
                      批量治理
                    </span>
                    <Input
                      name="sourceIds"
                      placeholder="粘贴信源 ID，逗号分隔"
                      required
                      className="h-11 min-w-[200px] flex-1"
                    />
                    <input
                      name="reason"
                      type="hidden"
                      value="batch-governance"
                    />
                    <Button
                      name="action"
                      size="sm"
                      title="批量批准"
                      type="submit"
                      value="approve"
                      variant="primary"
                    >
                      <Check aria-hidden="true" size={13} />
                      批量批准
                    </Button>
                    <Button
                      name="action"
                      size="sm"
                      title="批量观察"
                      type="submit"
                      value="observe"
                      variant="secondary"
                    >
                      <Clock3 aria-hidden="true" size={13} />
                      批量观察
                    </Button>
                    <Button
                      name="action"
                      size="sm"
                      title="批量静音"
                      type="submit"
                      value="mute"
                      variant="ghost"
                    >
                      <ShieldCheck aria-hidden="true" size={13} />
                      批量静音
                    </Button>
                    <Button
                      name="action"
                      size="sm"
                      title="批量拒绝"
                      type="submit"
                      value="reject"
                      variant="danger"
                    >
                      <X aria-hidden="true" size={13} />
                      批量拒绝
                    </Button>
                  </form>
                </div>
                <div className="grid gap-2">
                  {workspace.sourceGovernance.map((source) => (
                    <article
                      className="grid grid-cols-1 gap-3 rounded-[16px] bg-muted p-4 md:grid-cols-[1fr_auto]"
                      key={source.sourceId}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="text-sm font-medium">
                            {decodeHtmlEntities(source.name)}
                          </h3>
                          <Badge variant={sourceTone(source.status)}>
                            {formatSourceStatus(source.status)}
                          </Badge>
                        </div>
                        <div className="mt-2 flex items-center gap-3">
                          <Badge variant="accent" className="tabular-nums">
                            {Math.round(source.qualityScore)}
                          </Badge>
                          <div
                            className="h-1.5 flex-1 overflow-hidden rounded-full bg-background"
                            aria-hidden="true"
                          >
                            <div
                              className="h-full rounded-full bg-primary"
                              style={{
                                width: `${Math.max(0, Math.min(100, Math.round(source.qualityScore)))}%`,
                              }}
                            />
                          </div>
                        </div>
                        {source.recommendationReason ? (
                          <p className="mt-1 max-w-[62ch] text-sm text-foreground">
                            {decodeHtmlEntities(source.recommendationReason)}
                          </p>
                        ) : null}
                        <div className="mt-2.5 grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                          <span className="rounded-[12px] bg-background px-1.5 py-1 font-mono text-xs text-muted-foreground">
                            命中 {formatPercent(source.hitRate)}
                          </span>
                          <span className="rounded-[12px] bg-background px-1.5 py-1 font-mono text-xs text-muted-foreground">
                            噪声 {formatPercent(source.noiseRate)}
                          </span>
                          <span className="rounded-[12px] bg-background px-1.5 py-1 font-mono text-xs text-muted-foreground">
                            重复 {formatPercent(source.duplicateRate)}
                          </span>
                          <span className="rounded-[12px] bg-background px-1.5 py-1 font-mono text-xs text-muted-foreground">
                            事件 {source.eventCount}
                          </span>
                          {source.discoveryChannel ? (
                            <span className="rounded-[12px] bg-background px-1.5 py-1 font-mono text-xs text-muted-foreground">
                              {formatDiscoveryChannel(source.discoveryChannel)}
                            </span>
                          ) : null}
                        </div>
                        {source.consecutiveFailures > 0 ? (
                          <p className="mt-1.5 text-xs leading-relaxed text-destructive">
                            连续失败 {source.consecutiveFailures} 次 ·{" "}
                            {source.lastErrorAt
                              ? formatDateTime(source.lastErrorAt)
                              : "时间未知"}
                            {source.lastError
                              ? `：${decodeHtmlEntities(source.lastError)}`
                              : ""}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs text-muted-foreground">
                          {source.topicName} · 建议{" "}
                          {formatRecommendation(source.recommendation)} · 最近{" "}
                          {source.lastFetchedAt
                            ? formatDateTime(source.lastFetchedAt)
                            : "未抓取"}
                        </p>
                      </div>
                      <div className="flex flex-wrap justify-end gap-1.5">
                        <form action={updateSourceGovernanceAction}>
                          <input
                            name="sourceId"
                            type="hidden"
                            value={source.sourceId}
                          />
                          <input
                            name="reason"
                            type="hidden"
                            value="governance:approve"
                          />
                          <Button
                            aria-label="批准"
                            name="action"
                            size="sm"
                            title="批准"
                            type="submit"
                            value="approve"
                            variant="primary"
                          >
                            <Check aria-hidden="true" size={13} />
                            批准
                          </Button>
                        </form>
                        <form action={updateSourceGovernanceAction}>
                          <input
                            name="sourceId"
                            type="hidden"
                            value={source.sourceId}
                          />
                          <input
                            name="reason"
                            type="hidden"
                            value="governance:observe"
                          />
                          <Button
                            aria-label="观察"
                            name="action"
                            size="sm"
                            title="观察"
                            type="submit"
                            value="observe"
                            variant="secondary"
                          >
                            <Clock3 aria-hidden="true" size={13} />
                            观察
                          </Button>
                        </form>
                        <form action={updateSourceGovernanceAction}>
                          <input
                            name="sourceId"
                            type="hidden"
                            value={source.sourceId}
                          />
                          <input
                            name="reason"
                            type="hidden"
                            value="governance:mute"
                          />
                          <Button
                            aria-label="静音"
                            name="action"
                            size="sm"
                            title="静音"
                            type="submit"
                            value="mute"
                            variant="ghost"
                          >
                            <ShieldCheck aria-hidden="true" size={13} />
                            静音
                          </Button>
                        </form>
                        <form action={updateSourceGovernanceAction}>
                          <input
                            name="sourceId"
                            type="hidden"
                            value={source.sourceId}
                          />
                          <input
                            name="reason"
                            type="hidden"
                            value="governance:reject"
                          />
                          <Button
                            aria-label="拒绝"
                            name="action"
                            size="sm"
                            title="拒绝"
                            type="submit"
                            value="reject"
                            variant="danger"
                          >
                            <X aria-hidden="true" size={13} />
                            拒绝
                          </Button>
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
              <CardTitle className="flex items-center gap-1.5">
                <AlertTriangle aria-hidden="true" size={16} />
                过期候选源复审（{workspace.expiredCandidates.length}）
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid gap-2">
                {workspace.expiredCandidates.map((candidate) => (
                  <article
                    className="grid grid-cols-1 gap-3 rounded-[16px] bg-muted p-4 md:grid-cols-[1fr_auto]"
                    key={candidate.sourceId}
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3 className="text-sm font-medium">
                          {decodeHtmlEntities(candidate.name)}
                        </h3>
                        <Badge variant="warning">待复审</Badge>
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        主题: {candidate.topicName}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">
                        过期时间:{" "}
                        {candidate.observeExpiresAt
                          ? formatDateTime(candidate.observeExpiresAt)
                          : "未知"}
                      </p>
                      {candidate.recommendationReason ? (
                        <p className="mt-1 max-w-[62ch] text-sm text-foreground">
                          {decodeHtmlEntities(candidate.recommendationReason)}
                        </p>
                      ) : null}
                      {candidate.lastError ? (
                        <p className="mt-1.5 text-xs leading-relaxed text-destructive">
                          错误：{decodeHtmlEntities(candidate.lastError)}
                        </p>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap justify-end gap-1.5">
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
                        <Button
                          aria-label="批准"
                          name="action"
                          size="sm"
                          title="批准"
                          type="submit"
                          value="approve"
                          variant="primary"
                        >
                          <Check aria-hidden="true" size={13} />
                          批准
                        </Button>
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
                        <Button
                          aria-label="拒绝"
                          name="action"
                          size="sm"
                          title="拒绝"
                          type="submit"
                          value="reject"
                          variant="danger"
                        >
                          <X aria-hidden="true" size={13} />
                          拒绝
                        </Button>
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
