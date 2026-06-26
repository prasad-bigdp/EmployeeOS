import path from "node:path";
import os from "node:os";
import type { DatabaseService } from "@employeeos/database";
import type { AIProvider } from "@employeeos/ai";
import { answerQuestion, getOrGenerateBrief } from "@employeeos/reporter";

const SESSION_DIR = path.join(os.homedir(), ".employeeos", "whatsapp-session");

// -- Notifier (used by brain loop) -------------------------------------------

export function createWhatsAppNotifier(
  targetNumber: string
): (message: string) => void {
  return (message: string) => {
    // Fire-and-forget — lazy import to avoid loading puppeteer on startup
    import("whatsapp-web.js").then(async ({ Client, LocalAuth }) => {
      const client = new Client({
        authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
        puppeteer: { headless: true, args: ["--no-sandbox"] },
      });
      await new Promise<void>((resolve) => {
        client.once("ready", async () => {
          try {
            const chatId = targetNumber.includes("@c.us") ? targetNumber : `${targetNumber}@c.us`;
            await client.sendMessage(chatId, message);
          } finally {
            await client.destroy();
            resolve();
          }
        });
        client.initialize().catch(() => resolve());
      });
    }).catch(() => {});
  };
}

// -- QR-code setup (interactive, used during onboarding) ---------------------

export async function setupWhatsApp(
  targetNumber: string,
  onQR: (qrText: string) => void
): Promise<{ success: boolean; phone: string }> {
  const { Client, LocalAuth } = await import("whatsapp-web.js");

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: { headless: true, args: ["--no-sandbox"] },
  });

  return new Promise((resolve) => {
    const timeout = setTimeout(() => {
      client.destroy().catch(() => {});
      resolve({ success: false, phone: "" });
    }, 120_000);

    client.on("qr", onQR);

    client.once("ready", async () => {
      clearTimeout(timeout);
      try {
        const info = client.info;
        const phone = info.wid.user;
        const chatId = targetNumber.includes("@c.us") ? targetNumber : `${targetNumber}@c.us`;
        await client.sendMessage(chatId, "EmployeeOS connected! You'll receive brain alerts here.");
        await client.destroy();
        resolve({ success: true, phone });
      } catch {
        await client.destroy().catch(() => {});
        resolve({ success: false, phone: "" });
      }
    });

    client.on("auth_failure", () => {
      clearTimeout(timeout);
      client.destroy().catch(() => {});
      resolve({ success: false, phone: "" });
    });

    client.initialize().catch(() => {
      clearTimeout(timeout);
      resolve({ success: false, phone: "" });
    });
  });
}

// -- Full bot with message commands ------------------------------------------

export async function startWhatsAppBot(
  targetNumber: string,
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  onLog?: (msg: string) => void
): Promise<() => Promise<void>> {
  const { Client, LocalAuth } = await import("whatsapp-web.js");

  const client = new Client({
    authStrategy: new LocalAuth({ dataPath: SESSION_DIR }),
    puppeteer: { headless: true, args: ["--no-sandbox"] },
  });

  const chatId = targetNumber.includes("@c.us") ? targetNumber : `${targetNumber}@c.us`;

  client.on("qr", (qr) => {
    onLog?.(`[whatsapp] Scan QR code to authenticate:\n${qr}`);
  });

  client.once("ready", () => {
    onLog?.("[whatsapp] Bot ready");
    client.sendMessage(chatId, "EmployeeOS brain connected. Commands: !brief, !status, !plans, !ask <question>").catch(() => {});
  });

  client.on("message", async (msg) => {
    if (msg.from !== chatId && msg.from.replace("@c.us", "") !== targetNumber) return;
    const body = msg.body.trim();

    if (body === "!brief") {
      try {
        const report = await getOrGenerateBrief(db, ai, companyId);
        await msg.reply(`*${report.title}*\n\n${report.body.slice(0, 3000)}`);
      } catch (e: unknown) {
        await msg.reply(`Error: ${(e as Error).message}`);
      }
    } else if (body === "!status") {
      try {
        const company = await db.getCompany();
        const goals = await db.getGoals(companyId);
        const employees = await db.getEmployees(companyId);
        const plans = await db.getPendingPlans(companyId);
        const score = await db.getLatestHealthScore(companyId);
        const lines = [
          `*${company?.name ?? "Company"}*`,
          score ? `Health: ${score.score}/100` : "",
          `Goals: ${goals.length} active`,
          `Employees: ${employees.length}`,
          plans.length > 0 ? `${plans.length} plans pending — reply !plans` : "No pending plans",
        ].filter(Boolean).join("\n");
        await msg.reply(lines);
      } catch (e: unknown) {
        await msg.reply(`Error: ${(e as Error).message}`);
      }
    } else if (body === "!plans") {
      try {
        const plans = await db.getPendingPlans(companyId);
        if (plans.length === 0) {
          await msg.reply("No pending plans.");
          return;
        }
        for (const plan of plans.slice(0, 3)) {
          await msg.reply(
            `*${plan.title}*\n_${plan.employeeRole}_ · ${plan.autonomyRequired}\n\nReply: !approve ${plan.id} or !reject ${plan.id}`
          );
        }
      } catch (e: unknown) {
        await msg.reply(`Error: ${(e as Error).message}`);
      }
    } else if (body.startsWith("!approve ")) {
      const planId = body.replace("!approve ", "").trim();
      await db.updatePlanStatus(planId, "approved");
      await db.createEvent(companyId, "plan.approved", { planId, source: "whatsapp" });
      await msg.reply("Plan approved.");
    } else if (body.startsWith("!reject ")) {
      const planId = body.replace("!reject ", "").trim();
      await db.updatePlanStatus(planId, "rejected");
      await db.createEvent(companyId, "plan.rejected", { planId, source: "whatsapp" });
      await msg.reply("Plan rejected.");
    } else if (body.startsWith("!ask ")) {
      const question = body.replace("!ask ", "").trim();
      try {
        await msg.reply("Thinking...");
        const answer = await answerQuestion(db, ai, companyId, question);
        await msg.reply(answer.slice(0, 3000));
      } catch (e: unknown) {
        await msg.reply(`Error: ${(e as Error).message}`);
      }
    }
  });

  await client.initialize();
  return () => client.destroy();
}
