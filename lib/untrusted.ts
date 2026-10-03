/**
 * Scraped text can reach Slack without passing through an AI step, so mass mentions and user
 * pings are broken up before they are posted.
 */
export function neutralizeMentions(text: string): string {
  return text
    .replace(/<!(channel|here|everyone)(\|[^>]*)?>/gi, "@​$1")
    .replace(/<@([A-Z0-9]+)(\|[^>]*)?>/g, "@​$1")
    .replace(/@(channel|here|everyone)\b/gi, "@​$1");
}
