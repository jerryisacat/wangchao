import {
  ArrowLeft,
  Bookmark,
  Check,
  CircleAlert,
  Download,
  EyeOff,
  ExternalLink,
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
  updateCategoryPreferenceAction,
  updateDashboardEventStateAction,
} from "@/app/actions";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getDashboardEventDetail } from "@/lib/topic-source-data";

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
            {event.sourceName} · {formatDateTime(event.occurredAt)}
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
          <div className="event-detail-kicker">
            <Badge variant="default">{event.category}</Badge>
            {event.entities && event.entities.length > 0
              ? event.entities.map((entity) => (
                  <Badge key={entity} variant="outline">
                    {entity}
                  </Badge>
                ))
              : null}
            {event.userSaved ? <Badge variant="accent">已收藏</Badge> : null}
          </div>
          <CardTitle>{event.title}</CardTitle>
        </CardHeader>
        <CardContent>
          <article className="event-detail-page">
            <p className="event-detail-summary">{event.summary}</p>

            {event.explanation ? (
              <div className="event-detail-reason">
                <Sparkles aria-hidden="true" size={14} />
                <span>{event.explanation}</span>
              </div>
            ) : null}

            {event.followUpSuggestion ? (
              <div className="event-detail-reason">
                <Sparkles aria-hidden="true" size={14} />
                <span>后续跟踪：{event.followUpSuggestion}</span>
              </div>
            ) : null}

            {event.mergeReason ? (
              <p className="text-xs text-muted-foreground mt-2">
                合并原因：{event.mergeReason}
              </p>
            ) : null}

            <dl className="event-detail-grid">
              <div>
                <dt>主题</dt>
                <dd>{event.topicName}</dd>
              </div>
              <div>
                <dt>来源</dt>
                <dd>{event.sourceName}</dd>
              </div>
              <div>
                <dt>更新时间</dt>
                <dd>{formatDateTime(event.updatedAt)}</dd>
              </div>
            </dl>

            <div className="event-detail-actions">
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
                  variant="danger"
                >
                  <EyeOff aria-hidden="true" size={14} />
                  忽略此条
                </Button>
              </form>
            </div>

            <div className="event-detail-actions">
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

            <div className="event-detail-actions">
              <Button asChild size="sm" variant="primary">
                <a href={`/exports/events/${event.eventId}`}>
                  <Download aria-hidden="true" size={14} />
                  Markdown
                </a>
              </Button>
              {itemUrl ? (
                <Button asChild size="sm" variant="ghost">
                  <a href={itemUrl} rel="noreferrer" target="_blank">
                    <ExternalLink aria-hidden="true" size={14} />
                    原文
                  </a>
                </Button>
              ) : sourceUrl ? (
                <Button asChild size="sm" variant="ghost">
                  <a href={sourceUrl} rel="noreferrer" target="_blank">
                    <ExternalLink aria-hidden="true" size={14} />
                    来源
                  </a>
                </Button>
              ) : null}
            </div>
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

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}
