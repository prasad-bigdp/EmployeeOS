export interface AIProvider {
  generate(prompt: string, options?: Record<string, unknown>): Promise<string>;
  embed(input: string | string[]): Promise<number[][]>;
  stream(prompt: string, options?: Record<string, unknown>): AsyncIterable<string>;
}

export interface UsageRecord {
  inputTokens: number;
  outputTokens: number;
  model?: string;
  employeeRole?: string;
  recordedAt: string;
}

export function createTrackedProvider(
  provider: AIProvider,
  onUsage: (usage: UsageRecord) => void,
  employeeRole?: string
): AIProvider {
  return {
    generate: async (prompt, options) => {
      const text = await provider.generate(prompt, options);
      onUsage({
        inputTokens: Math.ceil(prompt.length / 4),
        outputTokens: Math.ceil(text.length / 4),
        model: (options?.model as string) ?? undefined,
        employeeRole,
        recordedAt: new Date().toISOString(),
      });
      return text;
    },
    embed: provider.embed.bind(provider),
    stream: provider.stream.bind(provider),
  };
}

export type AIProviderName = "anthropic" | "openai" | "openrouter" | "ollama" | "claude-code" | "codex";

export interface ProviderOptions {
  apiKey?: string;
  authToken?: string;
  model?: string;
  baseURL?: string;
}

export { createAnthropicProvider } from "./anthropic.js";
export { createOpenAIProvider } from "./openai.js";
export { createOpenRouterProvider } from "./openrouter.js";
export { createOllamaProvider } from "./ollama.js";
export { createClaudeCodeProvider } from "./claude-code.js";
export { createCodexProvider } from "./codex.js";

export async function createProvider(
  name: AIProviderName,
  options: ProviderOptions | string
): Promise<AIProvider> {
  const opts: ProviderOptions =
    typeof options === "string" ? { apiKey: options } : options;

  switch (name) {
    case "anthropic": {
      const { createAnthropicProvider } = await import("./anthropic.js");
      return createAnthropicProvider(opts.apiKey ?? "");
    }
    case "openai": {
      const { createOpenAIProvider } = await import("./openai.js");
      return createOpenAIProvider(opts.apiKey ?? "", undefined, opts.model);
    }
    case "openrouter": {
      const { createOpenRouterProvider } = await import("./openrouter.js");
      return createOpenRouterProvider(opts.apiKey ?? "", opts.model);
    }
    case "ollama": {
      const { createOllamaProvider } = await import("./ollama.js");
      return createOllamaProvider(
        opts.model ?? "llama3.2",
        opts.baseURL ?? "http://localhost:11434"
      );
    }
    case "claude-code": {
      const { createClaudeCodeProvider } = await import("./claude-code.js");
      return createClaudeCodeProvider(opts.authToken ?? opts.apiKey ?? "");
    }
    case "codex": {
      const { createCodexProvider } = await import("./codex.js");
      return createCodexProvider(opts.authToken ?? opts.apiKey ?? "", opts.model);
    }
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
