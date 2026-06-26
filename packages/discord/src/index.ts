import {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  Events,
  REST,
  Routes,
  SlashCommandBuilder,
  type Interaction,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
} from "discord.js";
import type { DatabaseService } from "@employeeos/database";
import type { AIProvider } from "@employeeos/ai";
import { answerQuestion, getOrGenerateBrief } from "@employeeos/reporter";

// -- Notifier (used by brain loop) -------------------------------------------

export function createDiscordNotifier(
  token: string,
  channelId: string
): (message: string) => void {
  return (message: string) => {
    const client = new Client({ intents: [] });
    client.login(token).then(async () => {
      try {
        const channel = await client.channels.fetch(channelId);
        if (channel && channel.isTextBased()) {
          await (channel as { send(msg: string): Promise<unknown> }).send(message.slice(0, 2000));
        }
      } finally {
        client.destroy();
      }
    }).catch(() => {});
  };
}

// -- Slash command registration ----------------------------------------------

const COMMANDS = [
  new SlashCommandBuilder().setName("brief").setDescription("Get today's morning brief"),
  new SlashCommandBuilder().setName("status").setDescription("Company health, goals, and pending plans"),
  new SlashCommandBuilder().setName("plans").setDescription("View and approve pending AI plans"),
  new SlashCommandBuilder()
    .setName("ask")
    .setDescription("Ask the company brain a question")
    .addStringOption(opt =>
      opt.setName("question").setDescription("Your question").setRequired(true)
    ),
].map(cmd => cmd.toJSON());

export async function registerSlashCommands(token: string, clientId: string, guildId?: string) {
  const rest = new REST().setToken(token);
  if (guildId) {
    await rest.put(Routes.applicationGuildCommands(clientId, guildId), { body: COMMANDS });
  } else {
    await rest.put(Routes.applicationCommands(clientId), { body: COMMANDS });
  }
}

// -- Full bot ----------------------------------------------------------------

export function createDiscordBot(
  token: string,
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  channelId: string
): Client {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds],
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`[discord] Bot ready as ${c.user.tag}`);
  });

  client.on(Events.InteractionCreate, async (interaction: Interaction) => {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction, db, ai, companyId);
    } else if (interaction.isButton()) {
      await handleButton(interaction, db, companyId);
    }
  });

  client.login(token).catch((e) => console.error("[discord] Login failed:", e.message));
  return client;
}

async function handleSlashCommand(
  interaction: ChatInputCommandInteraction,
  db: DatabaseService,
  ai: AIProvider,
  companyId: string
) {
  switch (interaction.commandName) {
    case "brief": {
      await interaction.deferReply();
      try {
        const report = await getOrGenerateBrief(db, ai, companyId);
        const text = `**${report.title}**\n\n${report.body.slice(0, 1900)}`;
        await interaction.editReply(text);
      } catch (e: unknown) {
        await interaction.editReply(`Error: ${(e as Error).message}`);
      }
      break;
    }

    case "status": {
      await interaction.deferReply();
      try {
        const company = await db.getCompany();
        const goals = await db.getGoals(companyId);
        const employees = await db.getEmployees(companyId);
        const plans = await db.getPendingPlans(companyId);
        const score = await db.getLatestHealthScore(companyId);

        const lines = [
          `**${company?.name ?? "Your Company"}** — ${company?.industry ?? ""}`,
          score ? `Health Score: **${score.score}/100**` : "",
          "",
          `**Goals (${goals.length})**`,
          ...goals.map(g => `• ${g.title} — ${g.progress}%`),
          "",
          `**AI Employees (${employees.length})**`,
          ...employees.map(e => `• ${e.name} [${e.role}]`),
          "",
          plans.length > 0
            ? `**${plans.length} plan${plans.length > 1 ? "s" : ""} pending** — use /plans`
            : "No pending plans",
        ].filter(l => l !== "").join("\n");

        await interaction.editReply(lines.slice(0, 2000));
      } catch (e: unknown) {
        await interaction.editReply(`Error: ${(e as Error).message}`);
      }
      break;
    }

    case "plans": {
      await interaction.deferReply();
      try {
        const plans = await db.getPendingPlans(companyId);
        if (plans.length === 0) {
          await interaction.editReply("No pending plans. The brain will generate plans on the next tick.");
          return;
        }
        const plan = plans[0]!;
        const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
          new ButtonBuilder()
            .setCustomId(`approve:${plan.id}`)
            .setLabel("Approve")
            .setStyle(ButtonStyle.Success),
          new ButtonBuilder()
            .setCustomId(`reject:${plan.id}`)
            .setLabel("Reject")
            .setStyle(ButtonStyle.Danger)
        );
        await interaction.editReply({
          content: `**${plan.title}**\n*${plan.employeeRole}* · requires: ${plan.autonomyRequired}\n\n${plans.length > 1 ? `(+${plans.length - 1} more — run /plans again after)` : ""}`,
          components: [row],
        });
      } catch (e: unknown) {
        await interaction.editReply(`Error: ${(e as Error).message}`);
      }
      break;
    }

    case "ask": {
      const question = interaction.options.getString("question", true);
      await interaction.deferReply();
      try {
        const answer = await answerQuestion(db, ai, companyId, question);
        await interaction.editReply(`**Q:** ${question}\n\n${answer.slice(0, 1900)}`);
      } catch (e: unknown) {
        await interaction.editReply(`Error: ${(e as Error).message}`);
      }
      break;
    }
  }
}

async function handleButton(
  interaction: ButtonInteraction,
  db: DatabaseService,
  companyId: string
) {
  const [action, planId] = interaction.customId.split(":");
  if (!planId) return;

  try {
    if (action === "approve") {
      await db.updatePlanStatus(planId, "approved");
      await db.createEvent(companyId, "plan.approved", { planId, source: "discord" });
      await interaction.update({ content: `Plan approved.`, components: [] });
    } else if (action === "reject") {
      await db.updatePlanStatus(planId, "rejected");
      await db.createEvent(companyId, "plan.rejected", { planId, source: "discord" });
      await interaction.update({ content: `Plan rejected.`, components: [] });
    }
  } catch {
    await interaction.reply({ content: "Error updating plan.", ephemeral: true });
  }
}

export async function startDiscordBot(
  token: string,
  db: DatabaseService,
  ai: AIProvider,
  companyId: string,
  channelId: string
): Promise<Client> {
  return createDiscordBot(token, db, ai, companyId, channelId);
}
