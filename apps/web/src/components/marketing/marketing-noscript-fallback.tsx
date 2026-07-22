import { ArrowRight, Waves } from "lucide-react";
import Link from "next/link";
import { buildTopicCreationHref } from "@/lib/web-routes";

interface MarketingNoScriptFallbackProps {
  hasWorkspaceAccess: boolean;
}

export function MarketingNoScriptFallback({
  hasWorkspaceAccess,
}: MarketingNoScriptFallbackProps) {
  return (
    <noscript>
      <section className="mx-auto grid w-full max-w-[920px] gap-10 px-[max(16px,env(safe-area-inset-left))] py-16 pr-[max(16px,env(safe-area-inset-right))] sm:px-6 sm:py-24">
        <header>
          <div className="flex items-center gap-2 font-mono text-xs font-bold uppercase tracking-[0.18em] text-primary">
            <Waves aria-hidden="true" size={16} />
            主题情报 Agent
          </div>
          <h1 className="mt-6 text-balance text-[clamp(3rem,9vw,6rem)] font-medium leading-[0.92] tracking-[-0.055em]">
            别追逐信息。<span className="block text-primary">看见重要的变化。</span>
          </h1>
          <p className="mt-7 max-w-[700px] text-base leading-[1.8] text-muted-foreground sm:text-lg">
            定义一次关注方向，望潮持续观察信源、合并重复报道，并把真正值得判断的变化交给你。
          </p>
        </header>

        <article className="rounded-[28px] border border-border bg-card p-5 shadow-sm sm:p-8">
          <p className="font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-primary">
            示例最终情报
          </p>
          <h2 className="mt-3 text-2xl font-bold leading-tight">
            C919 新增商业航线运营数据披露
          </h2>
          <p className="mt-4 text-base leading-relaxed text-muted-foreground">
            多家航司与监管披露显示，国产大飞机正在从交付进展进入稳定运营验证阶段。
          </p>
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <section className="rounded-[18px] bg-secondary p-4">
              <h3 className="text-sm font-bold text-primary">为什么重要</h3>
              <p className="mt-2 text-sm leading-relaxed text-secondary-foreground">
                航线密度和利用率开始成为比交付数量更关键的商业化指标。
              </p>
            </section>
            <section className="rounded-[18px] bg-muted p-4">
              <h3 className="text-sm font-bold">继续跟踪</h3>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                关注新增航点、日利用率、维修保障与海外适航进展。
              </p>
            </section>
          </div>
          <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
            来源：中国商飞 · 中国民航局 · 航司公告
          </p>
          <p className="mt-3 rounded-[16px] bg-primary/5 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
            你的阅读、收藏、忽略与纠偏，会持续调整后续情报。
          </p>
        </article>

        <div className="grid gap-4 border-y border-border py-8 sm:grid-cols-3">
          <p className="font-medium">持续追踪，不必反复搜索</p>
          <p className="font-medium">看见变化，不被报道淹没</p>
          <p className="font-medium">越用越懂你</p>
        </div>

        <Link
          className="inline-flex min-h-12 w-fit items-center gap-2 rounded-full bg-primary px-6 font-medium text-primary-foreground"
          href={buildTopicCreationHref(hasWorkspaceAccess)}
        >
          免费创建第一个主题
          <ArrowRight aria-hidden="true" size={17} />
        </Link>
      </section>
    </noscript>
  );
}
