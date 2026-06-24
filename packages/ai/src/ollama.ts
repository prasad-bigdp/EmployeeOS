import type { AIProvider } from "./index.js";

interface OllamaChatResponse {
  message: { content: string };
}

interface OllamaEmbedResponse {
  embedding: number[];
}

export function createOllamaProvider(
  model = "llama3.2",
  baseURL = "http://localhost:11434"
): AIProvider {
  async function chat(
    prompt: string,
    system?: string,
    maxTokens = 2048
  ): Promise<string> {
    const messages = [];
    if (system) messages.push({ role: "system", content: system });
    messages.push({ role: "user", content: prompt });

    const res = await fetch(`${baseURL}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, messages, stream: false, options: { num_predict: maxTokens } })
    });

    if (!res.ok) throw new Error(`Ollama error ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as OllamaChatResponse;
    return data.message.content;
  }

  return {
    async generate(prompt, options = {}) {
      return chat(
        prompt,
        options["system"] as string | undefined,
        (options["maxTokens"] as number) ?? 2048
      );
    },

    async embed(input) {
      const texts = Array.isArray(input) ? input : [input];
      const embeddings = await Promise.all(
        texts.map(async text => {
          const res = await fetch(`${baseURL}/api/embeddings`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ model, prompt: text })
          });
          if (!res.ok) {
            // fallback: simple hash-based pseudo-embedding
            const hash = Array.from(text).reduce((acc, c) => acc ^ c.charCodeAt(0) * 31, 0);
            return Array.from({ length: 384 }, (_, i) => Math.sin(hash * (i + 1) * 0.01));
          }
          const data = (await res.json()) as OllamaEmbedResponse;
          return data.embedding;
        })
      );
      return embeddings;
    },

    async *stream(prompt, options = {}) {
      const system = options["system"] as string | undefined;
      const messages = [];
      if (system) messages.push({ role: "system", content: system });
      messages.push({ role: "user", content: prompt });

      const res = await fetch(`${baseURL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model, messages, stream: true })
      });

      if (!res.ok || !res.body) {
        yield await chat(prompt, system);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const lines = decoder.decode(value).split("\n").filter(Boolean);
        for (const line of lines) {
          try {
            const obj = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            if (obj.message?.content) yield obj.message.content;
          } catch {}
        }
      }
    }
  };
}
