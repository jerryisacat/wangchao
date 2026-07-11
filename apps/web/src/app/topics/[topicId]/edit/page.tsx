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
  const { buildTopicProfileContext, DEFAULT_LANGUAGE_PREFERENCES, DEFAULT_DIGEST_STYLE } = await import("@wangchao/core");
  const profile = buildTopicProfileContext(topic.profile, {
    description: topic.description,
    name: topic.name,
  });
  const lang = profile.languagePreferences ?? DEFAULT_LANGUAGE_PREFERENCES;
  const digest = profile.digestStyle ?? DEFAULT_DIGEST_STYLE;

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
                maxLength={120}
                placeholder="我想关注 AI 基础设施"
                required
              />
            </label>
            <label>
              <span>主题描述</span>
              <textarea
                name="topicDescription"
                defaultValue={topic.description ?? ""}
                maxLength={2_000}
                placeholder="关注 AI 基础设施、模型供应商、Agent 平台和部署生态。"
                rows={3}
              />
            </label>
            <div className="topic-profile-fields">
              <div className="topic-profile-heading">
                <strong>主题画像</strong>
                <span>
                  关键词用于信源发现；关键词、实体和覆盖/排除范围进入规则与 AI
                  筛选；重要性规则由 AI 用于评分。
                </span>
              </div>
              <label>
                <span>关键词（必填，每行或逗号分隔）</span>
                <textarea
                  defaultValue={profile.keywords.join("\n")}
                  maxLength={5_000}
                  name="topicKeywords"
                  required
                  rows={4}
                />
              </label>
              <label>
                <span>关键实体（每行或逗号分隔）</span>
                <textarea
                  defaultValue={profile.entities.join("\n")}
                  maxLength={5_000}
                  name="topicEntities"
                  rows={3}
                />
              </label>
              <label>
                <span>应覆盖范围（每行一项）</span>
                <textarea
                  defaultValue={profile.includeScope.join("\n")}
                  maxLength={5_000}
                  name="topicIncludeScope"
                  rows={4}
                />
              </label>
              <label>
                <span>应排除范围（每行一项）</span>
                <textarea
                  defaultValue={profile.excludeScope.join("\n")}
                  maxLength={5_000}
                  name="topicExcludeScope"
                  rows={4}
                />
              </label>
              <label>
                <span>重要性规则（每行一项）</span>
                <textarea
                  defaultValue={profile.importanceRules.join("\n")}
                  maxLength={5_000}
                  name="topicImportanceRules"
                  rows={5}
                />
              </label>
            </div>
            <div className="topic-profile-fields">
              <div className="topic-profile-heading">
                <strong>语言与简报偏好</strong>
                <span>
                  输出语言和术语规则影响 AI 摘要生成；简报风格控制日报结构和详细程度。
                </span>
              </div>
              <label>
                <span>输出语言</span>
                <select className="topic-select" defaultValue={lang.outputLanguage} name="topicOutputLanguage">
                  <option value="zh-CN">简体中文</option>
                  <option value="en">English</option>
                </select>
              </label>
              <label>
                <span>术语规则（每行一项）</span>
                <textarea
                  defaultValue={lang.terminologyRules.join("\n")}
                  maxLength={2_000}
                  name="topicTerminologyRules"
                  placeholder="例如：OpenAI 不译、LLM 保留英文"
                  rows={3}
                />
              </label>
              <label>
                <span>简报结构</span>
                <select className="topic-select" defaultValue={digest.structure} name="topicDigestStructure">
                  <option value="standard">标准（摘要 + 事件 + 偏好 + 跟进）</option>
                  <option value="detailed">详尽（含 Executive Summary）</option>
                  <option value="compact">紧凑（仅事件列表 + 跟进）</option>
                </select>
              </label>
              <label>
                <span>详细程度</span>
                <select className="topic-select" defaultValue={digest.detailLevel} name="topicDigestDetailLevel">
                  <option value="standard">标准</option>
                  <option value="comprehensive">全面</option>
                  <option value="brief">简略</option>
                </select>
              </label>
              <label>
                <span>最大事件数</span>
                <input
                  className="topic-number-input"
                  defaultValue={digest.maxEvents}
                  max={50}
                  min={1}
                  name="topicDigestMaxEvents"
                  type="number"
                />
              </label>
            </div>
            <div className="form-actions">
              <span>
                保存后，新抓取内容会使用更新后的画像；已有历史事件不会被重写。
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
