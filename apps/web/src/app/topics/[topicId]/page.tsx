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
import { updateTopicStatusAction } from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { DeleteTopicButton } from "@/components/topics/delete-topic-button";

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

  const { getSessionWorkspace } = await import("@/lib/session");
  const { getTopicById, getPrismaClient } = await import(
    "@wangchao/db"
  );
  const prisma = getPrismaClient();
  const workspace = await getSessionWorkspace();
  const topic = await getTopicById(prisma, {
    organizationId: workspace.organizationId,
    topicId,
  });

  if (!topic) {
    notFound();
  }

  return (
    <>
      <PageHeader eyebrow="TOPIC DETAIL" title={topic.name}>
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

      <div className="grid gap-4">
        <Card className="grid gap-4 px-6" variant="kinetic">
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
            <p className="m-0 text-sm leading-[1.6] text-foreground [overflow-wrap:anywhere]">{topic.description}</p>
          ) : null}

          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="grid items-center gap-1 rounded-[16px] border border-border bg-muted p-4 text-center">
              <Rss aria-hidden="true" size={16} className="justify-self-center text-accent" />
              <span className="font-mono text-xl font-[950] tabular-nums text-foreground [overflow-wrap:anywhere]">{topic.sourceCount}</span>
              <span className="text-[11px] font-bold uppercase text-muted-foreground">信源</span>
            </div>
            <div className="grid items-center gap-1 rounded-[16px] border border-border bg-muted p-4 text-center">
              <Sparkles aria-hidden="true" size={16} className="justify-self-center text-accent" />
              <span className="font-mono text-xl font-[950] tabular-nums text-foreground [overflow-wrap:anywhere]">{topic.eventCount}</span>
              <span className="text-[11px] font-bold uppercase text-muted-foreground">情报事件</span>
            </div>
            <div className="grid items-center gap-1 rounded-[16px] border border-border bg-muted p-4 text-center">
              <FileText aria-hidden="true" size={16} className="justify-self-center text-accent" />
              <span className="font-mono text-xl font-[950] tabular-nums text-foreground [overflow-wrap:anywhere]">{topic.briefingCount}</span>
              <span className="text-[11px] font-bold uppercase text-muted-foreground">简报</span>
            </div>
            <div className="grid items-center gap-1 rounded-[16px] border border-border bg-muted p-4 text-center">
              <Clock3 aria-hidden="true" size={16} className="justify-self-center text-accent" />
              <span className="font-mono text-xl font-[950] tabular-nums text-foreground [overflow-wrap:anywhere]">
                {topic.updatedAt.toLocaleDateString("zh-CN")}
              </span>
              <span className="text-[11px] font-bold uppercase text-muted-foreground">最后更新</span>
            </div>
          </div>
        </Card>
      </div>
    </>
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
