"use client";

import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";

const LazyIntelligenceDemo = dynamic(
  () => import("@/components/marketing/intelligence-demo").then((module) => module.IntelligenceDemo),
  { ssr: false },
);

export function IntelligenceDemoShell() {
  const shellRef = useRef<HTMLDivElement>(null);
  const [shouldLoad, setShouldLoad] = useState(false);

  useEffect(() => {
    const node = shellRef.current;
    if (!node || shouldLoad) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting || entry.intersectionRatio < 0.55) return;
        setShouldLoad(true);
        observer.disconnect();
      },
      { threshold: [0, 0.55] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [shouldLoad]);

  return (
    <div data-demo-shell ref={shellRef}>
      {shouldLoad ? (
        <LazyIntelligenceDemo />
      ) : (
        <div
          aria-label="望潮主题情报示例演示，滚动到此处后加载互动时间轴"
          className="relative grid min-h-[784px] content-between overflow-hidden rounded-[28px] border border-border/70 bg-card p-5 shadow-[0_28px_80px_-44px_color-mix(in_srgb,var(--color-primary)_55%,transparent)] sm:min-h-[574px] sm:rounded-[36px] sm:p-8"
          role="region"
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_10%,color-mix(in_srgb,var(--color-primary)_12%,transparent),transparent_52%)]" />
          <div className="relative flex items-center gap-2 border-b border-border/60 pb-4 text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <span className="size-2.5 rounded-full bg-primary" />
            示例演示
          </div>
          <div className="relative grid gap-4 rounded-[22px] border border-border/70 bg-background/85 p-5 sm:p-7">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">最终情报预览</p>
            <h3 className="text-balance text-xl font-bold leading-snug sm:text-2xl">
              C919 新增商业航线运营数据披露
            </h3>
            <p className="max-w-[760px] text-sm leading-relaxed text-muted-foreground sm:text-base">
              望潮会持续观察信源、合并重复报道，并把真正改变判断的事实提炼为可继续跟踪的情报。
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
