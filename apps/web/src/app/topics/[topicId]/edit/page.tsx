import { ArrowLeft, Check, CircleAlert, Sparkles } from "lucide-react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { updateTopicAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
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
  const { buildTopicProfileContext, DEFAULT_LANGUAGE_PREFERENCES, DEFAULT_DIGEST_STYLE } = await import("@wangchao/core");
  const profile = buildTopicProfileContext(topic.profile, {
    description: topic.description,
    name: topic.name,
  });
  const lang = profile.languagePreferences ?? DEFAULT_LANGUAGE_PREFERENCES;
  const digest = profile.digestStyle ?? DEFAULT_DIGEST_STYLE;

  return (
    <>
      <PageHeader eyebrow="调整观察范围与输出偏好" title="编辑主题">
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

      <Card variant="work" className="px-5 pb-5">
          <form action={updateTopicAction} className="grid gap-3">
            <input type="hidden" name="topicId" value={topic.id} />
            <input
              type="hidden"
              name="returnTo"
              value={`/topics/${topic.id}`}
            />
            <div className="grid gap-2">
              <Label htmlFor="topicName" className="text-xs font-extrabold text-muted-foreground">主题名称</Label>
              <Input
                id="topicName"
                name="topicName"
                defaultValue={topic.name}
                maxLength={120}
                placeholder="我想关注 AI 基础设施"
                required
                className="min-h-16 min-w-0 border-2 text-[clamp(1.25rem,3vw,2rem)] font-black"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="topicDescription" className="text-xs font-extrabold text-muted-foreground">主题描述</Label>
              <Textarea
                id="topicDescription"
                name="topicDescription"
                defaultValue={topic.description ?? ""}
                maxLength={2_000}
                placeholder="关注 AI 基础设施、模型供应商、Agent 平台和部署生态。"
                rows={3}
              />
            </div>
            <div className="grid gap-3 mt-1.5 border-t border-border pt-[18px]">
              <div className="grid gap-1">
                <strong className="text-[15px]">主题画像</strong>
                <span className="text-xs leading-[1.5] text-muted-foreground">
                  关键词用于信源发现；关键词、实体和覆盖/排除范围进入规则与 AI
                  筛选；重要性规则由 AI 用于评分。
                </span>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="topicKeywords" className="text-xs font-extrabold text-muted-foreground">关键词（必填，每行或逗号分隔）</Label>
                <Textarea
                  id="topicKeywords"
                  defaultValue={profile.keywords.join("\n")}
                  maxLength={5_000}
                  name="topicKeywords"
                  required
                  rows={4}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="topicEntities" className="text-xs font-extrabold text-muted-foreground">关键实体（每行或逗号分隔）</Label>
                <Textarea
                  id="topicEntities"
                  defaultValue={profile.entities.join("\n")}
                  maxLength={5_000}
                  name="topicEntities"
                  rows={3}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="topicIncludeScope" className="text-xs font-extrabold text-muted-foreground">应覆盖范围（每行一项）</Label>
                <Textarea
                  id="topicIncludeScope"
                  defaultValue={profile.includeScope.join("\n")}
                  maxLength={5_000}
                  name="topicIncludeScope"
                  rows={4}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="topicExcludeScope" className="text-xs font-extrabold text-muted-foreground">应排除范围（每行一项）</Label>
                <Textarea
                  id="topicExcludeScope"
                  defaultValue={profile.excludeScope.join("\n")}
                  maxLength={5_000}
                  name="topicExcludeScope"
                  rows={4}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="topicImportanceRules" className="text-xs font-extrabold text-muted-foreground">重要性规则（每行一项）</Label>
                <Textarea
                  id="topicImportanceRules"
                  defaultValue={profile.importanceRules.join("\n")}
                  maxLength={5_000}
                  name="topicImportanceRules"
                  rows={5}
                />
              </div>
            </div>
            <div className="grid gap-3 mt-1.5 border-t border-border pt-[18px]">
              <div className="grid gap-1">
                <strong className="text-[15px]">语言与简报偏好</strong>
                <span className="text-xs leading-[1.5] text-muted-foreground">
                  摘要当前使用简体中文；术语规则影响 AI 摘要生成，简报风格控制日报结构和详细程度。
                </span>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="topicSummaryLanguage" className="text-xs font-extrabold text-muted-foreground">摘要语言</Label>
                <Input
                  id="topicSummaryLanguage"
                  aria-describedby="topic-summary-language-help"
                  readOnly
                  value="简体中文"
                />
                <small id="topic-summary-language-help" className="text-xs text-muted-foreground">
                  完成 i18n 适配后，摘要将自动跟随界面语言。
                </small>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="topicTerminologyRules" className="text-xs font-extrabold text-muted-foreground">术语规则（每行一项）</Label>
                <Textarea
                  id="topicTerminologyRules"
                  defaultValue={lang.terminologyRules.join("\n")}
                  maxLength={2_000}
                  name="topicTerminologyRules"
                  placeholder="例如：OpenAI 不译、LLM 保留英文"
                  rows={3}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="topicDigestStructure" className="text-xs font-extrabold text-muted-foreground">简报结构</Label>
                <select id="topicDigestStructure" defaultValue={digest.structure} name="topicDigestStructure" className="h-14 w-full min-w-0 rounded-t-[12px] border-0 border-b-2 border-outline bg-muted px-4 text-base text-foreground outline-none transition-[border-color] duration-200 focus-visible:border-primary">
                  <option value="standard">标准（摘要 + 事件 + 偏好 + 跟进）</option>
                  <option value="detailed">详尽（含 Executive Summary）</option>
                  <option value="compact">紧凑（仅事件列表 + 跟进）</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="topicDigestDetailLevel" className="text-xs font-extrabold text-muted-foreground">详细程度</Label>
                <select id="topicDigestDetailLevel" defaultValue={digest.detailLevel} name="topicDigestDetailLevel" className="h-14 w-full min-w-0 rounded-t-[12px] border-0 border-b-2 border-outline bg-muted px-4 text-base text-foreground outline-none transition-[border-color] duration-200 focus-visible:border-primary">
                  <option value="standard">标准</option>
                  <option value="comprehensive">全面</option>
                  <option value="brief">简略</option>
                </select>
              </div>
              <div className="grid gap-2">
                <Label htmlFor="topicDigestMaxEvents" className="text-xs font-extrabold text-muted-foreground">最大事件数</Label>
                <Input
                  id="topicDigestMaxEvents"
                  defaultValue={digest.maxEvents}
                  max={50}
                  min={1}
                  name="topicDigestMaxEvents"
                  type="number"
                />
              </div>
            </div>
            <div className="flex flex-col items-start gap-3 text-xs leading-[1.45] text-muted-foreground md:flex-row md:items-center md:justify-between">
              <span>
                保存后，新抓取内容会使用更新后的画像；已有历史事件不会被重写。
              </span>
              <Button type="submit" variant="primary">
                <Sparkles aria-hidden="true" size={16} />
                保存修改
              </Button>
            </div>
          </form>
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
