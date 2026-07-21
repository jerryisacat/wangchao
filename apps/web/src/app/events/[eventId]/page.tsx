import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  Bookmark,
  Check,
  CircleAlert,
  Download,
  EyeOff,
  ExternalLink,
  Gauge,
  RotateCcw,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  recordEnhancedFeedbackAction,
  regenerateEventSummaryAction,
  updateCategoryPreferenceAction,
  updateDashboardEventStateAction,
} from "@/app/actions";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { decodeHtmlEntities } from "@/lib/display-text";
import { getDashboardEventDetail } from "@/lib/topic-source-data";
import { isHttpUrl } from "@wangchao/core";

export const dynamic = "force-dynamic";

interface EventDetailPageProps {
  params: Promise<{ eventId: string }> | { eventId: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function EventDetailPage({
  params,
  searchParams,
}: EventDetailPageProps) {
  const { eventId } = await Promise.resolve(params);
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const notice = readSearchParam(resolvedSearchParams.notice);
  const actionError = readSearchParam(resolvedSearchParams.error);
  const event = await getDashboardEventDetail(eventId);

  if (!event) {
    notFound();
  }

  const sourceUrl = isHttpUrl(event.sourceUrl) ? event.sourceUrl : null;
  const itemUrl = isHttpUrl(event.primaryItemUrl) ? event.primaryItemUrl : null;
  const returnTo = `/events/${event.eventId}`;

  return (
    <>
      <PageHeader
        eyebrow={event.topicName}
        meta={
          <span>
            {decodeHtmlEntities(event.sourceName)} · {formatDateTime(event.occurredAt)}
          </span>
        }
        title="情报详情"
      >
        <Button asChild size="sm" variant="ghost">
          <Link href="/">
            <ArrowLeft aria-hidden="true" size={14} />
            返回情报流
          </Link>
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

      <Card variant="work">
        <CardHeader>
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="default">{formatCategoryLabel(event.category)}</Badge>
            {event.entities && event.entities.length > 0
              ? event.entities.map((entity) => (
                  <Badge key={entity} variant="outline">
                    {decodeHtmlEntities(entity)}
                  </Badge>
                ))
              : null}
            {event.userSaved ? <Badge variant="accent">已收藏</Badge> : null}
          </div>
          <CardTitle>
            <h2 className="text-xl leading-snug [overflow-wrap:anywhere] sm:text-2xl">
              {event.title}
            </h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <article className="grid gap-5">
            <p
              className="max-w-[72ch] text-base leading-7 text-foreground"
              data-summary-status={event.summaryStatus}
            >
              {event.summary}
            </p>

            {event.explanation ? (
              <div className="grid max-w-[72ch] grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-[16px] bg-muted p-4 text-sm leading-relaxed">
                <Sparkles aria-hidden="true" className="mt-0.5 text-primary" size={16} />
                <div>
                  <h3 className="font-medium text-foreground">为什么重要</h3>
                  <p className="mt-1 text-muted-foreground">{event.explanation}</p>
                </div>
              </div>
            ) : null}

            {event.followUpSuggestion ? (
              <div className="grid max-w-[72ch] grid-cols-[auto_minmax(0,1fr)] gap-2 rounded-[16px] bg-muted p-4 text-sm leading-relaxed">
                <Sparkles aria-hidden="true" className="mt-0.5 text-primary" size={16} />
                <div>
                  <h3 className="font-medium text-foreground">后续跟踪</h3>
                  <p className="mt-1 text-muted-foreground">{event.followUpSuggestion}</p>
                </div>
              </div>
            ) : null}

            {event.mergeReason ? (
              <p className="max-w-[72ch] text-sm leading-relaxed text-muted-foreground">
                合并原因：{event.mergeReason}
              </p>
            ) : null}

            <dl className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <div className="rounded-[16px] bg-muted p-4">
                <dt className="text-sm text-muted-foreground">主题</dt>
                <dd className="mt-1 break-words font-medium">{event.topicName}</dd>
              </div>
              <div className="rounded-[16px] bg-muted p-4">
                <dt className="text-sm text-muted-foreground">来源</dt>
                <dd className="mt-1 break-words font-medium">
                  {decodeHtmlEntities(event.sourceName)}
                </dd>
              </div>
              <div className="rounded-[16px] bg-muted p-4">
                <dt className="text-sm text-muted-foreground">更新时间</dt>
                <dd className="mt-1 font-medium tabular-nums">{formatDateTime(event.updatedAt)}</dd>
              </div>
            </dl>

            <section className="grid gap-3 border-t border-border pt-5" aria-labelledby="event-reading-actions">
              <h3 className="text-sm font-medium" id="event-reading-actions">阅读状态</h3>
              <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap [&>a]:w-full [&>button]:w-full [&>form]:min-w-0 [&>form>button]:w-full sm:[&>a]:w-auto sm:[&>button]:w-auto sm:[&>form>button]:w-auto">
              <form action={updateDashboardEventStateAction}>
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <Button
                  name="action"
                  size="sm"
                  type="submit"
                  value="read"
                  variant="secondary"
                >
                  <Check aria-hidden="true" size={14} />
                  已读
                </Button>
              </form>
              <form action={updateDashboardEventStateAction}>
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <Button
                  name="action"
                  size="sm"
                  type="submit"
                  value="save"
                  variant="secondary"
                >
                  <Bookmark aria-hidden="true" size={14} />
                  收藏
                </Button>
              </form>
              <form action={updateDashboardEventStateAction}>
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <Button
                  name="action"
                  size="sm"
                  type="submit"
                  value="dismiss"
                  className="text-destructive hover:bg-destructive/10"
                  variant="ghost"
                >
                  <EyeOff aria-hidden="true" size={14} />
                  忽略此条
                </Button>
              </form>
              {event.status === "ARCHIVED" ? (
                <form action={updateDashboardEventStateAction}>
                  <input name="eventId" type="hidden" value={event.eventId} />
                  <input name="returnTo" type="hidden" value={returnTo} />
                  <Button
                    name="action"
                    size="sm"
                    type="submit"
                    value="restore"
                    variant="secondary"
                  >
                    <ArchiveRestore aria-hidden="true" size={14} />
                    恢复归档
                  </Button>
                </form>
              ) : (
                <form action={updateDashboardEventStateAction}>
                  <input name="eventId" type="hidden" value={event.eventId} />
                  <input name="returnTo" type="hidden" value={returnTo} />
                  <Button
                    name="action"
                    size="sm"
                    type="submit"
                    value="archive"
                    variant="ghost"
                  >
                    <Archive aria-hidden="true" size={14} />
                    归档
                  </Button>
                </form>
              )}
              </div>
            </section>

            <section className="grid gap-3 border-t border-border pt-5" aria-labelledby="event-preference-actions">
              <h3 className="text-sm font-medium" id="event-preference-actions">调整偏好</h3>
              <p className="text-sm leading-relaxed text-muted-foreground">这些反馈只影响当前主题的后续排序，不会移除这条情报。</p>
              <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap [&>form]:min-w-0 [&>form>button]:w-full sm:[&>form>button]:w-auto">
              <form action={updateCategoryPreferenceAction}>
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <Button
                  name="action"
                  size="sm"
                  type="submit"
                  value="up"
                  variant="ghost"
                >
                  <ThumbsUp aria-hidden="true" size={14} />
                  多关注这类
                </Button>
              </form>
              <form action={updateCategoryPreferenceAction}>
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <Button
                  name="action"
                  size="sm"
                  type="submit"
                  value="down"
                  variant="ghost"
                >
                  <ThumbsDown aria-hidden="true" size={14} />
                  少关注这类
                </Button>
              </form>
              <form action={recordEnhancedFeedbackAction}>
                <input name="topicId" type="hidden" value={event.topicId} />
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="sourceId" type="hidden" value={event.sourceId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <input name="feedbackKind" type="hidden" value="MORE_LIKE_THIS" />
                <Button
                  size="sm"
                  type="submit"
                  variant="ghost"
                >
                  <TrendingUp aria-hidden="true" size={14} />
                  多看类似
                </Button>
              </form>
              <form action={recordEnhancedFeedbackAction}>
                <input name="topicId" type="hidden" value={event.topicId} />
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="sourceId" type="hidden" value={event.sourceId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <input name="feedbackKind" type="hidden" value="LESS_LIKE_THIS" />
                <Button
                  size="sm"
                  type="submit"
                  variant="ghost"
                >
                  <TrendingDown aria-hidden="true" size={14} />
                  少看类似
                </Button>
              </form>
              </div>
            </section>

            {/* Issue #175 / SPEC §5.6: 来源质量反馈，影响当前 Topic 的 source 权重 */}
            <section className="grid gap-3 border-t border-border pt-5" aria-labelledby="event-calibration-actions">
              <h3 className="text-sm font-medium" id="event-calibration-actions">校准来源与评分</h3>
              <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap [&>form]:min-w-0 [&>form>button]:w-full sm:[&>form>button]:w-auto">
              <form action={recordEnhancedFeedbackAction}>
                <input name="topicId" type="hidden" value={event.topicId} />
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="sourceId" type="hidden" value={event.sourceId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <input name="feedbackKind" type="hidden" value="SOURCE_QUALITY_UP" />
                <Button
                  size="sm"
                  type="submit"
                  variant="ghost"
                >
                  <ShieldCheck aria-hidden="true" size={14} />
                  来源靠谱
                </Button>
              </form>
              <form action={recordEnhancedFeedbackAction}>
                <input name="topicId" type="hidden" value={event.topicId} />
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="sourceId" type="hidden" value={event.sourceId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <input name="feedbackKind" type="hidden" value="SOURCE_QUALITY_DOWN" />
                <Button
                  size="sm"
                  type="submit"
                  variant="ghost"
                >
                  <ShieldAlert aria-hidden="true" size={14} />
                  来源存疑
                </Button>
              </form>
              </div>

            {/* Issue #175 / SPEC §5.6: 评分校准反馈，调整当前事件分数相关 category 权重 */}
              <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap [&>form]:min-w-0 [&>form>button]:w-full sm:[&>form>button]:w-auto">
              <form action={recordEnhancedFeedbackAction}>
                <input name="topicId" type="hidden" value={event.topicId} />
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="sourceId" type="hidden" value={event.sourceId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <input name="feedbackKind" type="hidden" value="SCORE_UP" />
                <Button
                  size="sm"
                  type="submit"
                  variant="ghost"
                >
                  <Gauge aria-hidden="true" size={14} />
                  评分偏低
                </Button>
              </form>
              <form action={recordEnhancedFeedbackAction}>
                <input name="topicId" type="hidden" value={event.topicId} />
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="sourceId" type="hidden" value={event.sourceId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <input name="feedbackKind" type="hidden" value="SCORE_DOWN" />
                <Button
                  size="sm"
                  type="submit"
                  variant="ghost"
                >
                  <Gauge aria-hidden="true" size={14} />
                  评分偏高
                </Button>
              </form>
              </div>
            </section>

            <section className="grid gap-3 border-t border-border pt-5" aria-labelledby="event-tool-actions">
              <h3 className="text-sm font-medium" id="event-tool-actions">工具</h3>
              <div className="grid grid-cols-1 gap-2 min-[360px]:grid-cols-2 sm:flex sm:flex-wrap [&>a]:w-full [&>form]:min-w-0 [&>form>button]:w-full sm:[&>a]:w-auto sm:[&>form>button]:w-auto">
              <form action={regenerateEventSummaryAction}>
                <input name="eventId" type="hidden" value={event.eventId} />
                <input name="returnTo" type="hidden" value={returnTo} />
                <Button size="sm" type="submit" variant="secondary">
                  <RotateCcw aria-hidden="true" size={14} />
                  {event.summaryStatus === "READY" ? "重新采集并生成" : "重新采集"}
                </Button>
              </form>
              <Button asChild size="sm" variant="secondary">
                <a href={`/exports/events/${event.eventId}`}>
                  <Download aria-hidden="true" size={14} />
                  Markdown
                </a>
              </Button>
              {itemUrl ? (
                <Button asChild size="sm" variant="primary">
                  <a href={itemUrl} rel="noreferrer" target="_blank">
                    <ExternalLink aria-hidden="true" size={14} />
                    原文
                  </a>
                </Button>
              ) : sourceUrl ? (
                <Button asChild size="sm" variant="primary">
                  <a href={sourceUrl} rel="noreferrer" target="_blank">
                    <ExternalLink aria-hidden="true" size={14} />
                    来源
                  </a>
                </Button>
              ) : null}
              </div>
            </section>
          </article>
        </CardContent>
      </Card>
    </>
  );
}

function readSearchParam(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim().slice(0, 120) : "";
}

function formatCategoryLabel(category: string): string {
  const [rawKind = "", ...rawValueParts] = category.split(":");
  const value = decodeHtmlEntities(rawValueParts.join(":").trim());
  if (!value) {
    return decodeHtmlEntities(category);
  }

  const kindLabel: Record<string, string> = {
    entity: "实体",
    keyword: "关键词",
    scope: "覆盖范围",
    source: "来源",
  };
  return `${kindLabel[rawKind.toLowerCase()] ?? "内容方向"} · ${value}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}
