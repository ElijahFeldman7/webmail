import { route } from "@/lib/server/api";
import { backendFor } from "@/lib/server/backend";
import { config } from "@/lib/server/config";
import { getPrefs } from "@/lib/server/db";
import type { Me } from "@/lib/types";

export const GET = route(async (_req, s) => {
  const b = await backendFor(s);
  const identities = await b.identities();
  const quota = await b.quota().catch(() => null);
  const prefs = getPrefs(s.username);
  const p = s.profile;
  const me: Me = {
    username: s.username,
    displayName: prefs.displayName || p.display_name || p.full_name || s.username,
    firstName: p.first_name || p.display_name?.split(" ")[0] || s.username,
    email: identities[0]?.address ?? "",
    picture: p.id ? `/api/me/picture` : null,
    identities,
    csrf: s.csrf,
    quota,
    demo: config.demo && s.username === "demo",
  };
  return { me, prefs };
});
