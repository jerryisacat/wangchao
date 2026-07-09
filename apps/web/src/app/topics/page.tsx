import { Archive, Check, CircleAlert, Pause, Play, Plus } from "lucide-react";
import Link from "next/link";
import {
  updateTopicStatusAction,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { DeleteTopicButton } from "@/components/topics/delete-topic-button";

export const dynamic = "force-dynamic";

interface TopicsPageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function TopicsPage({ searchParams }: TopicsPageProps) {
  const { listAllTopics, ensureDefaultWorkspace, getPrismaClient } = await import(
    "@wangchao/db"
  );
  const resolvedSearchParams = (await Promise.resolve(searchParams ?? {})) as Record<string, string | string[] | undefined>;
  const notice = readStringValue(resolvedSearchParams.notice);
  const actionError = readStringValue(resolvedSearchParams.error);

  let topics: Awaited<ReturnType<typeof listAllTopics>> = [];
  let mode: "database" | "error" = "database";
  let errorMessage = "";

  try {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL is not configured.");
    }
    const prisma = getPrismaClient();
    const workspace = await ensureDefaultWorkspace(prisma);
    topics = await listAllTopics(prisma, {
      organizationId: workspace.organizationId,
    });
  } catch (error) {
    mode = "error";
    errorMessage = error instanceof Error ? error.message : "无法读取主题列表。";
  }

  return (
    <>
      <PageHeader eyebrow="TOPIC MANAGEMENT" title="主题管理">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">← 返回情报流</Link>
        </Button>
        <Button asChild size="sm" variant="primary">
          <Link href="/topics/new">
            <Plus aria-hidden="true" size={14} />
            <span>新建主题</span>
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

      {mode === "error" ? (
        <StatusBanner
          icon={<CircleAlert aria-hidden="true" size={16} />}
          message={errorMessage}
          tone="error"
        />
      ) : topics.length === 0 ? (
        <EmptyState
          icon={<Plus aria-hidden="true" size={24} />}
          title="还没有主题"
          description="创建一个观察主题，系统会自动生成关键词并匹配候选信源。"
        />
      ) : (
        <div className="topic-list">
          {topics.map((topic) => (
            <Card key={topic.id} className="topic-list-item" variant="kinetic">
              <div className="topic-list-item-main">
                <div className="topic-list-item-header">
                  <Link
                    href={`/topics/${topic.id}`}
                    className="topic-list-item-name"
                  >
                    {topic.name}
                  </Link>
                  <TopicStatusBadge status={topic.status} />
                </div>
                {topic.description ? (
                  <p className="topic-list-item-description">
                    {topic.description}
                  </p>
                ) : null}
                <div className="topic-list-item-meta">
                  <span>{topic.sourceCount} 个信源</span>
                  <span>{topic.eventCount} 条情报</span>
                  <span>更新于 {topic.updatedAt.toLocaleDateString("zh-CN")}</span>
                </div>
              </div>
              <div className="topic-list-item-actions">
                <Button asChild size="sm" variant="ghost">
                  <Link href={`/topics/${topic.id}/edit`}>编辑</Link>
                </Button>
                {topic.status === "ACTIVE" ? (
                  <form action={updateTopicStatusAction}>
                    <input type="hidden" name="topicId" value={topic.id} />
                    <input type="hidden" name="statusAction" value="pause" />
                    <Button type="submit" size="sm" variant="secondary">
                      <Pause aria-hidden="true" size={14} />
                      <span>暂停</span>
                    </Button>
                  </form>
                ) : null}
                {topic.status === "PAUSED" ? (
                  <form action={updateTopicStatusAction}>
                    <input type="hidden" name="topicId" value={topic.id} />
                    <input type="hidden" name="statusAction" value="resume" />
                    <Button type="submit" size="sm" variant="secondary">
                      <Play aria-hidden="true" size={14} />
                      <span>恢复</span>
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
                    <Button type="submit" size="sm" variant="secondary">
                      <Play aria-hidden="true" size={14} />
                      <span>恢复</span>
                    </Button>
                  </form>
                ) : null}
                <DeleteTopicButton topicId={topic.id} topicName={topic.name} />
              </div>
            </Card>
          ))}
        </div>
      )}
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
