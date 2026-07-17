import { Sparkles } from "lucide-react";
import Link from "next/link";
import { createTopicAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageHeader } from "@/components/common/page-header";

export default function NewTopicPage() {
  return (
    <>
      <PageHeader eyebrow="TRACK WHAT MATTERS" title="新建观察主题">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">← 返回情报流</Link>
        </Button>
      </PageHeader>

      <Card className="topic-lab p-0" variant="kinetic">
        <div className="pt-6 px-5 pb-5">
          <form action={createTopicAction} className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="topicName" className="text-xs font-extrabold text-muted-foreground">主题名称</Label>
              <Input
                className="min-h-16 min-w-0 border-2 text-[clamp(1.25rem,3vw,2rem)] font-black"
                id="topicName"
                name="topicName"
                placeholder="我想关注 AI 基础设施"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="topicDescription" className="text-xs font-extrabold text-muted-foreground">主题描述</Label>
              <Textarea
                id="topicDescription"
                name="topicDescription"
                placeholder="关注 AI 基础设施、模型供应商、Agent 平台和部署生态。"
                rows={3}
              />
            </div>
            <div className="flex flex-col items-start gap-3 text-xs leading-[1.45] text-muted-foreground md:flex-row md:items-center md:justify-between">
              <span>保存后会自动生成主题关键词，并尝试匹配可验证的候选信源。</span>
              <Button type="submit" variant="primary">
                <Sparkles aria-hidden="true" size={16} />
                创建主题
              </Button>
            </div>
          </form>
        </div>
      </Card>
    </>
  );
}
