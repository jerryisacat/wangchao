import { ArrowLeft, CircleAlert, FileSearch, Loader2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { getReportDetail } from "@/lib/report-data";
import { renderBriefingMarkdown } from "@/lib/briefing-markdown";

export const dynamic = "force-dynamic";

interface ReportDetailPageProps {
  params:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function ReportDetailPage({ params }: ReportDetailPageProps) {
  const resolvedParams = await Promise.resolve(params);
  const reportId = readParam(resolvedParams.reportId);
  const report = await getReportDetail(reportId);

  if (!report) {
    return (
      <>
        <PageHeader eyebrow="专题报告" title="报告不存在">
          <Button asChild size="sm" variant="ghost">
            <Link href="/reports">
              <ArrowLeft aria-hidden="true" size={14} />
              返回报告列表
            </Link>
          </Button>
        </PageHeader>
        <Card variant="work">
          <CardContent>
            <EmptyState
              description="该报告可能已被删除或尚未生成。"
              icon={<FileSearch aria-hidden="true" size={18} />}
              title="报告未找到"
            />
          </CardContent>
        </Card>
      </>
    );
  }

  const isProcessing = report.status === "PENDING" || report.status === "GENERATING";
  const renderedHtml = report.markdown ? renderBriefingMarkdown(report.markdown) : "";

  return (
    <>
      <PageHeader eyebrow="专题报告" title={report.question}>
        <Button asChild size="sm" variant="ghost">
          <Link href="/reports">
            <ArrowLeft aria-hidden="true" size={14} />
            返回报告列表
          </Link>
        </Button>
      </PageHeader>

      {isProcessing ? (
        <StatusBanner
          icon={<Loader2 aria-hidden="true" className="animate-spin" size={16} />}
          message="报告正在生成中，请稍后刷新页面查看。"
          tone="info"
        />
      ) : null}
      {report.status === "INSUFFICIENT_DATA" ? (
        <Card variant="work">
          <CardContent>
            <div className="flex flex-col gap-3">
              <div className="flex items-start gap-2">
                <CircleAlert aria-hidden="true" className="mt-0.5 shrink-0 text-warning" size={16} />
                <div className="flex flex-col gap-2">
                  <p className="text-sm font-medium text-foreground">情报库覆盖不足，未能生成完整报告。</p>
                  {report.coverageNote ? (
                    <p className="text-xs text-muted-foreground">{report.coverageNote}</p>
                  ) : null}
                </div>
              </div>
              <div className="flex flex-col gap-2 border-t border-warning/30 pt-3">
                <p className="text-xs font-medium text-muted-foreground">下一步建议</p>
                <ul className="ml-4 list-disc text-xs text-muted-foreground">
                  <li>创建更精准的关注主题，覆盖该问题涉及的方向。</li>
                  <li>为相关主题补充更多信源，提升情报库覆盖面。</li>
                  <li>等待后续抓取周期积累更多信息后重新生成。</li>
                </ul>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Button asChild size="sm" variant="outline">
                    <Link href="/topics/new">创建主题</Link>
                  </Button>
                  <Button asChild size="sm" variant="ghost">
                    <Link href="/reports">返回报告列表</Link>
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}
      {report.status === "FAILED" ? (
        <StatusBanner
          icon={<CircleAlert aria-hidden="true" size={16} />}
          message={report.errorMessage ?? "报告生成失败。"}
          tone="error"
        />
      ) : null}

      <div className="grid gap-3">
        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <span className="flex items-center gap-2">
                <ReportStatusBadge status={report.status} />
                {report.generatedAt ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    生成于 {formatDate(new Date(report.generatedAt))}
                  </span>
                ) : null}
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-[16px] bg-muted p-3">
                <dt className="text-sm text-muted-foreground">事件数</dt>
                <dd className="mt-1 text-lg font-medium tabular-nums text-foreground">{report.eventCount}</dd>
              </div>
              {report.itemCount > 0 ? (
                <div className="rounded-[16px] bg-muted p-3">
                  <dt className="text-sm text-muted-foreground">情报正文</dt>
                  <dd className="mt-1 text-lg font-medium tabular-nums text-foreground">{report.itemCount}</dd>
                </div>
              ) : null}
              {report.topicIds.length > 0 ? (
                <div className="rounded-[16px] bg-muted p-3">
                  <dt className="text-sm text-muted-foreground">涉及主题</dt>
                  <dd className="mt-1 text-lg font-medium tabular-nums text-foreground">{report.topicIds.length}</dd>
                </div>
              ) : null}
              {report.sourceIds.length > 0 ? (
                <div className="rounded-[16px] bg-muted p-3">
                  <dt className="text-sm text-muted-foreground">涉及信源</dt>
                  <dd className="mt-1 text-lg font-medium tabular-nums text-foreground">{report.sourceIds.length}</dd>
                </div>
              ) : null}
              {report.coverageNote ? (
                <div className="col-span-2 rounded-[16px] border border-border p-3 sm:col-span-4">
                  <dt className="text-sm font-medium text-foreground">覆盖说明</dt>
                  <dd className="mt-1 text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">{report.coverageNote}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        {renderedHtml ? (
          <Card variant="work">
            <CardHeader>
              <CardTitle><h2>报告正文</h2></CardTitle>
            </CardHeader>
            <CardContent>
              <div
                className="mx-auto min-w-0 max-w-[72ch] [overflow-wrap:anywhere] text-base leading-7 text-foreground [&_a]:inline-flex [&_a]:min-h-11 [&_a]:max-w-full [&_a]:items-center [&_a]:font-medium [&_a]:text-primary [&_a]:underline [&_a]:underline-offset-4 [&_h1]:mb-5 [&_h1]:mt-2 [&_h1]:text-2xl [&_h1]:font-medium [&_h1]:leading-tight [&_h2]:mb-3 [&_h2]:mt-8 [&_h2]:text-xl [&_h2]:font-medium [&_h2]:leading-tight [&_hr]:my-8 [&_hr]:border-border [&_li]:my-2 [&_ol]:my-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6 [&_p]:my-4 [&_strong]:font-medium [&_ul]:my-3 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6"
                dangerouslySetInnerHTML={{ __html: renderedHtml }}
              />
            </CardContent>
          </Card>
        ) : null}
      </div>
    </>
  );
}

function ReportStatusBadge({ status }: { status: string }) {
  switch (status) {
    case "COMPLETED":
      return <Badge variant="success">已完成</Badge>;
    case "GENERATING":
      return <Badge variant="accent">生成中</Badge>;
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
  return typeof rawValue === "string" ? rawValue.trim() : "";
}

function formatDate(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hours}:${minutes}`;
}
