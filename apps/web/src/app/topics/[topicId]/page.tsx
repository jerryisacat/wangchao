import {
  Archive,
  ArrowLeft,
  Check,
  CircleAlert,
  Clock3,
  Download,
  FileText,
  Pause,
  Play,
  Rss,
  Sparkles,
} from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { updateTopicStatusAction, updateDashboardEventStateAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { DeleteTopicButton } from "@/components/topics/delete-topic-button";
import { TopicDashboardView } from "@/components/intelligence/topic-dashboard-view";
import { getTopicDashboardData } from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

interface TopicDetailPageProps {
  params: Promise<{ topicId: string }> | { topicId: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function TopicDetailPage({
  params,
  searchParams,
}: TopicDetailPageProps) {
  const { topicId } = await Promise.resolve(params);
  const resolvedSearchParams = (await Promise.resolve(searchParams ?? {})) as Record<string, string | string[] | undefined>;
  const notice = readStringValue(resolvedSearchParams.notice);
  const actionError = readStringValue(resolvedSearchParams.error);

  if (!process.env.DATABASE_URL) {
    return (
      <StatusBanner
        icon={<CircleAlert aria-hidden="true" size={16} />}
        message="DATABASE_URL is not configured."
        tone="error"
      />
    );
  }

  // Issue #185 (Plan Task 4.7) — 每主题一体化 Dashboard。
  // SPEC §5.8：每主题一个页面，展示未读 Top 情报、已读/收藏、趋势、信源状态。
  const dashboard = await getTopicDashboardData(topicId);

  if (!dashboard) {
    notFound();
  }

  const topic = dashboard.topic;

  return (
    <>
      <PageHeader eyebrow="主题工作台" title={topic.name}>
        <Button asChild size="sm" variant="ghost">
          <Link href="/topics">
            <ArrowLeft aria-hidden="true" size={14} />
            <span>主题列表</span>
          </Link>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href={`/topics/${topic.id}/edit`}>编辑</Link>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href={`/topics/${topic.id}/timeline`}>
            <Clock3 aria-hidden="true" size={14} />
            <span>时间线</span>
          </Link>
        </Button>
        <Button asChild size="sm" variant="secondary">
          <Link href={`/exports/topics/${topic.id}`}>
            <Download aria-hidden="true" size={14} />
            <span>批量导出</span>
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

      {/* Topic status & stats card */}
      <Card className="gap-5" variant="work">
        <CardContent className="grid gap-5">
          <div className="flex flex-wrap items-center gap-2">
            <TopicStatusBadge status={topic.status} />
            {topic.status === "ACTIVE" ? (
              <form action={updateTopicStatusAction}>
                <input type="hidden" name="topicId" value={topic.id} />
                <input type="hidden" name="statusAction" value="pause" />
                <Button type="submit" size="sm" variant="secondary">
                  <Pause aria-hidden="true" size={14} />
                  <span>暂停抓取</span>
                </Button>
              </form>
            ) : null}
            {topic.status === "PAUSED" ? (
              <form action={updateTopicStatusAction}>
                <input type="hidden" name="topicId" value={topic.id} />
                <input type="hidden" name="statusAction" value="resume" />
                <Button type="submit" size="sm" variant="primary">
                  <Play aria-hidden="true" size={14} />
                  <span>恢复抓取</span>
                </Button>
              </form>
            ) : null}
            {topic.status !== "ARCHIVED" ? (
              <form action={updateTopicStatusAction}>
                <input type="hidden" name="topicId" value={topic.id} />
                <input type="hidden" name="statusAction" value="archive" />
                <Button type="submit" size="sm" variant="ghost">
                  <Archive aria-hidden="true" size={14} />
                  <span>归档</span>
                </Button>
              </form>
            ) : null}
            {topic.status === "ARCHIVED" ? (
              <form action={updateTopicStatusAction}>
                <input type="hidden" name="topicId" value={topic.id} />
                <input type="hidden" name="statusAction" value="restore" />
                <Button type="submit" size="sm" variant="primary">
                  <Play aria-hidden="true" size={14} />
                  <span>恢复</span>
                </Button>
              </form>
            ) : null}
            <DeleteTopicButton topicId={topic.id} topicName={topic.name} />
          </div>

          {topic.description ? (
            <p className="max-w-[72ch] text-base leading-relaxed text-foreground">
              {topic.description}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <TopicStat icon={<Rss aria-hidden="true" size={16} />} label="信源" value={topic.sourceCount} />
            <TopicStat icon={<Sparkles aria-hidden="true" size={16} />} label="情报事件" value={topic.eventCount} />
            <TopicStat icon={<FileText aria-hidden="true" size={16} />} label="简报" value={topic.briefingCount} />
            <TopicStat
              icon={<Clock3 aria-hidden="true" size={16} />}
              label="最后更新"
              value={new Date(topic.updatedAt).toLocaleDateString("zh-CN")}
            />
          </div>
        </CardContent>
      </Card>

      {/* Issue #185: 一体化 Dashboard 视图 */}
      <TopicDashboardView
        dashboard={dashboard}
        eventStateAction={updateDashboardEventStateAction}
      />
    </>
  );
}

function TopicStat({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: ReactNode;
}) {
  return (
    <div className="min-w-0 rounded-[16px] bg-muted p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        {icon}
        <span>{label}</span>
      </div>
      <div className="mt-2 min-w-0 break-words text-lg font-medium leading-tight tabular-nums">
        {value}
      </div>
    </div>
  );
}

function TopicStatusBadge({ status }: { status: "ACTIVE" | "PAUSED" | "ARCHIVED" }) {
  if (status === "ACTIVE") {
    return <Badge variant="success">活跃</Badge>;
  }
  if (status === "PAUSED") {
    return <Badge variant="warning">已暂停</Badge>;
  }
  return <Badge variant="muted">已归档</Badge>;
}

function readStringValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}
