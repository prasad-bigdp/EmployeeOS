import { useEffect, useRef, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import "./Terminal.css";

interface Props {
  onConnectionChange: (connected: boolean) => void;
}

interface BrainMessage {
  type: "log" | "connected";
  message: string;
  time: string;
}

const WS_URL = (() => {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/ws/terminal`;
})();

export default function BrainTerminal({ onConnectionChange }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const write = useCallback((text: string) => {
    termRef.current?.write(text);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;

    const ws = new WebSocket(WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      onConnectionChange(true);
      write("\r\n\x1b[32m[connected]\x1b[0m Brain WebSocket established\r\n");
    };

    ws.onmessage = (event: MessageEvent<string>) => {
      try {
        const msg: BrainMessage = JSON.parse(event.data);
        const time = new Date(msg.time).toLocaleTimeString();
        const prefix = `\x1b[90m${time}\x1b[0m `;

        if (msg.type === "log") {
          const colored = colorize(msg.message);
          write(`${prefix}${colored}\r\n`);
        } else if (msg.type === "connected") {
          write(`\x1b[35m${msg.message}\x1b[0m\r\n`);
        }
      } catch {
        write(event.data + "\r\n");
      }
    };

    ws.onclose = () => {
      onConnectionChange(false);
      write("\r\n\x1b[33m[disconnected]\x1b[0m Reconnecting in 3s...\r\n");
      reconnectTimer.current = setTimeout(connect, 3000);
    };

    ws.onerror = () => {
      write("\x1b[31m[error]\x1b[0m WebSocket error\r\n");
    };
  }, [onConnectionChange, write]);

  useEffect(() => {
    if (!containerRef.current) return;

    const term = new Terminal({
      theme: {
        background: "#0a0a0f",
        foreground: "#e2e8f0",
        cursor: "#7c3aed",
        cursorAccent: "#0a0a0f",
        black: "#1e1e2e",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#f59e0b",
        blue: "#3b82f6",
        magenta: "#7c3aed",
        cyan: "#06b6d4",
        white: "#e2e8f0",
        brightBlack: "#64748b",
        brightGreen: "#4ade80",
        brightYellow: "#fbbf24",
        brightMagenta: "#a78bfa",
      },
      fontFamily: '"Cascadia Code", "Fira Code", Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.5,
      cursorStyle: "block",
      cursorBlink: true,
      scrollback: 2000,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(containerRef.current);
    fit.fit();

    termRef.current = term;
    fitRef.current = fit;

    // Banner
    term.writeln("\x1b[35m EmployeeOS — Company Brain\x1b[0m");
    term.writeln("\x1b[90m Waiting for brain activity...\x1b[0m");
    term.writeln("");

    connect();

    const onResize = () => fit.fit();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      wsRef.current?.close();
      term.dispose();
    };
  }, [connect]);

  return (
    <div className="terminal-outer">
      <div className="terminal-header">
        <span className="terminal-dot red" />
        <span className="terminal-dot yellow" />
        <span className="terminal-dot green" />
        <span className="terminal-label">brain.log</span>
      </div>
      <div ref={containerRef} className="terminal-container" />
    </div>
  );
}

function colorize(msg: string): string {
  if (msg.includes("[brain]") || msg.startsWith("Brain")) return `\x1b[35m${msg}\x1b[0m`;
  if (msg.includes("ERROR") || msg.includes("error")) return `\x1b[31m${msg}\x1b[0m`;
  if (msg.includes("WARN") || msg.includes("warn")) return `\x1b[33m${msg}\x1b[0m`;
  if (msg.includes("OK") || msg.includes("done") || msg.includes("success")) return `\x1b[32m${msg}\x1b[0m`;
  if (msg.includes("plan") || msg.includes("Plan")) return `\x1b[36m${msg}\x1b[0m`;
  return msg;
}
