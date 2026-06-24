import fs from "node:fs";
import path from "node:path";

export interface Skill {
  name: string;
  description: string;
  roles: string[];
  body: string;
  filename: string;
}

// Minimal frontmatter parser — reads ---\n key: value\n--- blocks
function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const meta: Record<string, string> = {};
  const lines = content.split("\n");

  if (lines[0]?.trim() !== "---") {
    return { meta, body: content };
  }

  let endIdx = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") { endIdx = i; break; }
    const match = lines[i]?.match(/^(\w[\w-]*):\s*(.+)$/);
    if (match) meta[match[1]!] = match[2]!.trim();
  }

  const body = endIdx >= 0 ? lines.slice(endIdx + 1).join("\n").trim() : content;
  return { meta, body };
}

function parseRoles(raw?: string): string[] {
  if (!raw) return ["*"];
  return raw
    .replace(/[\[\]]/g, "")
    .split(",")
    .map(r => r.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
}

export function loadSkills(skillsDir: string): Skill[] {
  if (!fs.existsSync(skillsDir)) return [];

  const files = fs.readdirSync(skillsDir).filter(f => f.endsWith(".md"));
  const skills: Skill[] = [];

  for (const file of files) {
    const content = fs.readFileSync(path.join(skillsDir, file), "utf-8");
    const { meta, body } = parseFrontmatter(content);
    if (!body.trim()) continue;

    skills.push({
      name: meta["name"] ?? path.basename(file, ".md"),
      description: meta["description"] ?? "",
      roles: parseRoles(meta["roles"]),
      body,
      filename: file,
    });
  }

  return skills;
}

export function getSkillContext(skills: Skill[], role: string): string {
  const matching = skills.filter(
    s => s.roles.includes("*") || s.roles.includes(role)
  );
  if (matching.length === 0) return "";

  return [
    "=== Custom Skills (follow these instructions) ===",
    ...matching.map(s => `[${s.name}]: ${s.body}`),
  ].join("\n\n");
}

export function listSkills(skills: Skill[]): void {
  if (skills.length === 0) {
    console.log("  No skills loaded.");
    return;
  }
  for (const s of skills) {
    const roleStr = s.roles.includes("*") ? "all employees" : s.roles.join(", ");
    console.log(`  ${s.name.padEnd(30)} ${s.description.slice(0, 50).padEnd(52)} [${roleStr}]`);
  }
}

// -- Sample skill content (written to ~/.employeeos/skills/ on first run) -----

export const SAMPLE_SKILLS: Record<string, string> = {
  "okr-weekly-format.md": `---
name: okr-weekly-format
description: Format weekly updates as OKR progress snapshots
roles: [ceo-assistant, hr-manager]
---

When generating weekly reviews or reports, structure them as OKR progress:

**Objectives & Key Results snapshot:**
For each active goal, provide:
- Objective: [goal title]
- Current KR status: [metric if known, else qualitative]
- Confidence: [high / medium / low]
- Action needed: [one specific thing to move this forward]

Keep it under 200 words total. No padding.
`,

  "competitor-watch.md": `---
name: competitor-watch
description: Flag any competitor signals detected in observations
roles: [marketing-manager, sales-manager]
---

When analyzing signals and observations, actively look for:
- Competitor product launches or pricing changes
- Customer mentions comparing us to alternatives
- Market share shifts

If you spot any, lead with "⚠️ Competitor signal:" and describe what was detected.
Flag it clearly so it gets noticed. Do not bury it in general analysis.
`,

  "anomaly-escalation.md": `---
name: anomaly-escalation
description: Escalate critical anomalies with urgency markers
roles: [*]
---

If an anomaly indicates one of these conditions, prefix your message with 🚨 URGENT:
- Revenue down more than 20% vs prior period
- Support ticket volume spike above 50%
- NPS or CSAT below 3.0
- Key employee departure signal
- Security or compliance issue

For all other anomalies, use ⚠️ WATCH.
Non-anomaly updates need no prefix.
`,

  "standup-format.md": `---
name: standup-format
description: Structure daily analysis as async standup notes
roles: [ceo-assistant]
---

For daily briefs and morning reports, include a standup section at the top:

**Yesterday:** [1-2 sentences on what happened / what was notable]
**Today's focus:** [top 1-2 priorities the brain is watching]
**Blockers:** [anything slowing progress or needing human input — or "None"]

Keep this section tight. The rest of the brief can be detailed.
`,

  "finance-burn-alert.md": `---
name: finance-burn-alert
description: Alert when burn rate or runway looks concerning
roles: [finance-manager, ceo-assistant]
---

Monitor for these financial red lines:
- Runway falls below 6 months → 🚨 CRITICAL: flag immediately with runway estimate
- Burn rate up more than 15% month-over-month → ⚠️ flag with delta
- Gross margin below 50% → ⚠️ flag with current %
- LTV:CAC ratio below 3 → ⚠️ flag

Always state the number when flagging, not just that something looks bad.
`,
};

export function installSampleSkills(skillsDir: string): number {
  if (!fs.existsSync(skillsDir)) {
    fs.mkdirSync(skillsDir, { recursive: true });
  }

  let installed = 0;
  for (const [filename, content] of Object.entries(SAMPLE_SKILLS)) {
    const dest = path.join(skillsDir, filename);
    if (!fs.existsSync(dest)) {
      fs.writeFileSync(dest, content, "utf-8");
      installed++;
    }
  }
  return installed;
}
