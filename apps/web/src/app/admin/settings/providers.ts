export interface ProviderOption {
  defaultBaseUrl?: string;
  helpUrl?: string;
  label: string;
  value: string;
}

export const AI_PROVIDERS: ProviderOption[] = [
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

export const SEARCH_PROVIDERS: ProviderOption[] = [
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

export function defaultAiBaseUrl(provider: string): string {
  const defaults: Record<string, string> = {
    anthropic: "https://api.anthropic.com/v1",
    deepseek: "https://api.deepseek.com/v1",
    groq: "https://api.groq.com/openai/v1",
    openai: "https://api.openai.com/v1",
  };
  return defaults[provider] ?? "";
}