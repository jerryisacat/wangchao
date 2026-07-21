import { LoginForm } from "./login-form";
import { normalizeAuthReturnPath } from "@/lib/auth-access";
import { isAuthEnabled } from "@/lib/auth";

interface LoginPageProps {
  searchParams?:
    | Promise<Record<string, string | string[] | undefined>>
    | Record<string, string | string[] | undefined>;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await Promise.resolve(searchParams ?? {});
  const returnPath = normalizeAuthReturnPath(
    readParam(params.next) ?? readParam(params.callbackUrl),
  );
  return (
    <LoginForm
      authEnabled={isAuthEnabled()}
      denialMessage={
        isAuthEnabled() ? accountDenialMessage(readParam(params.reason)) : null
      }
      returnPath={returnPath}
    />
  );
}

function readParam(value: string | string[] | undefined): string | null {
  return typeof value === "string" ? value : null;
}

function accountDenialMessage(reason: string | null): string | null {
  if (reason === "ACCOUNT_SUSPENDED") {
    return "此账户已暂停，现有登录会话已失效。请联系平台管理员。";
  }
  if (reason === "ACCOUNT_DELETED") {
    return "此账户已不可用，无法继续访问工作区。";
  }
  return null;
}
