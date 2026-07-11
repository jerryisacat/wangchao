import { CircleAlert, FileSearch, Loader2 } from "lucide-react";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { getReportDetail } from "@/lib/report-data";

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
            <Link href="/reports">← 返回报告列表</Link>
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

  return (
    <>
      <PageHeader eyebrow="专题报告" title={report.question}>
        <Button asChild size="sm" variant="ghost">
          <Link href="/reports">← 返回报告列表</Link>
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
        <StatusBanner
          icon={<CircleAlert aria-hidden="true" size={16} />}
          message={report.coverageNote ?? "情报库覆盖不足。"}
          tone="warning"
        />
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
            <dl className="grid gap-1.5 text-xs">
              <div className="flex gap-2">
                <dt className="w-20 shrink-0 text-muted-foreground">事件数</dt>
                <dd className="text-muted-foreground">{report.eventCount}</dd>
              </div>
              {report.topicIds.length > 0 ? (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-muted-foreground">涉及主题</dt>
                  <dd className="text-muted-foreground">{report.topicIds.length}</dd>
                </div>
              ) : null}
              {report.sourceIds.length > 0 ? (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-muted-foreground">涉及信源</dt>
                  <dd className="text-muted-foreground">{report.sourceIds.length}</dd>
                </div>
              ) : null}
              {report.coverageNote ? (
                <div className="flex gap-2">
                  <dt className="w-20 shrink-0 text-muted-foreground">覆盖说明</dt>
                  <dd className="text-muted-foreground">{report.coverageNote}</dd>
                </div>
              ) : null}
            </dl>
          </CardContent>
        </Card>

        {report.markdown ? (
          <Card variant="work">
            <CardHeader>
              <CardTitle>报告内容</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="report-content">
                <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                  {report.markdown}
                </pre>
              </div>
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
