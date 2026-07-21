import {
  ArrowLeft,
  Check,
  CircleAlert,
  Download,
  FileText,
  ExternalLink,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { markBriefingAsReadAction } from "@/app/actions";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { getBriefingDetail } from "@/lib/topic-source-data";
import { renderBriefingMarkdown, sanitizeBriefingBody } from "@/lib/briefing-markdown";

export const dynamic = "force-dynamic";

interface BriefingDetailPageProps {
  params: Promise<{ briefingId: string }> | { briefingId: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function BriefingDetailPage({
  params,
  searchParams,
}: BriefingDetailPageProps) {
  const { briefingId } = await Promise.resolve(params);
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const notice = readSearchParam(resolvedSearchParams.notice);
  const actionError = readSearchParam(resolvedSearchParams.error);

  const briefing = await getBriefingDetail(briefingId);

  if (!briefing) {
    notFound();
  }

  const returnTo = `/briefings`;
  const renderedHtml = renderBriefingMarkdown(briefing.body);
  const hasBody = renderedHtml.length > 0;
  // content fallback 如果 markdown 渲染为空但 content 有值，用 sanitize 后的 content 作为纯文本兜底。
  const fallbackText = !hasBody && briefing.content
    ? sanitizeBriefingBody(briefing.content)
    : "";

  return (
    <>
      <PageHeader eyebrow={briefing.topicName} title={briefing.title}>
        <Button asChild size="sm" variant="ghost">
          <Link href="/briefings">
            <ArrowLeft aria-hidden="true" size={14} />
            返回简报列表
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

      <div className="grid gap-3">
        <Card variant="work">
          <CardHeader>
            <div className="briefing-detail-kicker">
              <Badge variant="outline">{periodLabel(briefing.period)}</Badge>
              <span className="briefing-detail-meta">
                {briefing.topicName} · {formatDateRange(briefing.rangeStart, briefing.rangeEnd)} · 生成于 {formatDateTime(briefing.generatedAt)}
              </span>
            </div>
            <CardTitle>{briefing.title}</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="briefing-detail-actions">
              <a
                className="briefing-detail-download"
                href={`/exports/briefings/${briefing.briefingId}`}
              >
                <Download aria-hidden="true" size={14} />
                Markdown 下载
              </a>
              <form action={markBriefingAsReadAction}>
                <input name="briefingId" type="hidden" value={briefing.briefingId} />
                <input name="returnTo" type="hidden" value={`/briefings/${briefing.briefingId}`} />
                <Button name="action" size="sm" type="submit" variant="secondary">
                  <Check aria-hidden="true" size={14} />
                  全部标记已读
                </Button>
              </form>
            </div>
          </CardContent>
        </Card>

        {hasBody ? (
          <Card variant="work">
            <CardHeader>
              <CardTitle>简报正文</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="briefing-content"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            </CardContent>
          </Card>
        ) : fallbackText ? (
          <Card variant="work">
            <CardHeader>
              <CardTitle>简报正文</CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                {fallbackText}
              </pre>
            </CardContent>
          </Card>
        ) : (
          <Card variant="work">
            <CardContent>
              <EmptyState
                description="这份简报还没有生成正文内容。Worker 完成分析后会自动填充。"
                icon={<FileText aria-hidden="true" size={18} />}
                title="暂无正文"
              />
            </CardContent>
          </Card>
        )}

        {briefing.events.length > 0 ? (
          <Card variant="work">
            <CardHeader>
              <CardTitle>简报内情报（{briefing.events.length}）</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="briefing-detail-events">
                {briefing.events.map((event) => (
                  <li key={event.eventId}>
                    <Link
                      href={`/events/${event.eventId}`}
                      className="briefing-detail-event-link"
                    >
                      <ExternalLink aria-hidden="true" size={12} />
                      <span>{event.title}</span>
                      {event.occurredAt ? (
                        <span className="briefing-detail-event-date">
                          {formatDateTime(event.occurredAt)}
                        </span>
                      ) : null}
                    </Link>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function readSearchParam(value: string | string[] | undefined): string | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return typeof raw === "string" ? raw : null;
}

function periodLabel(period: "DAILY" | "WEEKLY" | "MONTHLY"): string {
  if (period === "WEEKLY") return "每周";
  if (period === "MONTHLY") return "每月";
  return "每日";
}

function formatDateRange(rangeStart: string, rangeEnd: string): string {
  const start = new Date(rangeStart);
  const inclusiveEnd = new Date(new Date(rangeEnd).getTime() - 1);
  const formatter = new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    timeZone: "UTC",
  });
  const startLabel = formatter.format(start);
  const endLabel = formatter.format(inclusiveEnd);
  return startLabel === endLabel ? startLabel : `${startLabel} – ${endLabel}`;
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    month: "2-digit",
  }).format(new Date(value));
}