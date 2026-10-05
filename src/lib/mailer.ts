import nodemailer, { type Transporter } from "nodemailer";

/*
 * Outgoing email (0131): the booking's Email tab sends through SMTP.
 *
 * SMTP rather than one provider's API because it is the one thing every mail
 * service speaks: the hotel's own Google Workspace or Microsoft 365 mailbox,
 * or a sending service (SendGrid, Postmark, Resend, Brevo, Amazon SES) --
 * each gives an SMTP host, a user and a password. Server only: SMTP_PASSWORD
 * is never NEXT_PUBLIC_.
 *
 *   SMTP_HOST       smtp.gmail.com, smtp.office365.com, smtp.sendgrid.net ...
 *   SMTP_PORT       587 (STARTTLS) or 465 (TLS); 587 when blank
 *   SMTP_USER       the account's user name
 *   SMTP_PASSWORD   its password or app password / API key
 *   SMTP_FROM       the address mail is sent from, which the account must be
 *                   allowed to send as; SMTP_USER when blank
 *
 * With no host the Email tab says sending is not set up and keeps recording
 * correspondence by hand, as it always has.
 */

let transport: Transporter | null = null;

export function mailConnected(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASSWORD);
}

function fromAddress(): string {
  return (process.env.SMTP_FROM || process.env.SMTP_USER || "").trim();
}

function transporter(): Transporter {
  if (!mailConnected()) throw new Error("Email sending is not set up");
  if (!transport) {
    const port = Number(process.env.SMTP_PORT || 587);
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: port === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD },
    });
  }
  return transport;
}

export interface OutgoingMail {
  to: string[];
  subject: string;
  html: string;
  text: string;
  /** Shown as the sender's name; the address is always SMTP_FROM. */
  fromName: string;
  replyTo: string[];
  attachments: { filename: string; content: Buffer; contentType: string }[];
}

export async function sendMail(mail: OutgoingMail): Promise<void> {
  const name = mail.fromName.replace(/["<>\r\n]/g, "").trim();
  await transporter().sendMail({
    from: name ? { name, address: fromAddress() } : fromAddress(),
    to: mail.to,
    replyTo: mail.replyTo.length > 0 ? mail.replyTo : undefined,
    subject: mail.subject,
    html: mail.html,
    text: mail.text,
    attachments: mail.attachments,
  });
}
