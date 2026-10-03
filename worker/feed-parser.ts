export type FeedEntry = { title: string; description: string; url: string };

function decodeEntities(value: string): string {
  const codePoint = (digits: string, radix: number) => {
    const point = Number.parseInt(digits, radix);
    return point > 0 && point <= 0x10ffff && !(point >= 0xd800 && point <= 0xdfff)
      ? String.fromCodePoint(point)
      : "\uFFFD";
  };
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => codePoint(hex, 16))
    .replace(/&#(\d+);/g, (_, decimal) => codePoint(decimal, 10));
}

function stripMarkup(value: string): string {
  return decodeEntities(value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

// Links come from external feeds and eventually reach an <a href>.
export function sanitizeExternalUrl(value: string): string {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.toString() : "";
  } catch {
    return "";
  }
}

function tagText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return match ? stripMarkup(match[1]) : "";
}

function attribute(tag: string, name: string): string {
  const match = tag.match(new RegExp(`\\s${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  return match ? decodeEntities(match[2]) : "";
}

function articleUrl(block: string): string {
  const atomLinks = [...block.matchAll(/<link\b[^>]*>/gi)]
    .map(([tag]) => ({ href: attribute(tag, "href"), rel: attribute(tag, "rel").toLowerCase() }))
    .filter((link) => link.href);
  const candidates = [
    // Atom defaults an omitted rel to "alternate".
    ...atomLinks.filter((link) => !link.rel || link.rel === "alternate"),
    ...atomLinks.filter((link) => link.rel && link.rel !== "alternate"),
  ];
  for (const { href } of candidates) {
    const url = sanitizeExternalUrl(href);
    if (url) return url;
  }
  const rssLink = sanitizeExternalUrl(tagText(block, "link"));
  if (rssLink) return rssLink;
  const guidTag = block.match(/<guid\b[^>]*>/i)?.[0];
  return guidTag && attribute(guidTag, "isPermaLink").toLowerCase() === "true"
    ? sanitizeExternalUrl(tagText(block, "guid"))
    : "";
}

/** Extract the fields used by news panels from RSS items or Atom entries. */
export function parseFeedEntries(xml: string, limit: number): FeedEntry[] {
  const blocks =
    xml.match(/<item\b[\s\S]*?<\/item>/gi) ?? xml.match(/<entry\b[\s\S]*?<\/entry>/gi) ?? [];
  return blocks.slice(0, limit).map((block) => ({
    title: tagText(block, "title"),
    description: ["description", "summary", "content:encoded"]
      .map((tag) => tagText(block, tag))
      .join(" "),
    url: articleUrl(block),
  }));
}

const keywordPatterns = new Map<string, RegExp>();

export function keywordMatches(haystack: string, keyword: string): boolean {
  if (keyword.includes(" ")) return haystack.includes(keyword);
  let pattern = keywordPatterns.get(keyword);
  if (!pattern) {
    // Short symbols and words such as "sec" or "ban" must not match inside
    // unrelated words such as "second" or "urban".
    pattern = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
    keywordPatterns.set(keyword, pattern);
  }
  return pattern.test(haystack);
}
