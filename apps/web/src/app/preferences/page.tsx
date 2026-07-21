import { ArrowDown, ArrowUp, Brain, Minus, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import {
  deletePreferenceAction,
  updatePreferenceWeightAction,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import { getTopicSourceWorkspace } from "@/lib/topic-source-data";

export const dynamic = "force-dynamic";

export default async function PreferencesPage() {
  const workspace = await getTopicSourceWorkspace();

  return (
    <>
      <PageHeader eyebrow="学习记录" title="偏好记忆">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">← 返回情报流</Link>
        </Button>
      </PageHeader>

      <div>
        <Card variant="work">
          <CardHeader>
            <CardTitle>已学习偏好</CardTitle>
          </CardHeader>
          <CardContent>
            {workspace.preferences.length === 0 ? (
              <EmptyState
                description="对情报进行收藏或忽略后，系统会生成可解释偏好。"
                icon={<Brain aria-hidden="true" size={18} />}
                title="暂无偏好记忆"
              />
            ) : (
              <div className="divide-y divide-border">
                {workspace.preferences.map((preference) => {
                  const presentation = describePreference(preference.key, workspace);
                  const confidence = Math.round(preference.confidence * 100);

                  return (
                    <article
                      className="grid gap-4 py-5 first:pt-0 last:pb-0"
                      key={`${preference.topicName}-${preference.key}`}
                    >
                      <div className="grid grid-cols-1 items-start gap-4 sm:grid-cols-[minmax(0,1fr)_auto]">
                        <div className="grid min-w-0 gap-2">
                          <div className="flex min-w-0 flex-wrap items-center gap-2">
                            <Badge variant="outline">{presentation.kind}</Badge>
                            <h3 className="m-0 min-w-0 text-base font-medium leading-snug [overflow-wrap:anywhere]">
                              {presentation.label}
                            </h3>
                          </div>
                          <p className="m-0 max-w-[65ch] text-sm leading-relaxed text-muted-foreground">
                            {preferenceExplanation(preference.explanation, preference.weight)}
                          </p>
                          <p className="m-0 text-sm text-muted-foreground">
                            适用主题：
                            <span className="font-medium text-foreground">
                              {preference.topicName}
                            </span>
                          </p>
                        </div>
                        <div className="grid min-w-36 gap-2 sm:justify-items-end">
                          <Badge
                            variant={
                              preference.weight > 0
                                ? "success"
                                : preference.weight < 0
                                  ? "warning"
                                  : "muted"
                            }
                          >
                            {preference.weight > 0 ? (
                              <ArrowUp aria-hidden="true" size={12} />
                            ) : preference.weight < 0 ? (
                              <ArrowDown aria-hidden="true" size={12} />
                            ) : null}
                            {weightLabel(preference.weight)}
                          </Badge>
                          <div className="grid w-full gap-1 sm:w-32">
                            <span className="text-sm text-muted-foreground tabular-nums">
                              置信度 {confidence}%
                            </span>
                            <div
                              aria-label={`置信度 ${confidence}%`}
                              aria-valuemax={100}
                              aria-valuemin={0}
                              aria-valuenow={confidence}
                              className="h-2 w-full overflow-hidden rounded-full bg-muted"
                              role="progressbar"
                            >
                              <span
                                className="block h-full rounded-full bg-primary"
                                style={{ inlineSize: `${confidence}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
                        <form action={updatePreferenceWeightAction}>
                          <input type="hidden" name="preferenceKey" value={preference.key} />
                          <input
                            type="hidden"
                            name="topicId"
                            value={getTopicId(workspace, preference.topicName)}
                          />
                          <input
                            type="hidden"
                            name="weight"
                            value={Math.max(-4, preference.weight - 0.5).toFixed(2)}
                          />
                          <Button className="w-full" size="sm" type="submit" variant="ghost">
                            <Minus aria-hidden="true" size={14} />
                            <span>降低</span>
                          </Button>
                        </form>
                        <form action={updatePreferenceWeightAction}>
                          <input type="hidden" name="preferenceKey" value={preference.key} />
                          <input
                            type="hidden"
                            name="topicId"
                            value={getTopicId(workspace, preference.topicName)}
                          />
                          <input
                            type="hidden"
                            name="weight"
                            value={Math.min(4, preference.weight + 0.5).toFixed(2)}
                          />
                          <Button className="w-full" size="sm" type="submit" variant="secondary">
                            <Plus aria-hidden="true" size={14} />
                            <span>提高</span>
                          </Button>
                        </form>
                        <form action={deletePreferenceAction}>
                          <input type="hidden" name="preferenceKey" value={preference.key} />
                          <input
                            type="hidden"
                            name="topicId"
                            value={getTopicId(workspace, preference.topicName)}
                          />
                          <Button className="w-full" size="sm" type="submit" variant="ghost">
                            <Trash2 aria-hidden="true" size={14} />
                            <span>删除</span>
                          </Button>
                        </form>
                      </div>
                    </article>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function getTopicId(
  workspace: { topics: Array<{ id: string; name: string }> },
  topicName: string,
): string {
  return workspace.topics.find((t) => t.name === topicName)?.id ?? "";
}

function describePreference(
  key: string,
  workspace: {
    topics: Array<{
      sources: Array<{ id: string; name: string }>;
    }>;
  },
): { kind: string; label: string } {
  if (key.startsWith("source:")) {
    const sourceId = key.slice("source:".length);
    const source = workspace.topics
      .flatMap((topic) => topic.sources)
      .find((candidate) => candidate.id === sourceId);
    return { kind: "信源", label: source?.name ?? "已记录的信源" };
  }

  if (key.startsWith("category:keyword:")) {
    return {
      kind: "关键词",
      label: key.slice("category:keyword:".length) || "未命名关键词",
    };
  }

  if (key.startsWith("category:")) {
    return {
      kind: "内容方向",
      label: key.slice("category:".length) || "未命名方向",
    };
  }

  return { kind: "内容偏好", label: "系统识别的内容方向" };
}

function preferenceExplanation(explanation: string, weight: number): string {
  const signalCount = explanation.match(/^(\d+)\s+feedback signals?/i)?.[1];
  const signalLabel = signalCount ? `${signalCount} 次反馈后` : "根据近期反馈";
  const direction = weight > 0 ? "提高" : weight < 0 ? "降低" : "保持";
  return `${signalLabel}，系统${direction}了这一项在当前主题中的排序权重。`;
}

function weightLabel(weight: number): string {
  if (weight > 0) return `提高 +${weight}`;
  if (weight < 0) return `降低 ${Math.abs(weight)}`;
  return "保持中性";
}
