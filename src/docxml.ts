const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (whole, ent: string) => {
    if (ent.startsWith("#x") || ent.startsWith("#X")) return String.fromCodePoint(parseInt(ent.slice(2), 16));
    if (ent.startsWith("#")) return String.fromCodePoint(parseInt(ent.slice(1), 10));
    return NAMED[ent.toLowerCase()] ?? whole;
  });
}

function attr(attrs: string, name: string): string | undefined {
  return attrs.match(new RegExp(`${name}\\s*=\\s*"([^"]*)"`, "i"))?.[1];
}

/** 문단 안의 HTML(표, 줄바꿈, 위첨자 등)을 평문으로 바꾼다. */
function clean(fragment: string): string {
  let s = fragment.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1");
  s = decodeEntities(s);
  s = s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(tr|p|li)>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, "");
  s = decodeEntities(s);
  return s
    .split("\n")
    .map((line) => line.replace(/[ \t ]+/g, " ").replace(/\s*\|\s*$/, "").trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * 식약처 의약품 허가 문서(EE_DOC_DATA 등)를 평문으로 바꾼다.
 * 구조: <DOC><SECTION><ARTICLE title="..."><PARAGRAPH>...</PARAGRAPH></ARTICLE></SECTION></DOC>
 */
export function docToText(raw: unknown): string {
  if (typeof raw !== "string") return "";
  let s = raw.trim();
  if (!s) return "";
  if (/^https?:\/\//i.test(s)) return `(원문 문서 링크) ${s}`;
  if (!s.includes("<") && s.includes("&lt;")) s = decodeEntities(s);
  if (!/<(DOC|SECTION|ARTICLE|PARAGRAPH)\b/i.test(s)) return clean(s);

  const lines: string[] = [];
  const re = /<ARTICLE\b([^>]*?)\/?>|<PARAGRAPH\b[^>]*>([\s\S]*?)<\/PARAGRAPH>/gi;
  for (const m of s.matchAll(re)) {
    if (m[1] !== undefined) {
      const title = attr(m[1], "title");
      if (title && clean(title)) lines.push(clean(title));
    } else if (m[2] !== undefined) {
      const text = clean(m[2]);
      if (text) lines.push(text);
    }
  }
  return lines.length ? lines.join("\n") : clean(s);
}
