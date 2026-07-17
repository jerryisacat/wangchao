"use client";

import { startTransition, useRef, useState } from "react";
import { Check, Eye, EyeOff, Loader2, MessageCircle, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function TelegramCredentialForm({
  currentChatId,
  formAction,
  testAction,
}: {
  currentChatId: string | null;
  formAction: (formData: FormData) => void;
  testAction: (formData: FormData) => Promise<{ message: string; ok: boolean }>;
}) {
  const [showToken, setShowToken] = useState(false);
  const [botToken, setBotToken] = useState("");
  const [chatId, setChatId] = useState(currentChatId ?? "");
  const [validationError, setValidationError] = useState("");
  const [testResult, setTestResult] = useState<{
    message: string;
    ok: boolean;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const tokenRef = useRef<HTMLInputElement>(null);

  function handleInputChange() {
    setTestResult(null);
  }

  function handleTokenChange(value: string) {
    setBotToken(value);
    handleInputChange();
  }

  function handleChatIdChange(value: string) {
    setChatId(value);
    handleInputChange();
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    if (!botToken.trim()) {
      event.preventDefault();
      setValidationError("Bot Token 为必填项。");
      tokenRef.current?.focus();
      return;
    }
    if (!chatId.trim()) {
      event.preventDefault();
      setValidationError("Chat ID 为必填项。");
      return;
    }
    if (!testResult?.ok) {
      event.preventDefault();
      setValidationError("请先测试当前配置，测试通过后再保存。");
      return;
    }
    setValidationError("");
  }

  function handleTest() {
    const form = formRef.current;
    if (!form || !botToken.trim()) {
      setValidationError("请输入 Bot Token 后再测试。");
      tokenRef.current?.focus();
      return;
    }
    if (!chatId.trim()) {
      setValidationError("请输入 Chat ID 后再测试。");
      return;
    }

    setValidationError("");
    setIsTesting(true);
    setTestResult(null);
    startTransition(async () => {
      try {
        setTestResult(await testAction(new FormData(form)));
      } catch {
        setTestResult({ message: "测试未完成，请稍后重试。", ok: false });
      } finally {
        setIsTesting(false);
      }
    });
  }

  return (
    <form
      action={formAction}
      className="grid gap-3 rounded-[16px] bg-muted p-4"
      ref={formRef}
      onSubmit={handleSubmit}
    >
      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor="telegramBotToken">
          Bot Token{" "}
          <span className="font-normal text-muted-foreground">(必填)</span>
        </Label>
        <div className="relative">
          <Input
            ref={tokenRef}
            autoComplete="off"
            className="pr-11"
            id="telegramBotToken"
            name="telegramBotToken"
            onChange={(event) => handleTokenChange(event.target.value)}
            placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11"
            type={showToken ? "text" : "password"}
            value={botToken}
          />
          <button
            aria-label={showToken ? "隐藏 Token" : "显示 Token"}
            className="absolute inset-y-0 right-0 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowToken((prev) => !prev)}
            type="button"
          >
            {showToken ? (
              <EyeOff aria-hidden="true" size={16} />
            ) : (
              <Eye aria-hidden="true" size={16} />
            )}
          </button>
        </div>
      </div>

      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor="telegramChatId">
          Chat ID{" "}
          <span className="font-normal text-muted-foreground">(必填)</span>
        </Label>
        <Input
          id="telegramChatId"
          name="telegramChatId"
          onChange={(event) => handleChatIdChange(event.target.value)}
          placeholder="-1001234567890 或 @channelname"
          type="text"
          value={chatId}
        />
      </div>

      {validationError ? (
        <p className="text-xs font-normal text-destructive">
          {validationError}
        </p>
      ) : null}

      {testResult ? (
        <p
          aria-live="polite"
          className={
            testResult.ok
              ? "flex items-center gap-1.5 text-xs font-normal text-success"
              : "text-xs font-normal text-destructive"
          }
        >
          {testResult.ok ? <Check aria-hidden="true" size={14} /> : null}
          {testResult.message}
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          disabled={isTesting}
          onClick={handleTest}
          size="sm"
          type="button"
          variant="secondary"
        >
          {isTesting ? (
            <Loader2 aria-hidden="true" className="animate-spin" size={14} />
          ) : (
            <Zap aria-hidden="true" size={14} />
          )}
          {isTesting ? "测试中..." : "测试当前配置"}
        </Button>
        {testResult?.ok ? (
          <span className="flex min-h-11 items-center text-xs text-success">
            测试通过，可以保存
          </span>
        ) : null}
      </div>

      <Button
        disabled={!testResult?.ok}
        size="sm"
        type="submit"
        variant="primary"
      >
        <MessageCircle aria-hidden="true" size={14} />
        保存 Telegram 凭证
      </Button>
    </form>
  );
}
