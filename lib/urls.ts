/** Absolute http(s) URL without tracking parameters or fragment, or null. */
export function normalizeUrl(href: string | undefined | null, base?: string): string | null {
  if (!href || href.startsWith("#") || /^(javascript|mailto|tel|data):/i.test(href)) return null;
  try {
    const url = new URL(href, base);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$|mc_)/i.test(key)) url.searchParams.delete(key);
    }
    return url.href;
  } catch {
    return null;
  }
}
