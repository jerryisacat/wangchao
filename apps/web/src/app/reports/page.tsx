import { ArrowLeft, ChevronLeft, ChevronRight, CircleAlert, Check, FileSearch, Loader2 } from "lucide-react";
import Link from "next/link";
import { createReportAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { Textarea } from "@/components/ui/textarea";
import { getReportsPage } from "@/lib/report-data";

export const dynamic = "force-dynamic";

interface ReportsPageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function ReportsPage({ searchParams }: ReportsPageProps) {
  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const page = readPageParam(resolvedSearchParams.page);
  const notice = readParam(resolvedSearchParams.notice);
  const actionError = readParam(resolvedSearchParams.error);

  const data = await getReportsPage(page, 20);

  return (
    <>
      <PageHeader eyebrow="按需分析" title="专题报告">
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

      <StatusBanner
        icon={<FileSearch aria-hidden="true" size={16} />}
        message="基于情报库已有事件生成结构化专题报告。报告只使用已入库信息，不做全网搜索。"
        tone="info"
      />

      <Card variant="work">
        <CardHeader>
          <CardTitle>提交新问题</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={createReportAction} className="grid gap-3">
            <Textarea
              aria-label="问题"
              name="reportQuestion"
              placeholder="用自然语言提出一个你想了解的问题，例如：美伊战争现在怎么样了？"
              rows={3}
              maxLength={500}
              required
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                报告生成是异步任务，提交后可在下方查看进度。
              </span>
              <Button size="sm" type="submit" variant="primary">
                <FileSearch aria-hidden="true" size={14} />
                生成报告
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <div>
        <Card variant="work">
          <CardHeader>
            <CardTitle>历史报告</CardTitle>
          </CardHeader>
          <CardContent>
            {data.reports.length === 0 ? (
              <EmptyState
                description="提交一个问题，系统将基于情报库已有事件生成专题报告。"
                icon={<FileSearch aria-hidden="true" size={18} />}
                title="暂无报告"
              />
            ) : (
              <div className="divide-y divide-border">
                {data.reports.map((report) => (
                  <article
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 py-4 transition-colors first:pt-0 last:pb-0"
                    key={report.id}
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <Link
                          className="text-base font-medium text-foreground hover:text-primary hover:underline"
                          href={`/reports/${report.id}`}
                        >
                          {report.question}
                        </Link>
                        <ReportStatusBadge status={report.status} />
                      </div>
                      {report.summary ? (
                        <p className="mt-1 text-sm text-muted-foreground">
                          {report.summary.slice(0, 150)}
                        </p>
                      ) : null}
                      <p className="mt-1 text-xs text-muted-foreground">
                        {formatDate(new Date(report.createdAt))}
                        {report.generatedAt ? ` · 生成于 ${formatDate(new Date(report.generatedAt))}` : ""}
                        {report.eventCount > 0 ? ` · ${report.eventCount} 条事件` : ""}
                      </p>
                    </div>
                    <Button asChild size="sm" variant="ghost">
                      <Link href={`/reports/${report.id}`}>查看</Link>
                    </Button>
                  </article>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {data.pageCount > 1 ? (
        <nav
          aria-label="分页"
          className="mt-4 flex min-h-11 items-center justify-between gap-3 border-t border-border pt-3 text-sm text-muted-foreground"
        >
          {page > 1 ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/reports?page=${page - 1}`}>
                <ChevronLeft aria-hidden="true" size={14} />
                上一页
              </Link>
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled aria-disabled="true">
              <ChevronLeft aria-hidden="true" size={14} />
              上一页
            </Button>
          )}
          <span className="font-medium tabular-nums">
            {data.page} / {data.pageCount}
          </span>
          {page < data.pageCount ? (
            <Button asChild size="sm" variant="ghost">
              <Link href={`/reports?page=${page + 1}`}>
                下一页
                <ChevronRight aria-hidden="true" size={14} />
              </Link>
            </Button>
          ) : (
            <Button size="sm" variant="ghost" disabled aria-disabled="true">
              下一页
              <ChevronRight aria-hidden="true" size={14} />
            </Button>
          )}
        </nav>
      ) : null}
    </>
  );
}

function ReportStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "COMPLETED":
      return <Badge variant="success">已完成</Badge>;
    case "GENERATING":
      return (
        <Badge variant="accent">
          <Loader2 aria-hidden="true" className="animate-spin" size={10} />
          生成中
        </Badge>
      );
    case "PENDING":
      return <Badge variant="muted">排队中</Badge>;
    case "FAILED":
      return <Badge variant="danger">失败</Badge>;
    case "INSUFFICIENT_DATA":
      return <Badge variant="warning">信息不足</Badge>;
    default:
      return <Badge variant="muted">{status}</Badge>;
  }
}

function readParam(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim().slice(0, 120) : "";
}

function readPageParam(value: string | string[] | undefined): number {
  const rawValue = Array.isArray(value) ? value[0] : value;
  const parsed = Number.parseInt(typeof rawValue === "string" ? rawValue : "1", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

function formatDate(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hours}:${minutes}`;
}
