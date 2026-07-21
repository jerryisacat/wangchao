"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle } from "lucide-react";
import { AuthCard } from "@/components/auth/auth-card";
import { AuthModeNotice } from "@/components/auth/auth-mode-notice";
import { PasswordField } from "@/components/auth/password-field";
import { StatusBanner } from "@/components/common/status-banner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { authClient } from "@/lib/auth-client";

interface LoginFormProps {
  authEnabled: boolean;
  denialMessage: string | null;
  returnPath: string;
}

export function LoginForm({
  authEnabled,
  denialMessage,
  returnPath,
}: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const errorId = error ? "login-form-error" : undefined;

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await authClient.signIn.email({ email, password });

      if (result.error) {
        setError("登录失败，请检查邮箱和密码后重试。");
        setLoading(false);
        return;
      }

      router.push(returnPath);
      router.refresh();
    } catch {
      setError("暂时无法连接认证服务，请稍后重试。");
      setLoading(false);
    }
  }

  return (
    <AuthCard
      description="使用邮箱和密码进入你的情报工作区。"
      footer={
        authEnabled ? (
          <Button asChild className="w-full" variant="ghost">
            <Link href="/register">还没有账号？立即注册</Link>
          </Button>
        ) : (
          <p className="text-center text-sm leading-relaxed text-muted-foreground">
            部署管理员启用认证后，登录表单会自动出现在这里。
          </p>
        )
      }
      title="登录望潮"
    >
      {denialMessage ? (
        <StatusBanner
          icon={<AlertCircle aria-hidden="true" size={16} />}
          message={denialMessage}
          tone="error"
        />
      ) : null}

      {authEnabled ? (
        <>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-2">
              <Label htmlFor="email">邮箱</Label>
              <Input
                aria-describedby={errorId}
                aria-invalid={Boolean(error)}
                autoComplete="email"
                disabled={loading}
                id="email"
                name="email"
                onChange={(event) => setEmail(event.target.value)}
                required
                type="email"
                value={email}
              />
            </div>
            <PasswordField
              autoComplete="current-password"
              disabled={loading}
              errorId={errorId}
              onChange={setPassword}
              value={password}
            />
            <p
              aria-live="polite"
              className={`min-h-5 text-sm leading-relaxed ${
                error ? "text-destructive" : "text-transparent"
              }`}
              id="login-form-error"
              role={error ? "alert" : undefined}
            >
              {error ?? "\u00A0"}
            </p>
            <Button className="w-full" disabled={loading} type="submit" variant="primary">
              {loading ? "正在验证…" : "登录"}
            </Button>
          </form>
          <AuthModeNotice enabled />
        </>
      ) : (
        <AuthModeNotice enabled={false} />
      )}
    </AuthCard>
  );
}
