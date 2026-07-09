import { ArrowLeft, Check, CircleAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateTopicAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";

export const dynamic = "force-dynamic";

interface TopicEditPageProps {
  params: Promise<{ topicId: string }> | { topicId: string };
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function TopicEditPage({
  params,
  searchParams,
}: TopicEditPageProps) {
  const { topicId } = await Promise.resolve(params);
  const resolvedSearchParams = (await Promise.resolve(searchParams ?? {})) as Record<string, string | string[] | undefined>;
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

  const { getTopicById, ensureDefaultWorkspace, getPrismaClient } = await import(
    "@wangchao/db"
  );
  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  const topic = await getTopicById(prisma, {
    organizationId: workspace.organizationId,
    topicId,
  });

  if (!topic) {
    notFound();
  }

  return (
    <>
      <PageHeader eyebrow="EDIT TOPIC" title="编辑主题">
        <Button asChild size="sm" variant="ghost">
          <Link href={`/topics/${topic.id}`}>
            <ArrowLeft aria-hidden="true" size={14} />
            <span>返回详情</span>
          </Link>
        </Button>
      </PageHeader>

      {actionError ? (
        <StatusBanner
          icon={<CircleAlert aria-hidden="true" size={16} />}
          message={actionError}
          tone="error"
        />
      ) : null}

      <Card className="topic-edit-card" variant="kinetic">
        <div style={{ position: "relative", zIndex: 1, padding: "24px 20px 20px" }}>
          <form action={updateTopicAction} className="topic-form">
            <input type="hidden" name="topicId" value={topic.id} />
            <input
              type="hidden"
              name="returnTo"
              value={`/topics/${topic.id}`}
            />
            <label>
              <span>主题名称</span>
              <input
                className="topic-name-input"
                name="topicName"
                defaultValue={topic.name}
                placeholder="我想关注 AI 基础设施"
                required
              />
            </label>
            <label>
              <span>主题描述</span>
              <textarea
                name="topicDescription"
                defaultValue={topic.description ?? ""}
                placeholder="关注 AI 基础设施、模型供应商、Agent 平台和部署生态。"
                rows={3}
              />
            </label>
            <div className="form-actions">
              <span>
                修改名称或描述后保存即可。主题关键词会根据新内容自动重新匹配。
              </span>
              <Button type="submit" variant="primary">
                <Sparkles aria-hidden="true" size={16} />
                保存修改
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </>
  );
}

function readStringValue(value: string | string[] | undefined): string {
  if (Array.isArray(value)) {
    return value[0] ?? "";
  }
  return value ?? "";
}
