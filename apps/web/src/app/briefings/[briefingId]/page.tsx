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
import {
  normalizeBriefingDisplayText,
  renderBriefingMarkdown,
  sanitizeBriefingBody,
} from "@/lib/briefing-markdown";

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
    ? normalizeBriefingDisplayText(sanitizeBriefingBody(briefing.content))
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
        <Card className="gap-4" variant="work">
          <CardContent className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <Badge variant="outline">{periodLabel(briefing.period)}</Badge>
              <span className="leading-relaxed">
                {briefing.topicName} · {formatDateRange(briefing.rangeStart, briefing.rangeEnd)}
              </span>
              <span className="leading-relaxed">
                生成于 {formatDateTime(briefing.generatedAt)}
              </span>
            </div>
            <div className="grid grid-cols-1 gap-2 border-t border-border pt-4 sm:flex sm:flex-wrap">
              <Button asChild className="w-full sm:w-auto" size="sm" variant="secondary">
                <a href={`/exports/briefings/${briefing.briefingId}`}>
                  <Download aria-hidden="true" size={14} />
                  Markdown 下载
                </a>
              </Button>
              <form action={markBriefingAsReadAction}>
                <input name="briefingId" type="hidden" value={briefing.briefingId} />
                <input name="returnTo" type="hidden" value={`/briefings/${briefing.briefingId}`} />
                <Button className="w-full sm:w-auto" name="action" size="sm" type="submit" variant="primary">
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
              <CardTitle><h2>简报正文</h2></CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="mx-auto max-w-[72ch] text-base leading-7 text-foreground [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h1]:mb-5 [&_h1]:mt-2 [&_h1]:text-2xl [&_h1]:font-medium [&_h1]:leading-tight [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-medium [&_h2]:leading-tight [&_hr]:my-8 [&_hr]:border-border [&_li]:my-2 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_p]:my-4 [&_strong]:font-medium [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            </CardContent>
          </Card>
        ) : fallbackText ? (
          <Card variant="work">
            <CardHeader>
              <CardTitle><h2>简报正文</h2></CardTitle>
            </CardHeader>
            <CardContent>
              <pre className="mx-auto max-w-[72ch] whitespace-pre-wrap break-words font-sans text-base leading-7">
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
              <CardTitle><h2>简报内情报（{briefing.events.length}）</h2></CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="grid gap-1">
                {briefing.events.map((event) => (
                  <li key={event.eventId}>
                    <Link
                      href={`/events/${event.eventId}`}
                      className="grid min-h-11 min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-x-2 gap-y-1 rounded-[12px] px-3 py-2 text-sm text-primary hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:grid-cols-[auto_minmax(0,1fr)_auto]"
                    >
                      <ExternalLink aria-hidden="true" size={14} />
                      <span className="min-w-0 [overflow-wrap:anywhere] font-medium">
                        {event.title}
                      </span>
                      {event.occurredAt ? (
                        <span className="col-start-2 text-xs tabular-nums text-muted-foreground sm:col-start-3">
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
