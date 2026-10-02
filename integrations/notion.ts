import { z } from "zod";
import { defineAction, defineApp } from "./define";
import { getJson, IntegrationError, request } from "./http";

const NOTION_VERSION = "2026-03-11";

// Notion's limit per rich_text content
const MAX_BLOCK_CHARS = 2000;

// Integration tokens only see pages shared with them (usual cause of a 404). PATs see what the user sees.
const NOT_FOUND_HINT =
  "Check the link opens for you in Notion. If you connected an integration token rather than a personal access token, also open the page's ••• menu, choose Connections, and add your integration.";

function headers(token: string) {
  return { authorization: `Bearer ${token}`, "notion-version": NOTION_VERSION };
}

// Page URL, dashed UUID or bare id: last 32 hex chars of the path without dashes.
// Query is dropped first because a `?v=` view id is also 32 hex.
function toNotionId(input: string): string | null {
  const path = input.trim().split(/[?#]/)[0].replace(/\/+$/, "").replace(/-/g, "");
  const match = /[0-9a-f]{32}$/i.exec(path);
  return match ? match[0].toLowerCase() : null;
}

function toParagraphBlocks(text: string) {
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += MAX_BLOCK_CHARS) {
    chunks.push(text.slice(i, i + MAX_BLOCK_CHARS));
  }
  return chunks.map((content) => ({
    object: "block" as const,
    type: "paragraph" as const,
    paragraph: { rich_text: [{ type: "text" as const, text: { content } }] },
  }));
}

interface NotionPage {
  properties?: Record<string, { type?: string; title?: { plain_text?: string }[] }>;
}

/** Checks the token can see the page and returns its title for confirmation. */
export async function checkPage(input: string, token: string): Promise<{ id: string; title: string }> {
  const id = toNotionId(input);
  if (!id) {
    throw new IntegrationError(
      "That doesn't look like a Notion page link",
      undefined,
      "Open the page in Notion, click Share, then Copy link, and paste that here.",
    );
  }

  try {
    const page = await getJson<NotionPage>(`https://api.notion.com/v1/pages/${id}`, {
      headers: headers(token),
      label: "Notion",
    });
    const titleProperty = Object.values(page.properties ?? {}).find(
      (property) => property.type === "title",
    );
    const title = titleProperty?.title?.map((part) => part.plain_text ?? "").join("").trim();
    return { id, title: title || "Untitled" };
  } catch (error) {
    if (error instanceof IntegrationError && error.status === 404) {
      throw new IntegrationError("Notion could not find that page", 404, NOT_FOUND_HINT);
    }
    throw error;
  }
}

const appendToPage = defineAction({
  app: "notion",
  action: "append_to_page",
  description:
    "Append a paragraph to a Notion page. Use this to keep a running log, research journal or digest archive.",
  returns: "{ appended, pageId, characters }",
  params: z.object({
    pageId: z
      .string()
      .min(1)
      .optional()
      .describe(
        "omit to write to the user's own page, chosen on the Connections page; set only when the user names a different page",
      ),
    text: z.string().min(1).describe("text to append; long text is split automatically"),
  }),
  needs: "notion",
  settingDefaults: { pageId: "pageId" },
  sideEffect: true,
  async run({ pageId, text }, secret) {
    if (!secret) {
      throw new IntegrationError(
        "No Notion token is connected",
        undefined,
        "Add a Notion personal access token on the Connections page.",
      );
    }
    if (!pageId) {
      throw new IntegrationError(
        "No Notion page is chosen",
        undefined,
        "Choose the page to write to on the Connections page, under Notion.",
      );
    }

    // Path injection guard: "../pages/x" would hit other endpoints with this token
    const id = toNotionId(pageId);
    if (!id) {
      throw new IntegrationError(
        "That isn't a Notion page link",
        undefined,
        "Choose the page again on the Connections page, under Notion.",
      );
    }

    try {
      await request(`https://api.notion.com/v1/blocks/${id}/children`, {
        method: "PATCH",
        headers: headers(secret),
        body: { children: toParagraphBlocks(text) },
        label: "Notion",
      });
    } catch (error) {
      if (error instanceof IntegrationError && error.status === 404) {
        throw new IntegrationError("Notion could not find that page", 404, NOT_FOUND_HINT);
      }
      throw error;
    }

    return { appended: true, pageId: id, characters: text.length };
  },
});

export const notion = defineApp({
  key: "notion",
  label: "Notion",
  auth: "token",
  authHint:
    "A personal access token can reach every page you can. To limit Agent Desk to one page instead, paste an internal integration token and share only that page with it (page ••• menu → Connections). Both are free.",
  placeholder: "ntn_…",
  setupSteps: [
    {
      text: "Open Notion's personal access tokens page. If it asks, turn on Developer Mode under Settings first.",
      link: { href: "https://www.notion.so/developers/tokens", label: "Open Notion tokens" },
    },
    {
      text: "Click New token, name it Agent Desk, tick only the Notion API capability, and choose an expiry — 90 days is a sensible default.",
    },
    { text: "Copy the token and paste it below. When it expires, paste a new one here." },
  ],
  settings: [
    {
      key: "pageId",
      label: "Page to write to",
      hint: "Every agent that writes to Notion uses this page. In Notion open it, click Share, then Copy link.",
      placeholder: "https://www.notion.so/…",
      check: "notionPage",
    },
  ],
  async verify(secret) {
    try {
      const me = await getJson<{ name?: string; bot?: { workspace_name?: string } }>(
        "https://api.notion.com/v1/users/me",
        { headers: headers(secret), label: "Notion" },
      );
      const workspace = me.bot?.workspace_name;
      return workspace ? `Connected to ${workspace}.` : `Connected as ${me.name ?? "you"}.`;
    } catch (error) {
      if (error instanceof IntegrationError && error.status === 401) {
        throw new IntegrationError(
          "Notion rejected that token",
          401,
          "Copy it again from Notion — it may have been cut short, revoked or expired.",
        );
      }
      throw error;
    }
  },
  actions: [appendToPage],
});
