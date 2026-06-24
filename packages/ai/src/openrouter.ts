import OpenAI from "openai";
import type { AIProvider } from "./index.js";

// OpenRouter is OpenAI-compatible. Their docs recommend using the openai SDK
// with a custom baseURL + two extra headers for dashboard tracking.
export function createOpenRouterProvider(
  apiKey: string,
  model = "openai/gpt-4o-mini"
): AIProvider {
  const client = new OpenAI({
    apiKey,
    baseURL: "https://openrouter.ai/api/v1",
    defaultHeaders: {
      "HTTP-Referer": "https://employeeos.app",
      "X-Title": "EmployeeOS"
    }
  });

  return {
    async generate(prompt, options = {}) {
      const useModel = (options["model"] as string) ?? model;
      const system = options["system"] as string | undefined;
      const maxTokens = (options["maxTokens"] as number) ?? 2048;

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: prompt });

      const response = await client.chat.completions.create({
        model: useModel,
        max_tokens: maxTokens,
        messages
      });

      return response.choices[0]?.message.content ?? "";
    },

    async embed(input) {
      // OpenRouter doesn't expose an embeddings endpoint; hash-based fallback
      const texts = Array.isArray(input) ? input : [input];
      return texts.map(text => {
        const hash = Array.from(text).reduce((acc, c) => acc ^ c.charCodeAt(0) * 31, 0);
        return Array.from({ length: 384 }, (_, i) => Math.sin(hash * (i + 1) * 0.01));
      });
    },

    async *stream(prompt, options = {}) {
      const useModel = (options["model"] as string) ?? model;
      const system = options["system"] as string | undefined;

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: prompt });

      const stream = await client.chat.completions.create({
        model: useModel,
        max_tokens: (options["maxTokens"] as number) ?? 2048,
        messages,
        stream: true
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta.content;
        if (text) yield text;
      }
    }
  };
}
