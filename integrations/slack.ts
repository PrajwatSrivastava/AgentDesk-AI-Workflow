import { z } from "zod";
import { defineAction, defineApp } from "./define";
import { IntegrationError, request } from "./http";

// Pre-fills "create app from manifest". The incoming-webhook scope makes Slack ask for a channel on install.
const MANIFEST = {
  display_information: {
    name: "Agent Desk",
    description: "Posts results from your Agent Desk workflows.",
  },
  features: { bot_user: { display_name: "agent-desk", always_online: false } },
  oauth_config: { scopes: { bot: ["incoming-webhook"] } },
  settings: { incoming_webhooks: { incoming_webhooks_enabled: true } },
};

const CREATE_APP_URL = `https://api.slack.com/apps?new_app=1&manifest_json=${encodeURIComponent(
  JSON.stringify(MANIFEST),
)}`;

function assertWebhookUrl(secret: string): void {
  if (!secret.startsWith("https://hooks.slack.com/")) {
    throw new IntegrationError(
      "That does not look like a Slack webhook URL",
      undefined,
      "It should start with https://hooks.slack.com/services/",
    );
  }
}

async function send(webhook: string, text: string): Promise<void> {
  await request(webhook, {
    method: "POST",
    body: { text },
    label: "Slack",
    hint: "Slack rejected the message. The webhook may have been revoked; recreate it in Connections.",
  });
}

// The webhook URL is the credential, stored encrypted like other secrets.
const postMessage = defineAction({
  app: "slack",
  action: "post_message",
  description:
    "Post a message to the Slack channel this workspace's webhook points at. Use this to deliver summaries, alerts and digests.",
  returns: "{ delivered, characters }",
  params: z.object({
    text: z.string().min(1).describe("message body; Slack mrkdwn is supported"),
  }),
  needs: "slack",
  sideEffect: true,
  async run({ text }, secret) {
    if (!secret) {
      throw new IntegrationError(
        "No Slack webhook is connected",
        undefined,
        "Add a Slack incoming webhook URL in Connections.",
      );
    }
    assertWebhookUrl(secret);
    await send(secret, text);
    return { delivered: true, characters: text.length };
  },
});

export const slack = defineApp({
  key: "slack",
  label: "Slack",
  auth: "token",
  authHint:
    "Paste an incoming webhook URL (https://hooks.slack.com/services/...). Free on every Slack plan.",
  placeholder: "https://hooks.slack.com/services/…",
  setupSteps: [
    {
      text: "Create the Agent Desk app in Slack. It opens pre-filled: pick your workspace, then Next and Create.",
      link: { href: CREATE_APP_URL, label: "Create the Slack app" },
    },
    { text: "In the app's sidebar open Incoming Webhooks, click Add New Webhook, and choose the channel to post in." },
    { text: "Copy the webhook URL Slack shows and paste it below. A test message is posted to confirm it works." },
  ],
  // Webhooks can only be tested by posting
  async verify(secret) {
    assertWebhookUrl(secret);
    await send(secret, "Agent Desk is connected. Workflows that post to Slack will send their messages to this channel.");
    return "Posted a test message to your channel.";
  },
  actions: [postMessage],
});
