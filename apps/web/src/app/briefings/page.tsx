import { ArrowLeft, BookOpen, Download, FileText } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { getBriefingsPage } from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

interface BriefingsPageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function BriefingsPage({ searchParams }: BriefingsPageProps) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const periodFilter = readPeriod(resolvedSearchParams.period);
  const briefingPage = await getBriefingsPage(
    readPage(resolvedSearchParams.page),
    20,
    periodFilter,
  );

  return (
    <>
      <PageHeader eyebrow="简报中心" title="情报简报">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">
            <ArrowLeft aria-hidden="true" size={14} />
            返回情报流
          </Link>
        </Button>
      </PageHeader>

      <div>
        <Card variant="work">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <CardTitle>历史简报 · {briefingPage.total}</CardTitle>
              <div
                aria-label="简报周期筛选"
                className="inline-flex w-fit items-center justify-center gap-1 rounded-full bg-muted p-1"
              >
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-transparent px-4 py-1 text-sm font-medium text-muted-foreground transition-colors duration-300 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-primary/5 hover:text-foreground data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-sm"
                  data-active={(!periodFilter).toString()}
                  href="/briefings"
                >
                  全部
                </Link>
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-transparent px-4 py-1 text-sm font-medium text-muted-foreground transition-colors duration-300 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-primary/5 hover:text-foreground data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-sm"
                  data-active={(periodFilter === "DAILY").toString()}
                  href="/briefings?period=DAILY"
                >
                  每日
                </Link>
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-transparent px-4 py-1 text-sm font-medium text-muted-foreground transition-colors duration-300 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-primary/5 hover:text-foreground data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-sm"
                  data-active={(periodFilter === "WEEKLY").toString()}
                  href="/briefings?period=WEEKLY"
                >
                  每周
                </Link>
                <Link
                  className="inline-flex min-h-11 items-center justify-center rounded-full border border-transparent px-4 py-1 text-sm font-medium text-muted-foreground transition-colors duration-300 ease-[cubic-bezier(0.2,0,0,1)] hover:bg-primary/5 hover:text-foreground data-[active=true]:bg-background data-[active=true]:text-foreground data-[active=true]:shadow-sm"
                  data-active={(periodFilter === "MONTHLY").toString()}
                  href="/briefings?period=MONTHLY"
                >
                  每月
                </Link>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {briefingPage.briefings.length === 0 ? (
              <EmptyState
                description="生成简报后会出现在这里。Worker 完成分析周期后自动生成每日、每周和每月简报。"
                icon={<FileText aria-hidden="true" size={18} />}
                title="暂无简报"
              />
            ) : (
              <div className="divide-y divide-border">
                {briefingPage.briefings.map((briefing) => (
                  <article
                    className="grid grid-cols-1 items-center gap-3 py-5 transition-colors hover:bg-primary/5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,1fr)_auto]"
                    key={briefing.briefingId}
                  >
                    <div className="min-w-0">
                      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge variant="outline">{periodLabel(briefing.period)}</Badge>
                        <h3 className="m-0 min-w-0 text-base font-medium leading-snug">
                          <Link
                            className="inline-flex min-h-11 min-w-0 items-center [overflow-wrap:anywhere] transition-colors hover:text-primary"
                            href={`/briefings/${briefing.briefingId}`}
                          >
                            {briefing.title}
                          </Link>
                        </h3>
                      </div>
                      <p className="m-0 text-sm leading-relaxed text-muted-foreground">
                        <span className="font-medium text-foreground">{briefing.topicName}</span>
                        {" · "}
                        {formatDateRange(briefing.rangeStart, briefing.rangeEnd)}
                        {" · "}
                        生成于 {formatDateTime(briefing.generatedAt)}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                      <Button asChild className="w-full" size="sm" variant="secondary">
                        <Link href={`/briefings/${briefing.briefingId}`}>
                          <BookOpen aria-hidden="true" size={14} />
                          阅读
                        </Link>
                      </Button>
                      <Button asChild className="w-full" size="sm" variant="ghost">
                        <a href={`/exports/briefings/${briefing.briefingId}`}>
                          <Download aria-hidden="true" size={14} />
                          Markdown
                        </a>
                      </Button>
                    </div>
                  </article>
                ))}
              </div>
            )}
            {briefingPage.total > 0 ? (
              <nav
                aria-label="简报分页"
                className="mt-4 flex min-h-11 items-center justify-between gap-3 border-t border-border pt-3 text-sm text-muted-foreground"
              >
                <span className="font-medium tabular-nums">
                  第 {briefingPage.page} / {briefingPage.pageCount} 页
                </span>
                <div className="flex flex-wrap justify-end gap-2">
                  {briefingPage.page > 1 ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={briefingPageHref(briefingPage.page - 1, periodFilter)}>上一页</Link>
                    </Button>
                  ) : null}
                  {briefingPage.page < briefingPage.pageCount ? (
                    <Button asChild size="sm" variant="ghost">
                      <Link href={briefingPageHref(briefingPage.page + 1, periodFilter)}>下一页</Link>
                    </Button>
                  ) : null}
                </div>
              </nav>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function readPage(value: string | string[] | undefined): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const page = Number.parseInt(rawValue ?? "1", 10);
  return Number.isFinite(page) && page > 0 ? page : 1;
}

function readPeriod(value: string | string[] | undefined): "DAILY" | "WEEKLY" | "MONTHLY" | undefined {
  const rawValue = Array.isArray(value) ? value[0] : value;
  if (rawValue === "DAILY" || rawValue === "WEEKLY" || rawValue === "MONTHLY") {
    return rawValue;
  }
  return undefined;
}

function briefingPageHref(page: number, period?: "DAILY" | "WEEKLY" | "MONTHLY"): string {
  const params = new URLSearchParams();
  if (page > 1) params.set("page", String(page));
  if (period) params.set("period", period);
  const qs = params.toString();
  return qs ? `/briefings?${qs}` : "/briefings";
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
