"use client";

import {
  Bookmark,
  Check,
  ChevronRight,
  CircleMinus,
  ExternalLink,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TidalContours } from "@/components/marketing/tidal-contours";
import { cn } from "@/lib/utils";

const FINAL_STAGE = 5;
const DESKTOP_STAGE_DURATIONS = [900, 2100, 2200, 2800, 3500] as const;
const MOBILE_STAGE_DURATIONS = [700, 1600, 1700, 2300, 2700] as const;
const PHASES = ["定义主题", "观察信源", "合并报道", "提炼变化"] as const;

const focusTerms = ["C919", "适航认证", "航司交付", "国产发动机"];
const excludedTerms = ["航班延误", "旅游营销", "招聘软文"];
const sources = [
  { kind: "官方", name: "中国商飞", side: "left" },
  { kind: "官方", name: "中国民航局", side: "right" },
  { kind: "一手", name: "航司公告", side: "left" },
  { kind: "已观察", name: "产业媒体", side: "right" },
] as const;

export function IntelligenceDemo() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [stage, setStage] = useState(0);
  const [inView, setInView] = useState(false);
  const [documentVisible, setDocumentVisible] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => {
      setReduceMotion(media.matches);
      if (media.matches) setStage(FINAL_STAGE);
    };
    syncPreference();
    media.addEventListener("change", syncPreference);
    return () => media.removeEventListener("change", syncPreference);
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      ([entry]) =>
        setInView(Boolean(entry?.isIntersecting && entry.intersectionRatio >= 0.45)),
      { threshold: [0, 0.45, 0.6] },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const syncVisibility = () => setDocumentVisible(document.visibilityState === "visible");
    syncVisibility();
    document.addEventListener("visibilitychange", syncVisibility);
    return () => document.removeEventListener("visibilitychange", syncVisibility);
  }, []);

  useEffect(() => {
    if (reduceMotion || !inView || !documentVisible || stage >= FINAL_STAGE) return;
    const durations = window.matchMedia("(max-width: 639px)").matches
      ? MOBILE_STAGE_DURATIONS
      : DESKTOP_STAGE_DURATIONS;
    const timeout = window.setTimeout(
      () => setStage((current) => Math.min(current + 1, FINAL_STAGE)),
      durations[stage],
    );
    return () => window.clearTimeout(timeout);
  }, [documentVisible, inView, reduceMotion, stage]);

  const phaseIndex = useMemo(() => {
    if (stage <= 2) return 0;
    if (stage === 3) return 1;
    if (stage === 4) return 2;
    return 3;
  }, [stage]);

  function replay() {
    setStage(reduceMotion ? FINAL_STAGE : 0);
    rootRef.current?.focus({ preventScroll: true });
  }

  return (
    <div
      aria-label="望潮如何把多来源报道提炼为关键变化的示例演示"
      className="relative overflow-hidden rounded-[28px] border border-border/70 bg-[color-mix(in_srgb,var(--color-card)_88%,var(--color-primary)_12%)] shadow-[0_28px_80px_-44px_color-mix(in_srgb,var(--color-primary)_55%,transparent)] sm:rounded-[36px]"
      data-demo-stage={stage}
      ref={rootRef}
      role="region"
      tabIndex={-1}
    >
      <TidalContours
        className={cn(
          "pointer-events-none absolute inset-0 h-full w-full transition-opacity duration-700",
          stage === FINAL_STAGE ? "opacity-25" : "opacity-75",
        )}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--color-card)_92%,transparent),color-mix(in_srgb,var(--color-card)_72%,transparent)_38%,color-mix(in_srgb,var(--color-card)_93%,transparent))]" />

      <div className="relative border-b border-border/60 px-4 py-4 sm:px-7 sm:py-5">
        <div className="flex items-center gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="relative flex size-2.5 shrink-0">
              <span className="absolute inline-flex size-full animate-ping rounded-full bg-primary/35 motion-reduce:animate-none" />
              <span className="relative inline-flex size-2.5 rounded-full bg-primary" />
            </span>
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
              示例演示
            </span>
          </div>

          <div className="ml-auto hidden min-w-0 flex-1 items-center justify-center gap-2 px-4 md:flex">
            {PHASES.map((phase, index) => (
              <div className="flex min-w-0 flex-1 items-center gap-2" key={phase}>
                <div className="flex min-w-0 items-center gap-2">
                  <span
                    className={cn(
                      "grid size-5 shrink-0 place-items-center rounded-full border text-[9px] font-bold transition-all duration-500",
                      index <= phaseIndex
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-card text-muted-foreground",
                    )}
                  >
                    {index < phaseIndex ? <Check aria-hidden="true" size={11} /> : index + 1}
                  </span>
                  <span
                    className={cn(
                      "truncate text-xs font-medium transition-colors",
                      index <= phaseIndex ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {phase}
                  </span>
                </div>
                {index < PHASES.length - 1 ? (
                  <span className="relative h-px min-w-3 flex-1 overflow-hidden bg-border">
                    <span
                      className={cn(
                        "absolute inset-0 origin-left bg-primary transition-transform duration-700",
                        index < phaseIndex ? "scale-x-100" : "scale-x-0",
                      )}
                    />
                  </span>
                ) : null}
              </div>
            ))}
          </div>

          <Button
            aria-label="重新播放示例演示"
            className={cn(
              "ml-auto transition-all duration-500 md:ml-0",
              stage === FINAL_STAGE && !reduceMotion
                ? "opacity-100"
                : "pointer-events-none opacity-0",
            )}
            hidden={reduceMotion || stage !== FINAL_STAGE}
            onClick={replay}
            size="sm"
            tabIndex={stage === FINAL_STAGE && !reduceMotion ? 0 : -1}
            variant="ghost"
          >
            <RotateCcw aria-hidden="true" size={14} />
            <span className="hidden sm:inline">重新播放</span>
          </Button>
        </div>

        <div className="mt-3 md:hidden">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium text-foreground">{PHASES[phaseIndex]}</span>
            <span className="font-mono text-muted-foreground">{phaseIndex + 1} / 4</span>
          </div>
          <div className="mt-2 grid grid-cols-4 gap-1.5">
            {PHASES.map((phase, index) => (
              <span
                aria-hidden="true"
                className={cn(
                  "h-1 rounded-full transition-colors duration-500",
                  index <= phaseIndex ? "bg-primary" : "bg-border",
                )}
                key={phase}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="relative min-h-[720px] px-4 py-6 min-[375px]:min-h-[650px] sm:min-h-[510px] sm:px-8 sm:py-8 lg:px-14">
        <section
          aria-hidden={stage === FINAL_STAGE}
          className={cn(
            "absolute inset-x-4 top-7 transition-all duration-500 sm:inset-x-8 sm:top-9 lg:inset-x-14",
            stage < FINAL_STAGE
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-2 opacity-0",
            stage === 4 && "opacity-35",
          )}
        >
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
            关注方向
          </p>
          <h3 className="mt-2 max-w-[780px] text-balance text-2xl font-medium leading-tight tracking-[-0.025em] sm:text-3xl">
            我想关注中国商业航空进展
          </h3>
        </section>

        <section
          aria-hidden={stage !== 2}
          className={cn(
            "absolute inset-x-4 top-32 grid gap-5 transition-all duration-500 sm:inset-x-8 sm:top-36 sm:grid-cols-2 sm:gap-8 lg:inset-x-14",
            stage === 2
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-3 opacity-0",
          )}
        >
          <TopicBoundary label="重点关注" terms={focusTerms} tone="primary" />
          <TopicBoundary label="主动排除" terms={excludedTerms} tone="neutral" />
        </section>

        <section
          aria-hidden={stage !== 3}
          className={cn(
            "absolute inset-x-4 top-28 transition-all duration-500 sm:inset-x-8 sm:top-32 lg:inset-x-14",
            stage === 3
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-3 opacity-0",
          )}
        >
          <p className="mb-4 text-xs font-medium text-muted-foreground">持续观察可信信源</p>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3">
            {sources.map((source, index) => (
              <div
                className={cn(
                  "flex items-center gap-3 rounded-2xl border border-border/70 bg-card/92 px-4 py-3 shadow-sm transition-transform duration-700",
                  source.side === "left" ? "sm:translate-x-2" : "sm:-translate-x-2",
                )}
                key={source.name}
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-full bg-secondary font-mono text-[10px] font-bold text-primary">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="min-w-0 flex-1 truncate text-sm font-semibold">{source.name}</span>
                <Badge variant="outline">{source.kind}</Badge>
              </div>
            ))}
          </div>
          <p className="mt-5 flex items-center gap-2 text-xs text-muted-foreground">
            <Sparkles aria-hidden="true" className="text-primary" size={14} />
            正在识别同一变化的多来源报道
          </p>
        </section>

        <section
          aria-hidden={stage !== 4}
          className={cn(
            "absolute inset-x-4 top-36 transition-all duration-700 sm:inset-x-8 sm:top-40 lg:inset-x-14",
            stage === 4
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-3 opacity-0",
          )}
        >
          <div className="mx-auto flex max-w-[760px] flex-col items-center gap-5 text-center">
            <div className="flex flex-wrap items-center justify-center gap-2">
              {Array.from({ length: 12 }, (_, index) => (
                <span
                  className="h-2 rounded-full bg-primary/20"
                  key={index}
                  style={{ width: `${20 + (index % 4) * 6}px` }}
                />
              ))}
            </div>
            <div className="flex items-center gap-4 sm:gap-7">
              <div>
                <strong className="font-mono text-4xl font-medium tabular-nums sm:text-5xl">12</strong>
                <p className="mt-1 text-xs text-muted-foreground">条示例报道</p>
              </div>
              <ChevronRight aria-hidden="true" className="text-primary" size={28} />
              <div>
                <strong className="font-mono text-4xl font-medium tabular-nums text-primary sm:text-5xl">3</strong>
                <p className="mt-1 text-xs text-muted-foreground">个关键变化</p>
              </div>
            </div>
            <div className="grid w-full grid-cols-3 gap-2 sm:gap-3">
              {["运营验证", "交付节奏", "保障能力"].map((label, index) => (
                <div
                  className={cn(
                    "rounded-2xl border bg-card/92 px-2 py-4 text-xs font-semibold shadow-sm sm:px-4 sm:text-sm",
                    index === 0 ? "border-primary/60 text-primary" : "border-border/70",
                  )}
                  key={label}
                >
                  {label}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section
          aria-hidden={stage !== FINAL_STAGE}
          className={cn(
            "absolute inset-x-4 top-5 transition-all duration-1000 ease-[cubic-bezier(0.2,0,0,1)] sm:inset-x-8 sm:top-7 lg:inset-x-14",
            stage === FINAL_STAGE
              ? "scale-100 translate-y-0 opacity-100"
              : "pointer-events-none scale-[0.94] translate-y-7 opacity-0",
          )}
        >
          <article className="mx-auto max-w-[860px] overflow-hidden rounded-[24px] border border-border/70 bg-card/95 shadow-[0_24px_60px_-38px_color-mix(in_srgb,var(--color-primary)_65%,transparent)] backdrop-blur sm:rounded-[28px]">
            <div className="border-b border-border/60 px-5 py-4 sm:px-7">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="secondary">中国商业航空进展</Badge>
                <Badge variant="default">重要变化</Badge>
                <span className="ml-auto font-mono text-[10px] uppercase tracking-[0.15em] text-muted-foreground">
                  3 个信源
                </span>
              </div>
            </div>
            <div className="grid gap-5 px-5 py-5 sm:px-7 sm:py-6">
              <div>
                <h3 className="text-balance text-xl font-bold leading-snug tracking-[-0.02em] sm:text-2xl">
                  C919 新增商业航线运营数据披露
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground sm:text-base">
                  商业运营正从示范阶段走向规模验证，机队利用率与维修保障能力成为下一阶段观察重点。
                </p>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1.25fr_0.75fr]">
                <div className="rounded-2xl bg-secondary/65 p-4 sm:p-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-primary">
                    为什么重要
                  </p>
                  <p className="mt-2 text-sm leading-relaxed">
                    交付数量不再是唯一指标，稳定运营能力将直接影响后续订单、航司扩张和供应链节奏。
                  </p>
                </div>
                <div className="rounded-2xl border border-border/70 bg-background/75 p-4 sm:p-5">
                  <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
                    继续跟踪
                  </p>
                  <p className="mt-2 text-sm font-medium leading-relaxed">
                    机队利用率 · 交付节奏 · 维修保障
                  </p>
                </div>
              </div>
              <div className="flex flex-col gap-3 border-t border-border/60 pt-4 sm:flex-row sm:items-center">
                <p className="min-w-0 flex-1 text-xs text-muted-foreground">
                  中国商飞 · 中国民航局 · 航司公告
                </p>
                <div aria-label="真实产品操作示意" className="flex flex-wrap items-center gap-1.5">
                  <DemoAction hideOnMobile icon={<Check size={13} />} label="已读" />
                  <DemoAction icon={<Bookmark size={13} />} label="收藏" />
                  <DemoAction hideOnMobile icon={<CircleMinus size={13} />} label="减少这类" />
                  <DemoAction icon={<ExternalLink size={13} />} label="查看原文" />
                </div>
              </div>
            </div>
          </article>
          <p className="mx-auto mt-4 flex max-w-[760px] items-start justify-center gap-2 text-center text-xs leading-relaxed text-muted-foreground sm:text-sm">
            <Sparkles aria-hidden="true" className="mt-0.5 shrink-0 text-primary" size={14} />
            你的阅读、收藏、忽略与纠偏，会持续调整后续情报。
          </p>
        </section>
      </div>

      <noscript>
        <p className="border-t border-border/60 px-5 py-4 text-center text-sm text-muted-foreground">
          示例结果：12 条相关报道被归并为 3 个关键变化，并保留来源与后续跟踪方向。
        </p>
      </noscript>
    </div>
  );
}

function TopicBoundary({
  label,
  terms,
  tone,
}: {
  label: string;
  terms: string[];
  tone: "neutral" | "primary";
}) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card/82 p-4 backdrop-blur sm:p-5">
      <p className="font-mono text-[10px] font-bold uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        {terms.map((term) => (
          <span
            className={cn(
              "rounded-full px-3 py-1.5 text-xs font-medium",
              tone === "primary"
                ? "bg-secondary text-primary"
                : "bg-muted text-muted-foreground",
            )}
            key={term}
          >
            {term}
          </span>
        ))}
      </div>
    </div>
  );
}

function DemoAction({
  hideOnMobile = false,
  icon,
  label,
}: {
  hideOnMobile?: boolean;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <span
      className={cn(
        "min-h-8 items-center gap-1.5 rounded-full bg-muted px-2.5 text-[11px] font-medium text-muted-foreground",
        hideOnMobile ? "hidden sm:inline-flex" : "inline-flex",
      )}
    >
      <span aria-hidden="true">{icon}</span>
      {label}
    </span>
  );
}
