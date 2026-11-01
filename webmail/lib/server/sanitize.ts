import "server-only";
import sanitizeHtml from "sanitize-html";
import { sign } from "./crypto";

export function proxyUrl(url: string): string {
  const u = Buffer.from(url).toString("base64url");
  return `/api/proxy?u=${u}&s=${sign("img:" + url)}`;
}

const SAFE_URL = /^(https?:|mailto:|tel:)/i;

type Ctx = {
  cidMap: Map<string, string>;
  allowRemote: boolean;
  blocked: { count: number };
};

function rewriteCss(css: string, ctx: Ctx): string {
  return css
    .replace(/expression\s*\(/gi, "x(")
    .replace(/-moz-binding|behavior\s*:/gi, "x:")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\(\s*(['"]?)(.*?)\1\s*\)/gi, (_m, _q, raw: string) => {
      const url = raw.trim();
      if (/^data:image\/(png|gif|jpe?g|webp);/i.test(url)) return `url("${url.replace(/"/g, "")}")`;
      if (/^cid:/i.test(url)) {
        const local = ctx.cidMap.get(url.slice(4).replace(/^<|>$/g, ""));
        return local ? `url("${local}")` : "none";
      }
      if (/^https?:\/\//i.test(url)) {
        if (!ctx.allowRemote) {
          ctx.blocked.count++;
          return "none";
        }
        return `url("${proxyUrl(url)}")`;
      }
      return "none";
    });
}

export function sanitizeEmailHtml(html: string, opts: { cidMap: Map<string, string>; allowRemote: boolean }): { html: string; blockedImages: number } {
  const ctx: Ctx = { ...opts, blocked: { count: 0 } };
  const out = sanitizeHtml(html, {
    allowedTags: [
      "a", "abbr", "address", "b", "big", "blockquote", "br", "caption", "center", "cite", "code", "col", "colgroup",
      "dd", "del", "dfn", "div", "dl", "dt", "em", "font", "h1", "h2", "h3", "h4", "h5", "h6", "hr", "i", "img", "ins",
      "kbd", "li", "mark", "ol", "p", "pre", "q", "s", "samp", "small", "span", "strike", "strong", "style", "sub", "sup",
      "table", "tbody", "td", "tfoot", "th", "thead", "tr", "tt", "u", "ul", "var", "wbr", "section", "article", "header",
      "footer", "main", "nav", "figure", "figcaption", "picture", "time", "label", "summary", "details",
    ],
    allowVulnerableTags: true,
    disallowedTagsMode: "discard",
    nonTextTags: ["script", "textarea", "option", "noscript", "title", "head", "template", "svg", "math", "object", "embed", "iframe", "frame", "frameset", "applet", "form", "button", "select", "input", "link", "meta", "base"],
    allowedAttributes: {
      "*": ["style", "class", "align", "valign", "width", "height", "bgcolor", "dir", "lang", "title", "border", "color", "face", "size", "background", "role", "aria-label", "aria-hidden"],
      a: ["href", "name", "target", "rel"],
      img: ["src", "alt", "width", "height", "border", "hspace", "vspace"],
      table: ["cellpadding", "cellspacing", "border", "summary", "frame", "rules"],
      td: ["colspan", "rowspan", "nowrap", "abbr", "scope"],
      th: ["colspan", "rowspan", "nowrap", "abbr", "scope"],
      col: ["span"],
      colgroup: ["span"],
      ol: ["start", "type", "reversed"],
      li: ["value", "type"],
      blockquote: ["cite", "type"],
      time: ["datetime"],
    },
    allowedSchemes: ["http", "https", "mailto", "tel", "data", "cid"],
    allowedSchemesByTag: { img: ["http", "https", "data", "cid"], a: ["http", "https", "mailto", "tel"] },
    allowProtocolRelative: false,
    allowedStyles: undefined,
    transformTags: {
      a: (tagName, attribs) => {
        const href = (attribs.href || "").trim();
        const a: Record<string, string> = { ...attribs, target: "_blank", rel: "noopener noreferrer nofollow" };
        if (!SAFE_URL.test(href)) delete a.href;
        return { tagName, attribs: a };
      },
      img: (tagName, attribs) => {
        const src = (attribs.src || "").trim();
        const a: Record<string, string> = { ...attribs };
        if (/^cid:/i.test(src)) {
          const local = ctx.cidMap.get(src.slice(4).replace(/^<|>$/g, ""));
          if (local) a.src = local;
          else delete a.src;
        } else if (/^https?:\/\//i.test(src)) {
          if (ctx.allowRemote) a.src = proxyUrl(src);
          else {
            ctx.blocked.count++;
            delete a.src;
            a["data-blocked"] = "1";
          }
        } else if (!/^data:image\/(png|gif|jpe?g|webp|bmp);base64,/i.test(src)) delete a.src;
        if (a.style) a.style = rewriteCss(a.style, ctx);
        return { tagName, attribs: a };
      },
      "*": (tagName, attribs) => {
        const a: Record<string, string> = { ...attribs };
        if (a.style) a.style = rewriteCss(a.style, ctx);
        if (a.background) {
          const bg = a.background.trim();
          if (/^https?:\/\//i.test(bg) && ctx.allowRemote) a.background = proxyUrl(bg);
          else delete a.background;
        }
        return { tagName, attribs: a };
      },
    },
    textFilter: undefined,
    exclusiveFilter: (frame) => frame.tag === "style" && /<\/?\s*script/i.test(frame.text),
    parseStyleAttributes: false,
  });
  const final = out.replace(/(<style[^>]*>)([\s\S]*?)(<\/style>)/gi, (_m, a: string, css: string, b: string) => a + rewriteCss(css, ctx).replace(/<\/?[a-z]/gi, "") + b);
  return { html: final, blockedImages: ctx.blocked.count };
}

function escapeHtml(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function textToHtml(text: string): string {
  const esc = escapeHtml(text);
  const linked = esc
    .replace(/\bhttps?:\/\/[^\s<>"]+[^\s<>".,;:!?)\]]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer nofollow">${u}</a>`)
    .replace(/(^|[\s(])(\+?1[.\-\s])?(\(?\d{3}\)?[.\-\s]\d{3}[.\-\s]\d{4})(?=$|[\s),.;])/gm, (_m, pre: string, cc: string | undefined, num: string) => `${pre}<a href="tel:${(cc ?? "").replace(/\D/g, "")}${num.replace(/\D/g, "")}">${cc ?? ""}${num}</a>`);
  return `<div style="white-space:pre-wrap;word-wrap:break-word;font:16px/24px Arial,Helvetica,sans-serif;color:#1f1f1f">${linked}</div>`;
}

export const BODY_CSP = [
  "default-src 'none'",
  "img-src 'self' data:",
  "style-src 'unsafe-inline'",
  "font-src data:",
  "media-src 'none'",
  "script-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'self'",
  "sandbox allow-popups allow-popups-to-escape-sandbox allow-same-origin",
].join("; ");

export function wrapBody(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer"><base target="_blank"><style>
html,body{margin:0;padding:0;background:#fff}
body{font-family:Arial,Helvetica,sans-serif;font-size:small;color:#222;word-wrap:break-word;overflow-wrap:anywhere;overflow:hidden}
img{max-width:100%;height:auto}
a{color:#1155cc}
img[data-blocked]{display:none}
pre{white-space:pre-wrap}
blockquote{margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex}
</style></head><body>${inner}</body></html>`;
}
