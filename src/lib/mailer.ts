/**
 * Transactional mail via nodemailer SMTP. If SMTP is not configured the mailer
 * becomes a no-op that logs in development, so the app runs without mail set up.
 */
import nodemailer, { type Transporter } from "nodemailer";
import { env, isDev } from "@/lib/env";
import { createLogger } from "@/lib/logger";

const log = createLogger("mailer");

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!env.SMTP_HOST) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_PORT === 465,
    auth: env.SMTP_USER ? { user: env.SMTP_USER, pass: env.SMTP_PASS } : undefined,
  });
  return transporter;
}

export interface MailInput {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export async function sendMail(input: MailInput): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    if (isDev) log.info("SMTP not configured; would send:", input.subject);
    return false;
  }
  try {
    await t.sendMail({ from: env.MAIL_FROM, ...input });
    return true;
  } catch (err) {
    log.error("send failed:", (err as Error).message);
    return false;
  }
}
