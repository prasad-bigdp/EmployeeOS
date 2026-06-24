import nodemailer from "nodemailer";

export interface EmailConfig {
  to: string;
  smtp: string;
  user: string;
  pass: string;
  from?: string;
}

function parseSmtp(smtp: string): { host: string; port: number } {
  const [host, portStr] = smtp.split(":");
  return { host: host ?? smtp, port: parseInt(portStr ?? "587") };
}

function buildHtml(subject: string, body: string): string {
  const lines = body.split("\n").map(l => `<p style="margin:4px 0;font-family:monospace;font-size:14px;color:#d4d4d4">${l || "&nbsp;"}</p>`).join("");
  return `<!DOCTYPE html><html><body style="background:#1e1e1e;padding:24px">
<div style="max-width:600px;margin:0 auto;background:#252526;border-radius:8px;padding:24px">
<div style="font-family:sans-serif;font-size:12px;color:#569cd6;text-transform:uppercase;letter-spacing:2px;margin-bottom:16px">EmployeeOS · Company Brain</div>
<h2 style="font-family:sans-serif;color:#ffffff;margin:0 0 16px">${subject}</h2>
<div style="border-top:1px solid #3c3c3c;padding-top:16px">${lines}</div>
<div style="margin-top:24px;padding-top:16px;border-top:1px solid #3c3c3c;font-family:sans-serif;font-size:11px;color:#555">
Sent by your EmployeeOS Company Brain · <a href="https://github.com/your-org/employeeos" style="color:#569cd6">GitHub</a>
</div></div></body></html>`;
}

export function createEmailNotifier(config: EmailConfig): (msg: string) => void {
  const { host, port } = parseSmtp(config.smtp);
  const secure = port === 465;

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: config.user, pass: config.pass },
  });

  const from = config.from ?? `EmployeeOS <${config.user}>`;

  return (msg: string) => {
    const lines = msg.split("\n");
    const subject = lines[0]?.slice(0, 100) ?? "EmployeeOS Notification";
    const body = msg;

    transport.sendMail({
      from,
      to: config.to,
      subject,
      text: body,
      html: buildHtml(subject, body),
    }).catch(() => {});
  };
}

export async function testEmailConnection(config: EmailConfig): Promise<void> {
  const { host, port } = parseSmtp(config.smtp);
  const secure = port === 465;

  const transport = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user: config.user, pass: config.pass },
  });

  await transport.verify();
}

export async function sendTestEmail(config: EmailConfig): Promise<void> {
  const notify = createEmailNotifier(config);
  notify("EmployeeOS connected\n\nYour Company Brain email notifications are working.\n\nYou'll receive:\n- Morning briefs every day\n- Anomaly alerts\n- Plan approval requests\n- Weekly executive reviews");
}
