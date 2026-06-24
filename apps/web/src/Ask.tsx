import { useState, useRef, KeyboardEvent } from "react";
import { ask } from "./api";
import "./Ask.css";

interface Message { role: "user" | "ai"; text: string; }

export default function Ask() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const suggestions = [
    "What should we prioritize this quarter?",
    "Why are conversions down?",
    "What are our key risks right now?",
    "Give me a competitive analysis summary",
  ];

  const send = async (q?: string) => {
    const question = q ?? input.trim();
    if (!question || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: question }]);
    setLoading(true);
    try {
      const { answer } = await ask(question);
      setMessages((m) => [...m, { role: "ai", text: answer }]);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      setMessages((m) => [...m, { role: "ai", text: "Error: " + msg }]);
    } finally {
      setLoading(false);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="ask-layout">
      <div className="ask-messages">
        {messages.length === 0 && (
          <div className="ask-welcome">
            <div className="ask-welcome-icon">&#9676;</div>
            <div className="ask-welcome-title">Ask Your Company Brain</div>
            <div className="ask-welcome-sub">
              The brain has context about your goals, metrics, employees, and business history.
            </div>
            <div className="ask-suggestions">
              {suggestions.map((s) => (
                <button key={s} className="suggestion-chip" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} className={`message message-${m.role}`}>
            <div className="message-label">{m.role === "user" ? "You" : "Brain"}</div>
            <div className="message-text">{m.text}</div>
          </div>
        ))}

        {loading && (
          <div className="message message-ai">
            <div className="message-label">Brain</div>
            <div className="message-text thinking">Thinking...</div>
          </div>
        )}
      </div>

      <div className="ask-input-area">
        <textarea
          ref={inputRef}
          className="ask-input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Ask a business question... (Enter to send, Shift+Enter for newline)"
          rows={2}
          disabled={loading}
        />
        <button
          className="ask-send"
          onClick={() => send()}
          disabled={loading || !input.trim()}
        >
          Send
        </button>
      </div>
    </div>
  );
}
