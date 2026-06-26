import Anthropic from "@anthropic-ai/sdk";
import type { AIProvider } from "./index.js";

export function createClaudeCodeProvider(authToken: string): AIProvider {
  // Uses OAuth Bearer token from Claude Code subscription (Pro/Max/Teams/Enterprise).
  // authToken corresponds to ANTHROPIC_AUTH_TOKEN / CLAUDE_CODE_OAUTH_TOKEN — sent as
  // "Authorization: Bearer <token>" rather than the API-key header.
  const client = new Anthropic({ authToken });

  return {
    async generate(prompt, options = {}) {
      const model = (options["model"] as string) ?? "claude-sonnet-4-6";
      const maxTokens = (options["maxTokens"] as number) ?? 2048;
      const system = options["system"] as string | undefined;

      const message = await client.messages.create({
        model,
        max_tokens: maxTokens,
        messages: [{ role: "user", content: prompt }],
        ...(system ? { system } : {}),
      });

      const block = message.content[0];
      return block?.type === "text" ? block.text : "";
    },

    async embed(input) {
      const texts = Array.isArray(input) ? input : [input];
      return texts.map(t => simpleEmbed(t));
    },

    async *stream(prompt, options = {}) {
      const model = (options["model"] as string) ?? "claude-sonnet-4-6";
      const maxTokens = (options["maxTokens"] as number) ?? 2048;
      const system = options["system"] as string | undefined;

      const stream = await client.messages.create({
        model,
        max_tokens: maxTokens,
        stream: true,
        messages: [{ role: "user", content: prompt }],
        ...(system ? { system } : {}),
      });

      for await (const event of stream) {
        if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          yield event.delta.text;
        }
      }
    },
  };
}

function simpleEmbed(text: string): number[] {
  const words = text.toLowerCase().split(/\W+/).filter(Boolean);
  const vec = new Array(256).fill(0);
  for (const w of words) {
    let h = 5381;
    for (let i = 0; i < w.length; i++) {
      h = ((h << 5) + h + w.charCodeAt(i)) >>> 0;
    }
    vec[h % 256] = (vec[h % 256] ?? 0) + 1;
  }
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}
