"use client";

import { Home, RotateCcw } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function Error({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <section
      aria-labelledby="error-title"
      className="mx-auto w-[calc(100%_-_2rem)] max-w-[520px] rounded-[24px] bg-card p-6 shadow-sm"
    >
      <div className="text-xs font-medium tracking-[0.01em] text-muted-foreground">
        运行状态
      </div>
      <h1
        id="error-title"
        className="mt-1 [overflow-wrap:anywhere] text-[clamp(2rem,4vw,3.5rem)] leading-[0.95]"
      >
        页面加载失败
      </h1>
      <p className="mt-4 text-base leading-relaxed text-muted-foreground">
        请稍后重试，或返回未读情报继续阅读。如果问题持续存在，请联系管理员。
      </p>
      <div className="mt-6 flex flex-wrap gap-2">
        <Button onClick={reset} variant="primary">
          <RotateCcw aria-hidden="true" size={16} />
          重试
        </Button>
        <Button asChild variant="ghost">
          <Link href="/app">
            <Home aria-hidden="true" size={16} />
            返回未读情报
          </Link>
        </Button>
      </div>
    </section>
  );
}
