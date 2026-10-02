import { z } from "zod";
import { env } from "@/lib/env";
import { defineAction, defineApp } from "./define";
import { IntegrationError, request } from "./http";

// Without a verified domain, onboarding@resend.dev only delivers to the account's own address (403 otherwise).
const sendEmail = defineAction({
  app: "resend",
  action: "send_email",
  description:
    "Send an email. Use this for digests and briefings that should arrive in an inbox rather than a chat channel.",
  returns: "{ delivered, messageId, to, subject }",
  params: z.object({
    to: z
      .string()
      .email()
      .optional()
      .describe(
        "omit to send to the user's own address, set on the Connections page; set only when the user names a different recipient",
      ),
    subject: z.string().min(1).max(200),
    body: z.string().min(1).describe("plain text body"),
  }),
  needs: "resend",
  settingDefaults: { to: "to" },
  sideEffect: true,
  async run({ to, subject, body }, secret) {
    if (!secret) {
      throw new IntegrationError(
        "No Resend API key is connected",
        undefined,
        "Add your Resend API key on the Connections page.",
      );
    }
    if (!to) {
      throw new IntegrationError(
        "No address to send to",
        undefined,
        "Set where emails go on the Connections page, under Resend.",
      );
    }

    try {
      const response = await request("https://api.resend.com/emails", {
        method: "POST",
        headers: { authorization: `Bearer ${secret}` },
        body: { from: env.resendFrom, to: [to], subject, text: body },
        label: "Resend",
      });

      const result = (await response.json()) as { id?: string };
      return { delivered: true, messageId: result.id ?? null, to, subject };
    } catch (error) {
      // Resend uses 403 for both an unverified sender domain and the test sender's own-address-only rule
      if (error instanceof IntegrationError && error.status === 403 && /domain is not verified/i.test(error.message)) {
        throw new IntegrationError(
          `Resend won't send from ${env.resendFrom}: that domain isn't verified in your Resend account`,
          403,
          "Set RESEND_FROM in .env.local to onboarding@resend.dev, or verify a domain you own at resend.com/domains and use an address on it.",
        );
      }
      if (error instanceof IntegrationError && error.status === 403) {
        throw new IntegrationError(
          `Resend refused to send to ${to}`,
          403,
          "Until a domain is verified in Resend, it only delivers to the email you signed up to Resend with. Change \"Send emails to\" on the Connections page, under Resend, to that address.",
        );
      }
      throw error;
    }
  },
});

export const resend = defineApp({
  key: "resend",
  label: "Resend",
  auth: "token",
  authHint:
    "Used to email digests and drafts. Free plan available. Until a domain is verified in Resend, email can only go to the address you signed up to Resend with.",
  placeholder: "re_…",
  setupSteps: [
    {
      text: "Sign in to Resend, or create a free account, and open API Keys.",
      link: { href: "https://resend.com/api-keys", label: "Open Resend API keys" },
    },
    {
      text: "Click Create API Key, name it Agent Desk, and choose Sending access — the app only ever sends email, so it needs nothing more.",
    },
    { text: "Copy the key and paste it below. Resend shows it only once." },
  ],
  settings: [
    {
      key: "to",
      label: "Send emails to",
      hint: "Every agent that sends email uses this address. Until you verify a domain in Resend, it must be the email you signed up to Resend with.",
      placeholder: "you@example.com",
      check: "email",
      suggestAccountEmail: true,
    },
  ],
  // Lists domains instead of sending. A sending-only key gets a 401 "restricted" error, which still means it's valid.
  async verify(secret) {
    try {
      const response = await request("https://api.resend.com/domains", {
        headers: { authorization: `Bearer ${secret}` },
        label: "Resend",
      });
      const { data = [] } = (await response.json()) as { data?: { status?: string }[] };
      const verified = data.filter((domain) => domain.status === "verified").length;
      return verified > 0
        ? `Connected. ${verified} verified domain${verified === 1 ? "" : "s"} on this account.`
        : "Connected. No verified domain yet, so email can only go to your own Resend address.";
    } catch (error) {
      if (!(error instanceof IntegrationError) || error.status === undefined) throw error;
      if (error.status === 401 && /restricted/i.test(error.message)) {
        return "Connected with a sending-only key.";
      }
      // 429/5xx don't mean the key is bad
      if (error.status === 429 || error.status >= 500) throw error;
      throw new IntegrationError(
        "Resend rejected that key",
        error.status,
        "Copy it again from Resend's API Keys page — it may be cut short or deleted.",
      );
    }
  },
  actions: [sendEmail],
});
