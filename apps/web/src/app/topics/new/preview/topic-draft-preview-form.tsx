"use client";

import { useMemo, useState } from "react";
import { ArrowLeft, RefreshCw, Sparkles } from "lucide-react";
import Link from "next/link";
import { confirmCreateTopicAction, generateTopicDraftAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";

export interface TopicDraftPreviewInitial {
  schemaVersion: number;
  generationMode: "ai" | "rules";
  name: string;
  keywords: string[];
  entities: string[];
  includeScope: string[];
  excludeScope: string[];
  importanceRules: string[];
  languagePreferences: {
    outputLanguage: string;
    terminologyRules: string[];
  };
  digestStyle: {
    structure: "standard" | "detailed" | "compact";
    detailLevel: "brief" | "standard" | "comprehensive";
    maxEvents: number;
  };
}

function listToText(items: string[]): string {
  return items.join("\n");
}

function textToList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(/[\n,，]/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line.length <= 200),
    ),
  );
}

export function TopicDraftPreviewForm({
  initial,
  description,
}: {
  initial: TopicDraftPreviewInitial;
  description: string;
}) {
  const [name, setName] = useState(initial.name);
  const [descriptionValue, setDescriptionValue] = useState(description);
  const [keywords, setKeywords] = useState(listToText(initial.keywords));
  const [entities, setEntities] = useState(listToText(initial.entities));
  const [includeScope, setIncludeScope] = useState(listToText(initial.includeScope));
  const [excludeScope, setExcludeScope] = useState(listToText(initial.excludeScope));
  const [importanceRules, setImportanceRules] = useState(
    listToText(initial.importanceRules),
  );
  const [terminologyRules, setTerminologyRules] = useState(
    listToText(initial.languagePreferences.terminologyRules),
  );
  const [structure, setStructure] = useState(initial.digestStyle.structure);
  const [detailLevel, setDetailLevel] = useState(initial.digestStyle.detailLevel);
  const [maxEvents, setMaxEvents] = useState(initial.digestStyle.maxEvents);

  const draftJson = useMemo(
    () =>
      JSON.stringify({
        schemaVersion: initial.schemaVersion,
        name: name.trim(),
        keywords: textToList(keywords),
        entities: textToList(entities),
        includeScope: textToList(includeScope),
        excludeScope: textToList(excludeScope),
        importanceRules: textToList(importanceRules),
        languagePreferences: {
          outputLanguage: initial.languagePreferences.outputLanguage,
          terminologyRules: textToList(terminologyRules),
        },
        digestStyle: {
          structure,
          detailLevel,
          maxEvents: Math.max(1, Math.min(50, Number(maxEvents) || 10)),
        },
      }),
    [
      initial.schemaVersion,
      initial.languagePreferences.outputLanguage,
      name,
      keywords,
      entities,
      includeScope,
      excludeScope,
      importanceRules,
      terminologyRules,
      structure,
      detailLevel,
      maxEvents,
    ],
  );

  return (
    <>
      <PageHeader eyebrow="检查草案" title="确认主题画像">
        <Button asChild size="sm" variant="ghost">
          <Link href="/topics/new">
            <ArrowLeft aria-hidden="true" size={14} />
            <span>重新填写</span>
          </Link>
        </Button>
      </PageHeader>

      <StatusBanner
        icon={<Sparkles aria-hidden="true" size={16} />}
        message={
          initial.generationMode === "ai"
            ? "当前草案由 AI 基于自然语言目标生成，请核对后再确认创建。"
            : "未检测到可用的 AI 配置，当前草案为规则兜底生成。建议配置 AI 后重新生成，或直接修改后确认。"
        }
        tone={initial.generationMode === "ai" ? "info" : "warning"}
      />

      <form action={generateTopicDraftAction} className="grid gap-3">
        <Card variant="work">
          <CardHeader>
            <CardTitle><h2>主题名称与目标</h2></CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
              修改名称或描述后点“重新生成草案”，可让 AI 重新起草画像。
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="draftName">主题名称</Label>
              <Input
                id="draftName"
                name="topicName"
                value={name}
                maxLength={120}
                required
                onChange={(event) => setName(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="draftDescription">主题描述</Label>
              <Textarea
                id="draftDescription"
                name="topicDescription"
                value={descriptionValue}
                maxLength={2_000}
                rows={3}
                onChange={(event) => setDescriptionValue(event.target.value)}
              />
            </div>
            <Button className="w-full sm:ml-auto sm:w-auto" type="submit" variant="secondary">
              <RefreshCw aria-hidden="true" size={16} />
              重新生成草案
            </Button>
          </CardContent>
        </Card>
      </form>

      <form action={confirmCreateTopicAction} className="grid gap-3">
            <input type="hidden" name="topicDraftJson" value={draftJson} />
            <input type="hidden" name="topicDescription" value={descriptionValue} />

        <Card variant="work">
          <CardHeader>
            <CardTitle><h2>主题画像</h2></CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
                  关键词用于信源发现；关键词、实体和覆盖/排除范围进入规则与 AI
                  筛选；重要性规则由 AI 用于评分。
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="draftKeywords">关键词（每行或逗号分隔）</Label>
              <Textarea
                id="draftKeywords"
                value={keywords}
                rows={4}
                maxLength={5_000}
                onChange={(event) => setKeywords(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="draftEntities">关键实体（每行或逗号分隔）</Label>
              <Textarea
                id="draftEntities"
                value={entities}
                rows={3}
                maxLength={5_000}
                onChange={(event) => setEntities(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="draftIncludeScope">应覆盖范围（每行一项）</Label>
              <Textarea
                id="draftIncludeScope"
                value={includeScope}
                rows={4}
                maxLength={5_000}
                onChange={(event) => setIncludeScope(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="draftExcludeScope">应排除范围（每行一项）</Label>
              <Textarea
                id="draftExcludeScope"
                value={excludeScope}
                rows={4}
                maxLength={5_000}
                onChange={(event) => setExcludeScope(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="draftImportanceRules">重要性规则（每行一项）</Label>
              <Textarea
                id="draftImportanceRules"
                value={importanceRules}
                rows={5}
                maxLength={5_000}
                onChange={(event) => setImportanceRules(event.target.value)}
              />
            </div>
          </CardContent>
        </Card>

        <Card variant="work">
          <CardHeader>
            <CardTitle><h2>语言与简报偏好</h2></CardTitle>
            <p className="text-sm leading-6 text-muted-foreground">
                  摘要当前使用简体中文；术语规则影响 AI 摘要生成，简报风格控制日报结构和详细程度。
            </p>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="draftTerminologyRules">术语规则（每行一项）</Label>
              <Textarea
                id="draftTerminologyRules"
                value={terminologyRules}
                rows={3}
                maxLength={2_000}
                placeholder="例如：OpenAI 不译、LLM 保留英文"
                onChange={(event) => setTerminologyRules(event.target.value)}
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="draftDigestStructure">简报结构</Label>
              <select
                id="draftDigestStructure"
                className="h-14 w-full min-w-0 rounded-t-[12px] border-0 border-b-2 border-outline bg-muted px-4 text-base text-foreground outline-none transition-[border-color] duration-200 focus-visible:border-primary"
                value={structure}
                onChange={(event) =>
                  setStructure(
                    event.target.value as "standard" | "detailed" | "compact",
                  )
                }
              >
                <option value="standard">标准（摘要 + 事件 + 偏好 + 跟进）</option>
                <option value="detailed">详尽（含 Executive Summary）</option>
                <option value="compact">紧凑（仅事件列表 + 跟进）</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="draftDigestDetail">详细程度</Label>
              <select
                id="draftDigestDetail"
                className="h-14 w-full min-w-0 rounded-t-[12px] border-0 border-b-2 border-outline bg-muted px-4 text-base text-foreground outline-none transition-[border-color] duration-200 focus-visible:border-primary"
                value={detailLevel}
                onChange={(event) =>
                  setDetailLevel(
                    event.target.value as "brief" | "standard" | "comprehensive",
                  )
                }
              >
                <option value="standard">标准</option>
                <option value="comprehensive">全面</option>
                <option value="brief">简略</option>
              </select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="draftMaxEvents">最大事件数</Label>
              <Input
                id="draftMaxEvents"
                type="number"
                min={1}
                max={50}
                value={maxEvents}
                onChange={(event) => setMaxEvents(Number(event.target.value))}
              />
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-3 rounded-[16px] bg-muted p-4 text-sm leading-6 text-muted-foreground sm:flex sm:items-center sm:justify-between">
          <span>确认后才会写入主题与候选信源。</span>
          <Button className="w-full sm:w-auto" type="submit" variant="primary">
            <Sparkles aria-hidden="true" size={16} />
            确认创建主题
          </Button>
        </div>
      </form>
    </>
  );
}
