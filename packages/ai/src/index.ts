export interface AIProvider {
  generate(prompt: string, options?: Record<string, unknown>): Promise<string>;
  embed(input: string | string[]): Promise<number[][]>;
  stream(prompt: string, options?: Record<string, unknown>): AsyncIterable<string>;
}

export type AIProviderName = "anthropic" | "openai" | "openrouter" | "ollama";

export interface ProviderOptions {
  apiKey?: string;
  model?: string;
  baseURL?: string;
}

export { createAnthropicProvider } from "./anthropic.js";
export { createOpenAIProvider } from "./openai.js";
export { createOpenRouterProvider } from "./openrouter.js";
export { createOllamaProvider } from "./ollama.js";

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
    default:
      throw new Error(`Unknown provider: ${name}`);
  }
}
