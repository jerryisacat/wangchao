import { Sparkles } from "lucide-react";
import Link from "next/link";
import { generateTopicDraftAction } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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

      <Card className="topic-lab" variant="kinetic">
        <CardContent className="relative z-[1]">
          <form action={generateTopicDraftAction} className="grid gap-3">
            <div className="grid gap-2">
              <Label htmlFor="topicName">主题名称</Label>
              <Input
                className="min-h-16 min-w-0 border-2 text-[clamp(1.25rem,3vw,2rem)] font-black"
                id="topicName"
                name="topicName"
                placeholder="我想关注 AI 基础设施"
                required
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="topicDescription">主题描述</Label>
              <Textarea
                id="topicDescription"
                name="topicDescription"
                placeholder="关注 AI 基础设施、模型供应商、Agent 平台和部署生态。"
                rows={3}
              />
            </div>
            <div className="grid gap-3 border-t border-border pt-4 text-sm leading-6 text-muted-foreground sm:flex sm:items-center sm:justify-between">
              <span className="max-w-[68ch]">
                提交后会基于自然语言目标生成主题画像草案，你可以预览并逐字段修改后再确认创建。
              </span>
              <Button className="w-full shrink-0 sm:w-auto" type="submit" variant="primary">
                <Sparkles aria-hidden="true" size={16} />
                生成主题草案
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
