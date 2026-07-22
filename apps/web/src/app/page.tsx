import type { Metadata } from "next";
import {
  ArrowRight,
  BrainCircuit,
  Github,
  Layers3,
  RadioTower,
  Sparkles,
  Waves,
} from "lucide-react";
import Link from "next/link";
import { IntelligenceDemoShell } from "@/components/marketing/intelligence-demo-shell";
import { TidalContours } from "@/components/marketing/tidal-contours";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasAuthenticatedSession } from "@/lib/session";
import { buildTopicCreationHref } from "@/lib/web-routes";

export const metadata: Metadata = {
  alternates: {
    canonical: "/",
  },
  title: "望潮｜持续看见真正重要的变化",
  description:
    "望潮是你的主题情报 Agent：持续发现、筛选并理解相关信息，把重复报道变成值得判断和继续跟踪的关键变化。",
  openGraph: {
    title: "望潮｜持续看见真正重要的变化",
    description:
      "定义一次关注方向，让望潮持续观察信源、合并报道并提炼关键变化。",
    type: "website",
    url: "/",
  },
  twitter: {
    card: "summary_large_image",
    title: "望潮｜持续看见真正重要的变化",
    description: "别追逐信息。持续看见真正重要的变化。",
  },
};

const capabilities = [
  {
    description:
      "定义一次关注方向，望潮持续观察相关实体、政策、公司和产业进展，不必每天重做同一组搜索。",
    eyebrow: "01 · CONTINUOUS",
    icon: RadioTower,
    title: "持续追踪，不必反复搜索",
  },
  {
    description:
      "把多个来源对同一事件的重复报道合并起来，告诉你发生了什么、为什么重要，以及下一步值得关注什么。",
    eyebrow: "02 · SIGNAL",
    icon: Layers3,
    title: "看见变化，不被报道淹没",
  },
  {
    description:
      "阅读、收藏、忽略和纠偏都会形成可解释偏好，让后续情报逐渐贴近你的专业判断，而不是困在信息茧房里。",
    eyebrow: "03 · MEMORY",
    icon: BrainCircuit,
    title: "越用越懂你",
  },
] as const;

export default async function LandingPage() {
  const topicCreationHref = buildTopicCreationHref(await hasAuthenticatedSession());

  return (
    <>
      <section className="relative overflow-hidden border-b border-border/60">
        <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/35 to-transparent" />
        <div className="mx-auto grid w-full max-w-[1200px] gap-10 px-[max(16px,env(safe-area-inset-left))] pb-10 pt-16 pr-[max(16px,env(safe-area-inset-right))] sm:px-6 sm:pb-16 sm:pt-24 lg:px-8 lg:pt-28">
          <header className="mx-auto grid max-w-[920px] justify-items-center text-center">
            <Badge className="mb-6 gap-2" variant="secondary">
              <Sparkles aria-hidden="true" size={13} />
              主题情报 Agent
            </Badge>
            <h1 className="text-balance text-[clamp(3rem,8vw,6.8rem)] font-medium leading-[0.9] tracking-[-0.06em] text-foreground">
              别追逐信息。
              <span className="mt-2 block text-primary sm:mt-3">
                看见重要的变化。
              </span>
            </h1>
            <p className="mt-7 max-w-[720px] text-pretty text-base leading-[1.8] text-muted-foreground sm:mt-9 sm:text-lg lg:text-xl">
              用一句话定义关注方向。望潮持续发现、筛选并理解相关信息，
              把重复报道变成值得判断和继续跟踪的关键变化。
            </p>
            <div className="mt-8 flex flex-col items-center gap-3 sm:mt-10 sm:flex-row">
              <Button asChild className="min-w-[220px]" size="lg" variant="primary">
                <Link href={topicCreationHref} prefetch={false}>
                  免费创建第一个主题
                  <ArrowRight aria-hidden="true" size={17} />
                </Link>
              </Button>
              <Button asChild size="lg" variant="ghost">
                <a href="#product-demo">观看 12 秒演示</a>
              </Button>
            </div>
            <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground sm:text-xs">
              从一个真正值得持续关注的主题开始
            </p>
          </header>

          <div className="relative mt-2 scroll-mt-24" id="product-demo">
            <div className="pointer-events-none absolute -inset-x-16 -inset-y-12 -z-10 bg-[radial-gradient(circle_at_center,color-mix(in_srgb,var(--color-primary)_8%,transparent),transparent_68%)]" />
            <h2 className="sr-only">望潮主题情报演示</h2>
            <IntelligenceDemoShell />
          </div>
        </div>
      </section>

      <section
        className="mx-auto w-full max-w-[1200px] scroll-mt-24 px-[max(16px,env(safe-area-inset-left))] py-20 pr-[max(16px,env(safe-area-inset-right))] sm:px-6 sm:py-28 lg:px-8"
        id="capabilities"
      >
        <div className="grid gap-8 border-b border-border pb-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-end">
          <div>
            <p className="font-mono text-xs font-bold uppercase tracking-[0.18em] text-primary">
              What changes
            </p>
            <h2 className="mt-4 max-w-[620px] text-balance text-[clamp(2.25rem,5vw,4.5rem)] font-medium leading-[0.98] tracking-[-0.045em]">
              少看一点。
              <br />理解得更深一点。
            </h2>
          </div>
          <p className="max-w-[600px] text-pretty text-base leading-[1.8] text-muted-foreground lg:justify-self-end lg:text-lg">
            信息工具常常让你获得更多链接。望潮更在意另一件事：让你知道哪些事实发生了变化，以及它们是否足以改变原来的判断。
          </p>
        </div>

        <div className="grid divide-y divide-border border-b border-border lg:grid-cols-3 lg:divide-x lg:divide-y-0">
          {capabilities.map((capability) => {
            const Icon = capability.icon;
            return (
              <article
                className="group grid min-h-[260px] content-between gap-10 py-10 lg:min-h-[320px] lg:px-8 lg:py-12 lg:first:pl-0 lg:last:pr-0"
                key={capability.title}
              >
                <div className="flex items-center justify-between gap-4">
                  <span className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-muted-foreground">
                    {capability.eyebrow}
                  </span>
                  <span className="grid size-11 place-items-center rounded-full bg-secondary text-primary transition-transform duration-500 ease-[cubic-bezier(0.2,0,0,1)] group-hover:-translate-y-1">
                    <Icon aria-hidden="true" size={20} />
                  </span>
                </div>
                <div>
                  <h3 className="max-w-[320px] text-2xl font-bold leading-tight tracking-[-0.025em]">
                    {capability.title}
                  </h3>
                  <p className="mt-4 max-w-[340px] text-sm leading-[1.8] text-muted-foreground sm:text-base">
                    {capability.description}
                  </p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1200px] px-[max(16px,env(safe-area-inset-left))] pb-20 pr-[max(16px,env(safe-area-inset-right))] sm:px-6 sm:pb-28 lg:px-8">
        <div className="relative isolate overflow-hidden rounded-[30px] bg-foreground px-5 py-14 text-background sm:rounded-[40px] sm:px-10 sm:py-20 lg:px-16">
          <TidalContours className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-[0.14] [&_path]:stroke-background" compact />
          <div className="absolute inset-0 -z-10 bg-[linear-gradient(100deg,var(--color-foreground)_28%,color-mix(in_srgb,var(--color-foreground)_90%,transparent)_68%,color-mix(in_srgb,var(--color-primary)_55%,var(--color-foreground)))]" />
          <div className="grid gap-9 lg:grid-cols-[1fr_auto] lg:items-end">
            <div>
              <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-background/60 sm:text-xs">
                Start with one question
              </p>
              <h2 className="mt-5 max-w-[760px] text-balance text-[clamp(2.5rem,6vw,5.5rem)] font-medium leading-[0.92] tracking-[-0.055em]">
                从一个真正值得持续关注的主题开始。
              </h2>
              <p className="mt-6 max-w-[660px] text-pretty text-base leading-[1.8] text-background/68 sm:text-lg">
                不必先整理信源，也不必设计复杂规则。告诉望潮你关心什么，剩下的交给它持续完成。
              </p>
            </div>
            <Button asChild className="w-full bg-background text-foreground hover:bg-background/90 lg:w-auto" size="lg">
              <Link href={topicCreationHref} prefetch={false}>
                免费创建第一个主题
                <ArrowRight aria-hidden="true" size={17} />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col gap-7 px-[max(16px,env(safe-area-inset-left))] py-8 pr-[max(16px,env(safe-area-inset-right))] sm:px-6 lg:flex-row lg:items-center lg:px-8">
          <Link className="flex items-center gap-2 font-bold text-foreground" href="/" prefetch={false}>
            <span className="grid size-8 place-items-center rounded-full bg-primary text-primary-foreground">
              <Waves aria-hidden="true" size={15} />
            </span>
            望潮
          </Link>
          <p className="text-xs leading-relaxed text-muted-foreground lg:max-w-[400px]">
            面向研究者、投资人、创业者与行业从业者的持续主题情报 Agent。
          </p>
          <nav aria-label="页脚导航" className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm lg:ml-auto">
            <Link className="text-muted-foreground hover:text-foreground" href="/pricing" prefetch={false}>定价</Link>
            <a
              className="inline-flex items-center gap-1.5 text-muted-foreground hover:text-foreground"
              href="https://github.com/jerryisacat/wangchao"
              rel="noreferrer"
              target="_blank"
            >
              <Github aria-hidden="true" size={14} />
              GitHub
            </a>
            <a
              className="text-muted-foreground hover:text-foreground"
              href="https://github.com/jerryisacat/wangchao#readme"
              rel="noreferrer"
              target="_blank"
            >
              文档
            </a>
            <span className="text-muted-foreground" title="自托管数据由部署者自主控制">
              隐私自主
            </span>
            <a
              className="text-muted-foreground hover:text-foreground"
              href="https://github.com/jerryisacat/wangchao/blob/master/LICENSE"
              rel="noreferrer"
              target="_blank"
            >
              条款 · MIT License
            </a>
          </nav>
          <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            自托管 · BYOK
          </p>
        </div>
      </footer>
    </>
  );
}
