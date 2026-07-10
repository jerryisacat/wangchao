"use client";

import { startTransition, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Check, Eye, EyeOff, KeyRound, Loader2, Search, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ProviderOption {
  defaultBaseUrl?: string;
  helpUrl?: string;
  label: string;
  value: string;
}

const AI_PROVIDERS: ProviderOption[] = [
  {
    defaultBaseUrl: "https://api.openai.com/v1",
    helpUrl: "https://platform.openai.com/api-keys",
    label: "OpenAI",
    value: "openai",
  },
  {
    helpUrl: "https://portal.azure.com/",
    label: "Azure OpenAI",
    value: "azure",
  },
  {
    defaultBaseUrl: "https://api.anthropic.com/v1",
    helpUrl: "https://console.anthropic.com/settings/keys",
    label: "Anthropic",
    value: "anthropic",
  },
  {
    defaultBaseUrl: "https://api.groq.com/openai/v1",
    helpUrl: "https://console.groq.com/keys",
    label: "Groq",
    value: "groq",
  },
  {
    defaultBaseUrl: "https://api.deepseek.com/v1",
    helpUrl: "https://platform.deepseek.com/api_keys",
    label: "DeepSeek",
    value: "deepseek",
  },
  {
    defaultBaseUrl: "",
    label: "自定义",
    value: "custom",
  },
];

const SEARCH_PROVIDERS: ProviderOption[] = [
  {
    helpUrl: "https://brave.com/search/api/",
    label: "Brave Search",
    value: "brave",
  },
  {
    helpUrl: "https://serpapi.com/dashboard",
    label: "SerpAPI",
    value: "serpapi",
  },
  {
    helpUrl: "https://app.tavily.com",
    label: "Tavily",
    value: "tavily",
  },
  {
    label: "自定义",
    value: "custom",
  },
];

function SubmitButton({
  disabled,
  icon,
  label,
  variant,
}: {
  disabled: boolean;
  icon: React.ReactNode;
  label: string;
  variant: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={disabled || pending} size="sm" type="submit" variant={variant}>
      {pending ? (
        <Loader2 aria-hidden="true" className="animate-spin" size={14} />
      ) : (
        icon
      )}
      {pending ? "保存中..." : label}
    </Button>
  );
}

interface CredentialFormProps {
  currentBaseUrl?: string | null;
  currentProvider?: string | null;
  formAction: (formData: FormData) => void;
  mode: "ai" | "search";
  testAction: (formData: FormData) => Promise<{ message: string; ok: boolean }>;
}

export function CredentialForm({
  currentBaseUrl,
  currentProvider,
  formAction,
  mode,
  testAction,
}: CredentialFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(
    currentProvider ?? (mode === "ai" ? "openai" : "brave"),
  );
  const [baseUrl, setBaseUrl] = useState(
    currentBaseUrl ??
      (mode === "ai"
        ? (AI_PROVIDERS.find((item) => item.value === (currentProvider ?? "openai"))
            ?.defaultBaseUrl ?? "")
        : ""),
  );
  const [validationError, setValidationError] = useState("");
  const [testResult, setTestResult] = useState<{
    message: string;
    ok: boolean;
  } | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const apiKeyRef = useRef<HTMLInputElement>(null);

  const providers = mode === "ai" ? AI_PROVIDERS : SEARCH_PROVIDERS;
  const provider = providers.find((p) => p.value === selectedProvider);
  const providerFieldName = mode === "ai" ? "aiProvider" : "searchProvider";
  const apiKeyFieldId = mode === "ai" ? "aiApiKey" : "searchApiKey";

  function handleProviderChange(value: string) {
    setSelectedProvider(value);
    if (mode === "ai") {
      const selected = AI_PROVIDERS.find((p) => p.value === value);
      setBaseUrl(selected?.defaultBaseUrl ?? "");
    }
    setTestResult(null);
  }

  function handleInputChange() {
    setTestResult(null);
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    const apiKey = apiKeyRef.current?.value?.trim() ?? "";
    if (!apiKey) {
      event.preventDefault();
      setValidationError("API Key 为必填项，请输入后再提交。");
      apiKeyRef.current?.focus();
      return;
    }
    if (!testResult?.ok) {
      event.preventDefault();
      setValidationError("请先测试当前 API 配置，测试通过后再保存。");
      return;
    }
    setValidationError("");
  }

  function handleTest() {
    const form = formRef.current;
    const apiKey = apiKeyRef.current?.value?.trim() ?? "";
    if (!form || !apiKey) {
      setValidationError("API Key 为必填项，请输入后再测试。");
      apiKeyRef.current?.focus();
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
      className="grid gap-3 rounded-md border border-border bg-[#0f0f13] p-4"
      ref={formRef}
      onSubmit={handleSubmit}
    >
      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor={apiKeyFieldId}>
          API Key{" "}
          <span className="font-normal text-muted-foreground/70">(必填)</span>
        </Label>
        <div className="relative">
          <Input
            ref={apiKeyRef}
            autoComplete="off"
            className="pr-9"
            id={apiKeyFieldId}
            name={apiKeyFieldId}
            onChange={handleInputChange}
            placeholder={
              mode === "ai" ? "输入新的 API Key" : "输入新的搜索 API Key"
            }
            type={showPassword ? "text" : "password"}
          />
          <button
            aria-label={showPassword ? "隐藏 Key" : "显示 Key"}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setShowPassword((prev) => !prev)}
            tabIndex={-1}
            type="button"
          >
            {showPassword ? (
              <EyeOff aria-hidden="true" size={16} />
            ) : (
              <Eye aria-hidden="true" size={16} />
            )}
          </button>
        </div>
        {validationError ? (
          <p className="text-xs font-normal text-destructive">
            {validationError}
          </p>
        ) : null}
      </div>

      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor={providerFieldName}>
          Provider{" "}
          <span className="font-normal text-muted-foreground/70">(必填)</span>
        </Label>
        <select
          aria-label="Provider"
          className="h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-xs outline-none transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 dark:bg-input/30"
          name={providerFieldName}
          onChange={(e) => handleProviderChange(e.target.value)}
          value={selectedProvider}
        >
          {providers.map((p) => (
            <option
              className="bg-[#121216] text-foreground"
              key={p.value}
              value={p.value}
            >
              {p.label}
            </option>
          ))}
        </select>
        {provider?.helpUrl ? (
          <a
            className="text-xs font-normal text-muted-foreground underline-offset-4 hover:underline"
            href={provider.helpUrl}
            rel="noopener noreferrer"
            target="_blank"
          >
            获取 API Key →
          </a>
        ) : null}
      </div>

      {mode === "ai" ? (
        <>
          <div className="grid gap-2 text-xs font-bold text-muted-foreground">
            <Label htmlFor="aiBaseUrl">
              Base URL{" "}
              <span className="font-normal text-muted-foreground/70">
                (可选)
              </span>
            </Label>
            <Input
              id="aiBaseUrl"
              name="aiBaseUrl"
              onChange={(event) => {
                setBaseUrl(event.target.value);
                handleInputChange();
              }}
              placeholder="https://api.openai.com/v1"
              type="url"
              value={baseUrl}
            />
          </div>
          <div className="grid gap-2 text-xs font-bold text-muted-foreground">
            <Label htmlFor="aiModel">
              模型{" "}
              <span className="font-normal text-muted-foreground/70">
                (可选)
              </span>
            </Label>
            <Input
              id="aiModel"
              name="aiModel"
              placeholder="gpt-4o-mini"
              type="text"
            />
          </div>
        </>
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

      <SubmitButton
        disabled={!testResult?.ok}
        icon={
          mode === "ai" ? (
            <KeyRound aria-hidden="true" size={14} />
          ) : (
            <Search aria-hidden="true" size={14} />
          )
        }
        label={mode === "ai" ? "保存 AI 凭证" : "保存搜索凭证"}
        variant={mode === "ai" ? "primary" : "secondary"}
      />
    </form>
  );
}
