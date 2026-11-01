import "server-only";
import type { Category } from "../types";

export const LIST_HEADERS = ["list-unsubscribe", "list-id", "precedence", "x-campaign", "x-mailgun-tag", "feedback-id", "x-sg-eid", "x-mc-user", "auto-submitted", "x-auto-response-suppress"];

const SOCIAL = /(^|\.)(facebook(mail)?\.com|instagram\.com|linkedin\.com|twitter\.com|x\.com|reddit(mail)?\.com|discord\.com|tiktok\.com|snapchat\.com|youtube\.com|threads\.net|bsky\.app|mastodon\.social|nextdoor\.com|strava\.com|goodreads\.com|meetup\.com|messenger\.com|whatsapp\.com)$/i;
const TRANSACTIONAL = /\b(receipt|order|invoice|statement|payment|security|alert|password|verif|confirm|code|sign[- ]?in|sign[- ]?up|signup|log[- ]?in|account|shipped|deliver|reservation|booking|ticket|summary|digest|update|reminder|notification|invitation|report|bill|schedule|assignment|grade|registration|period|absence)\w*/i;
const SCHOOL = /(^|\.)(tjhsst\.edu|fcps\.edu)$/i;
const PROMO = /\b(sale|% off|\d+% |deal|discount|offer|free|save|limited|shop|new arrivals|coupon|promo|exclusive|last chance|bogo|win|gift)\b/i;

export function classify(fromAddress: string, subject: string, headers: string): Category {
  const domain = (fromAddress.split("@")[1] || "").toLowerCase();
  const h = headers.toLowerCase();
  if (SOCIAL.test(domain)) return "social";
  const hasUnsub = h.includes("list-unsubscribe:");
  const hasListId = h.includes("list-id:");
  const bulk = /precedence:\s*(bulk|junk)/.test(h) || /x-campaign|x-mailgun-tag|x-sg-eid|x-mc-user|feedback-id/.test(h);
  if (hasListId && !hasUnsub && /precedence:\s*list/.test(h)) return "forums";
  if (SCHOOL.test(domain)) return hasUnsub || bulk || hasListId ? "updates" : "primary";
  if (hasUnsub || bulk) {
    if (PROMO.test(subject)) return "promotions";
    if (TRANSACTIONAL.test(subject) || /auto-submitted:\s*auto-generated/.test(h)) return "updates";
    return bulk ? "promotions" : "updates";
  }
  return "primary";
}
