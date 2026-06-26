import OpenAI from "openai";
import type { AIProvider } from "./index.js";

export function createCodexProvider(accessToken: string, model?: string): AIProvider {
  // Codex OAuth access token (from ChatGPT Plus/Pro subscription) is a standard
  // OpenAI Bearer token — works as apiKey in the SDK which sends it as
  // "Authorization: Bearer <token>". Default model: gpt-4o (available on Plus plan).
  const defaultModel = model ?? "gpt-4o";
  const client = new OpenAI({ apiKey: accessToken });

  return {
    async generate(prompt, options = {}) {
      const mdl = (options["model"] as string) ?? defaultModel;
      const maxTokens = (options["maxTokens"] as number) ?? 2048;
      const system = options["system"] as string | undefined;

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: prompt });

      const response = await client.chat.completions.create({
        model: mdl,
        max_tokens: maxTokens,
        messages,
      });

      return response.choices[0]?.message.content ?? "";
    },

    async embed(input) {
      const texts = Array.isArray(input) ? input : [input];
      const response = await client.embeddings.create({
        model: "text-embedding-3-small",
        input: texts,
      });
      return response.data.map(d => d.embedding);
    },

    async *stream(prompt, options = {}) {
      const mdl = (options["model"] as string) ?? defaultModel;
      const system = options["system"] as string | undefined;

      const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: prompt });

      const stream = await client.chat.completions.create({
        model: mdl,
        max_tokens: (options["maxTokens"] as number) ?? 2048,
        messages,
        stream: true,
      });

      for await (const chunk of stream) {
        const text = chunk.choices[0]?.delta.content;
        if (text) yield text;
      }
    },
  };
}
