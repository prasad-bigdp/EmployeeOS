import { Bot, InlineKeyboard } from "grammy";
import type { DatabaseService } from "@employeeos/database";
import type { AIProvider } from "@employeeos/ai";
import { answerQuestion, generateMorningBrief } from "@employeeos/reporter";

// -- Notifier (used by brain loop) -------------------------------------------

export function createTelegramNotifier(
  token: string,
  chatId: string
): (message: string) => void {
  return (message: string) => {
    // Fire-and-forget Telegram message via Bot API
    const url = `https://api.telegram.org/bot${token}/sendMessage`;
    fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text: message,
        parse_mode: "Markdown"
      })
    }).catch(() => {});
  };
}

// -- Plan notification with approve/reject buttons ---------------------------

export async function sendPlanNotification(
  token: string,
  chatId: string,
  planId: string,
  planTitle: string,
  employeeRole: string
): Promise<void> {
  const keyboard = new InlineKeyboard()
    .text("Approve", `approve:${planId}`)
    .text("Reject", `reject:${planId}`);

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text: `*New AI Plan*\n\n*${planTitle}*\n_by ${employeeRole}_`,
      parse_mode: "Markdown",
      reply_markup: keyboard
    })
  });
}

// -- Bot setup helper (used by onboarding) -----------------------------------

export async function detectChatId(token: string, timeoutMs = 60000): Promise<string | null> {
  let offset = 0;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(
        `https://api.telegram.org/bot${token}/getUpdates?offset=${offset}&timeout=10`
      );
      const data = await res.json() as { ok: boolean; result: Array<{ update_id: number; message?: { chat: { id: number } } }> };
      if (data.ok && data.result.length > 0) {
        for (const update of data.result) {
          offset = update.update_id + 1;
          if (update.message?.chat?.id) {
            return String(update.message.chat.id);
          }
        }
      }
    } catch {
      // network error, retry
    }
    await new Promise(r => setTimeout(r, 2000));
  }
  return null;
}

// -- Full bot (used by `employeeos telegram start`) --------------------------

export function createBot(
  token: string,
  db: DatabaseService,
  ai: AIProvider,
  companyId: string
): Bot {
  const bot = new Bot(token);

  bot.command("start", async (ctx) => {
    await ctx.reply(
      "🧠 *EmployeeOS — Company Brain*\n\nYour AI workforce is connected\\. Commands:\n\n" +
      "/brief \\- Morning intelligence brief\n" +
      "/status \\- Company health \\& goals\n" +
      "/plans \\- AI\\-generated plans\n" +
      "/ask \\<question\\> \\- Ask the brain anything\n" +
      "/help \\- Show this message",
      { parse_mode: "MarkdownV2" }
    );
  });

  bot.command("help", async (ctx) => {
    await ctx.reply(
      "*EmployeeOS Commands*\n\n" +
      "/brief — Morning intelligence brief\n" +
      "/status — Company health & goals\n" +
      "/plans — AI-generated plans\n" +
      "/ask <question> — Ask the brain anything",
      { parse_mode: "Markdown" }
    );
  });

  bot.command("brief", async (ctx) => {
    const msg = await ctx.reply("Generating brief...");
    try {
      const report = await db.getLatestReport(companyId, "morning_brief");
      if (report) {
        // Truncate for Telegram's 4096 char limit
        const text = report.body.slice(0, 3800);
        await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `*${report.title}*\n\n${text}`, { parse_mode: "Markdown" });
      } else {
        const result = await generateMorningBrief(db, ai, companyId);
        await db.createReport(companyId, result.title ?? "Morning Brief", result.body, "morning_brief", result.score);
        const text = result.body.slice(0, 3800);
        await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `*Morning Brief*\n\n${text}`, { parse_mode: "Markdown" });
      }
    } catch (e: unknown) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `Error: ${(e as Error).message}`);
    }
  });

  bot.command("status", async (ctx) => {
    try {
      const company = await db.getCompany();
      const goals = await db.getGoals(companyId);
      const employees = await db.getEmployees(companyId);
      const plans = await db.getPendingPlans(companyId);
      const score = await db.getLatestHealthScore(companyId);

      const lines = [
        `*${company?.name ?? "Your Company"}* — ${company?.industry ?? ""}`,
        score ? `Health Score: *${score.score}/100*` : "",
        "",
        `*Goals (${goals.length})*`,
        ...goals.map(g => `• ${g.title} — ${g.progress}%`),
        "",
        `*AI Employees (${employees.length})*`,
        ...employees.map(e => `• ${e.name} [${e.role}]`),
        "",
        plans.length > 0 ? `*${plans.length} plan${plans.length > 1 ? "s" : ""} pending approval* — use /plans` : "No pending plans"
      ].filter(l => l !== "").join("\n");

      await ctx.reply(lines, { parse_mode: "Markdown" });
    } catch (e: unknown) {
      await ctx.reply(`Error: ${(e as Error).message}`);
    }
  });

  bot.command("plans", async (ctx) => {
    try {
      const plans = await db.getPendingPlans(companyId);
      if (plans.length === 0) {
        await ctx.reply("No pending plans. The brain will generate plans during the next hourly tick.");
        return;
      }
      for (const plan of plans.slice(0, 5)) {
        const keyboard = new InlineKeyboard()
          .text("✓ Approve", `approve:${plan.id}`)
          .text("✗ Reject", `reject:${plan.id}`);
        await ctx.reply(
          `*${plan.title}*\n_${plan.employeeRole}_ · requires: ${plan.autonomyRequired}`,
          { parse_mode: "Markdown", reply_markup: keyboard }
        );
      }
    } catch (e: unknown) {
      await ctx.reply(`Error: ${(e as Error).message}`);
    }
  });

  bot.command("ask", async (ctx) => {
    const question = ctx.match?.trim();
    if (!question) {
      await ctx.reply("Usage: /ask what should we focus on this quarter?");
      return;
    }
    const msg = await ctx.reply("Thinking...");
    try {
      const answer = await answerQuestion(db, ai, companyId, question);
      await ctx.api.editMessageText(
        ctx.chat.id, msg.message_id,
        `*Q:* ${question}\n\n${answer.slice(0, 3800)}`,
        { parse_mode: "Markdown" }
      );
    } catch (e: unknown) {
      await ctx.api.editMessageText(ctx.chat.id, msg.message_id, `Error: ${(e as Error).message}`);
    }
  });

  // Inline button handlers for plan approval
  bot.callbackQuery(/^approve:(.+)$/, async (ctx) => {
    const planId = ctx.match[1];
    try {
      await db.updatePlanStatus(planId, "approved");
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
      await ctx.answerCallbackQuery({ text: "Plan approved!" });
      await ctx.reply(`Plan approved. EmployeeOS will execute it on the next cycle.`);
    } catch {
      await ctx.answerCallbackQuery({ text: "Error updating plan" });
    }
  });

  bot.callbackQuery(/^reject:(.+)$/, async (ctx) => {
    const planId = ctx.match[1];
    try {
      await db.updatePlanStatus(planId, "rejected");
      await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard() });
      await ctx.answerCallbackQuery({ text: "Plan rejected." });
    } catch {
      await ctx.answerCallbackQuery({ text: "Error updating plan" });
    }
  });

  bot.catch((err) => {
    console.error("[telegram] Error:", err.message);
  });

  return bot;
}

export async function startTelegramBot(
  token: string,
  db: DatabaseService,
  ai: AIProvider,
  companyId: string
): Promise<Bot> {
  const bot = createBot(token, db, ai, companyId);
  bot.start({ drop_pending_updates: true });
  return bot;
}
