"use client";

import { useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Eye, EyeOff, KeyRound, Loader2, Search } from "lucide-react";
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
  icon,
  label,
  variant,
}: {
  icon: React.ReactNode;
  label: string;
  variant: "primary" | "secondary";
}) {
  const { pending } = useFormStatus();
  return (
    <Button disabled={pending} size="sm" type="submit" variant={variant}>
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
  currentProvider?: string | null;
  formAction: (formData: FormData) => void;
  mode: "ai" | "search";
}

export function CredentialForm({
  currentProvider,
  formAction,
  mode,
}: CredentialFormProps) {
  const [showPassword, setShowPassword] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState(
    currentProvider ?? (mode === "ai" ? "openai" : "brave"),
  );
  const baseUrlRef = useRef<HTMLInputElement>(null);

  const providers = mode === "ai" ? AI_PROVIDERS : SEARCH_PROVIDERS;
  const provider = providers.find((p) => p.value === selectedProvider);
  const providerFieldName = mode === "ai" ? "aiProvider" : "searchProvider";
  const apiKeyFieldId = mode === "ai" ? "aiApiKey" : "searchApiKey";

  function handleProviderChange(value: string) {
    setSelectedProvider(value);
    if (mode === "ai" && baseUrlRef.current) {
      const selected = AI_PROVIDERS.find((p) => p.value === value);
      if (selected?.defaultBaseUrl && !baseUrlRef.current.value) {
        baseUrlRef.current.value = selected.defaultBaseUrl;
      }
    }
  }

  return (
    <form
      action={formAction}
      className="grid gap-3 rounded-md border border-border bg-[#0f0f13] p-4"
    >
      <div className="grid gap-2 text-xs font-bold text-muted-foreground">
        <Label htmlFor={apiKeyFieldId}>
          API Key{" "}
          <span className="font-normal text-muted-foreground/70">(必填)</span>
        </Label>
        <div className="relative">
          <Input
            autoComplete="off"
            className="pr-9"
            id={apiKeyFieldId}
            name={apiKeyFieldId}
            placeholder={
              mode === "ai" ? "输入新的 API Key" : "输入新的搜索 API Key"
            }
            required
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
              placeholder="https://api.openai.com/v1"
              ref={baseUrlRef}
              type="url"
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

      <SubmitButton
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
