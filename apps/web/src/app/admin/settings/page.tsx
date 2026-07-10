import { Check, CircleAlert, KeyRound, Search } from "lucide-react";
import Link from "next/link";
import {
  upsertAiCredentialAction,
  upsertSearchCredentialAction,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";

export const dynamic = "force-dynamic";

interface AdminSettingsPageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function AdminSettingsPage({
  searchParams,
}: AdminSettingsPageProps) {
  const { ensureDefaultWorkspace, getPrismaClient, getSubscriptionCredentialView } =
    await import("@wangchao/db");
  const prisma = getPrismaClient();
  const workspace = await ensureDefaultWorkspace(prisma);
  const credential = await getSubscriptionCredentialView(prisma, {
    organizationId: workspace.organizationId,
  });

  const resolvedSearchParams = await Promise.resolve(searchParams ?? {});
  const notice = readParam(resolvedSearchParams.notice);
  const actionError = readParam(resolvedSearchParams.error);

  return (
    <>
      <PageHeader eyebrow="管理后台" title="API Key 配置">
        <Button asChild size="sm" variant="ghost">
          <Link href="/">← 返回情报流</Link>
        </Button>
      </PageHeader>

      {notice ? (
        <StatusBanner
          icon={<Check aria-hidden="true" size={16} />}
          message={notice}
          tone="notice"
        />
      ) : null}
      {actionError ? (
        <StatusBanner
          icon={<CircleAlert aria-hidden="true" size={16} />}
          message={actionError}
          tone="error"
        />
      ) : null}

      <div style={{ display: "grid", gap: 16 }}>
        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <span style={{ alignItems: "center", display: "inline-flex", gap: 8 }}>
                <KeyRound aria-hidden="true" size={16} />
                AI 凭证
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="credential-status" style={{ marginBottom: 16 }}>
              <Badge variant={credential?.ai.hasKey ? "success" : "muted"}>
                {credential?.ai.hasKey ? "已配置" : "未配置"}
              </Badge>
              {credential?.ai.hasKey ? (
                <span className="credential-hint">
                  {credential.ai.keyHint} · {credential.ai.baseUrl ?? "未设置 Base URL"}
                  {credential.ai.model ? ` · ${credential.ai.model}` : ""}
                </span>
              ) : null}
            </div>
            <form
              action={upsertAiCredentialAction}
              className="grid gap-3 border border-border rounded-md bg-[#0f0f13] p-4"
            >
              <div className="grid gap-2 text-muted-foreground text-xs font-bold">
                <Label htmlFor="aiApiKey">API Key</Label>
                <Input
                  autoComplete="off"
                  id="aiApiKey"
                  name="aiApiKey"
                  placeholder="输入新的 API Key"
                  required
                  type="password"
                />
              </div>
              <div className="grid gap-2 text-muted-foreground text-xs font-bold">
                <Label htmlFor="aiBaseUrl">Base URL</Label>
                <Input
                  id="aiBaseUrl"
                  name="aiBaseUrl"
                  placeholder="https://api.openai.com/v1"
                  type="url"
                />
              </div>
              <div className="grid gap-2 text-muted-foreground text-xs font-bold">
                <Label htmlFor="aiProvider">Provider</Label>
                <Input
                  id="aiProvider"
                  name="aiProvider"
                  placeholder="openai / custom"
                />
              </div>
              <div className="grid gap-2 text-muted-foreground text-xs font-bold">
                <Label htmlFor="aiModel">模型</Label>
                <Input
                  id="aiModel"
                  name="aiModel"
                  placeholder="gpt-4o-mini"
                />
              </div>
              <Button size="sm" type="submit" variant="primary">
                <KeyRound aria-hidden="true" size={14} />
                保存 AI 凭证
              </Button>
            </form>
            <p className="credential-note">
              保存后系统将使用此 Key 进行 AI 分析和信源推荐。当前 Key 不会显示，仅显示脱敏提示。
            </p>
          </CardContent>
        </Card>

        <Card variant="work">
          <CardHeader>
            <CardTitle>
              <span style={{ alignItems: "center", display: "inline-flex", gap: 8 }}>
                <Search aria-hidden="true" size={16} />
                搜索凭证
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="credential-status" style={{ marginBottom: 16 }}>
              <Badge variant={credential?.search.hasKey ? "success" : "muted"}>
                {credential?.search.hasKey ? "已配置" : "未配置"}
              </Badge>
              {credential?.search.hasKey ? (
                <span className="credential-hint">
                  {credential.search.keyHint} · {credential.search.provider ?? "brave"}
                </span>
              ) : null}
            </div>
            <form
              action={upsertSearchCredentialAction}
              className="grid gap-3 border border-border rounded-md bg-[#0f0f13] p-4"
            >
              <div className="grid gap-2 text-muted-foreground text-xs font-bold">
                <Label htmlFor="searchApiKey">API Key</Label>
                <Input
                  autoComplete="off"
                  id="searchApiKey"
                  name="searchApiKey"
                  placeholder="输入新的搜索 API Key"
                  required
                  type="password"
                />
              </div>
              <div className="grid gap-2 text-muted-foreground text-xs font-bold">
                <Label htmlFor="searchProvider">Provider</Label>
                <Input
                  defaultValue="brave"
                  id="searchProvider"
                  name="searchProvider"
                  placeholder="brave"
                />
              </div>
              <Button size="sm" type="submit" variant="secondary">
                <Search aria-hidden="true" size={14} />
                保存搜索凭证
              </Button>
            </form>
            <p className="credential-note">
              保存后系统将使用此 Key 进行信源发现。当前 Key 不会显示，仅显示脱敏提示。
            </p>
          </CardContent>
        </Card>
      </div>
    </>
  );
}

function readParam(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim().slice(0, 80) : "";
}
