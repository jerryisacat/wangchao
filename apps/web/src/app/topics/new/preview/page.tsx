import { cookies } from "next/headers";
import Link from "next/link";
import { ArrowLeft, FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/common/empty-state";
import { PageHeader } from "@/components/common/page-header";
import {
  TopicDraftPreviewForm,
  type TopicDraftPreviewInitial,
} from "./topic-draft-preview-form";

export const dynamic = "force-dynamic";

const TOPIC_DRAFT_COOKIE = "wc_topic_draft";

export default async function TopicDraftPreviewPage() {
  const cookieStore = await cookies();
  const envelope = cookieStore.get(TOPIC_DRAFT_COOKIE)?.value;

  if (!envelope) {
    return <DraftUnavailable message="草案已过期或未生成，请返回重新填写主题目标。" />;
  }

  let parsed: { draft: TopicDraftPreviewInitial; description?: string };
  try {
    parsed = JSON.parse(envelope) as {
      draft: TopicDraftPreviewInitial;
      description?: string;
    };
  } catch {
    return <DraftUnavailable message="草案数据无法解析，请返回重新生成。" />;
  }

  if (!parsed.draft || typeof parsed.draft !== "object") {
    return <DraftUnavailable message="草案数据不完整，请返回重新生成。" />;
  }

  return (
    <TopicDraftPreviewForm
      initial={parsed.draft}
      description={parsed.description ?? ""}
    />
  );
}

function DraftUnavailable({ message }: { message: string }) {
  return (
    <>
      <PageHeader eyebrow="检查草案" title="确认主题画像">
        <Button asChild size="sm" variant="ghost">
          <Link href="/topics/new">
            <ArrowLeft aria-hidden="true" size={14} />
            <span>返回新建</span>
          </Link>
        </Button>
      </PageHeader>
      <Card variant="work">
        <CardContent>
          <EmptyState
            description={message}
            icon={<FileWarning aria-hidden="true" size={18} />}
            title="草案不可用"
          />
        </CardContent>
      </Card>
    </>
  );
}
