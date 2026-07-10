import { Check, CircleAlert, KeyRound, Search, Trash2, Zap } from "lucide-react";
import Link from "next/link";
import {
  deleteAiCredentialAction,
  deleteSearchCredentialAction,
  testAiCredentialAction,
  testSearchCredentialAction,
  upsertAiCredentialAction,
  upsertSearchCredentialAction,
} from "@/app/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/common/page-header";
import { StatusBanner } from "@/components/common/status-banner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CredentialForm } from "./credential-form";

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

      <Tabs defaultValue="ai">
        <TabsList>
          <TabsTrigger value="ai">
            <KeyRound aria-hidden="true" size={14} />
            AI 凭证
          </TabsTrigger>
          <TabsTrigger value="search">
            <Search aria-hidden="true" size={14} />
            搜索凭证
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ai">
          <Card variant="work">
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <KeyRound aria-hidden="true" size={16} />
                  AI 凭证
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-md border border-border bg-[#0f0f13] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Badge variant={credential?.ai.hasKey ? "success" : "muted"}>
                    {credential?.ai.hasKey ? "已配置" : "未配置"}
                  </Badge>
                  {credential?.ai.hasKey ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      更新于 {formatDate(credential.updatedAt)}
                    </span>
                  ) : null}
                </div>
                {credential?.ai.hasKey ? (
                  <dl className="grid gap-1.5 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">Key</dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {credential.ai.keyHint}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        端点
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {credential.ai.baseUrl ?? "未设置"}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        模型
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {credential.ai.model ?? "未设置"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>

              <CredentialForm
                currentProvider={credential?.ai.provider ?? null}
                formAction={upsertAiCredentialAction}
                mode="ai"
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <form action={testAiCredentialAction}>
                  <Button size="sm" type="submit" variant="ghost">
                    <Zap aria-hidden="true" size={14} />
                    测试连接
                  </Button>
                </form>
                <form action={deleteAiCredentialAction}>
                  <Button size="sm" type="submit" variant="danger">
                    <Trash2 aria-hidden="true" size={14} />
                    清除凭证
                  </Button>
                </form>
              </div>

              <p className="credential-note">
                保存后系统将使用此 Key 进行 AI 分析和信源推荐。当前 Key
                不会显示，仅显示脱敏提示。
              </p>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="search">
          <Card variant="work">
            <CardHeader>
              <CardTitle>
                <span className="inline-flex items-center gap-2">
                  <Search aria-hidden="true" size={16} />
                  搜索凭证
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="mb-4 rounded-md border border-border bg-[#0f0f13] p-4">
                <div className="mb-3 flex items-center justify-between">
                  <Badge
                    variant={credential?.search.hasKey ? "success" : "muted"}
                  >
                    {credential?.search.hasKey ? "已配置" : "未配置"}
                  </Badge>
                  {credential?.search.hasKey ? (
                    <span className="font-mono text-xs text-muted-foreground">
                      更新于 {formatDate(credential.updatedAt)}
                    </span>
                  ) : null}
                </div>
                {credential?.search.hasKey ? (
                  <dl className="grid gap-1.5 text-xs">
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        Key
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {credential.search.keyHint}
                      </dd>
                    </div>
                    <div className="flex gap-2">
                      <dt className="w-16 shrink-0 text-muted-foreground">
                        Provider
                      </dt>
                      <dd className="break-all font-mono text-muted-foreground">
                        {credential.search.provider ?? "未设置"}
                      </dd>
                    </div>
                  </dl>
                ) : null}
              </div>

              <CredentialForm
                currentProvider={credential?.search.provider ?? null}
                formAction={upsertSearchCredentialAction}
                mode="search"
              />

              <div className="mt-3 flex flex-wrap gap-2">
                <form action={testSearchCredentialAction}>
                  <Button size="sm" type="submit" variant="ghost">
                    <Zap aria-hidden="true" size={14} />
                    测试连接
                  </Button>
                </form>
                <form action={deleteSearchCredentialAction}>
                  <Button size="sm" type="submit" variant="danger">
                    <Trash2 aria-hidden="true" size={14} />
                    清除凭证
                  </Button>
                </form>
              </div>

              <p className="credential-note">
                保存后系统将使用此 Key 进行信源发现。当前 Key
                不会显示，仅显示脱敏提示。
              </p>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  );
}

function readParam(value: string | string[] | undefined): string {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return typeof rawValue === "string" ? rawValue.trim().slice(0, 80) : "";
}

function formatDate(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hours}:${minutes}`;
}
