# TJ Mail

A Gmail-style webmail client for the TJHSST mail servers (casey/smith: Dovecot + Postfix), replacing Roundcube. Users sign in with Ion OAuth; the browser only talks to this Next.js app, which talks IMAP/SMTP/ManageSieve on the user's behalf with their Ion token.

## How it works

- **Login.** The app runs Ion OAuth (authorization code with PKCE and a state check; the state lives in an encrypted cookie for 10 minutes). It keeps the Ion access and refresh tokens server-side, AES-256-GCM encrypted in SQLite. The browser cookie (`__Host-wm_sid`, HttpOnly, Secure, SameSite=Lax) holds only a random session ID, and the database stores only that ID's SHA-256. Tokens refresh automatically, and logging out revokes them at Ion.
- **Mail.** IMAP (`imapflow`), SMTP (`nodemailer`) and ManageSieve (`lib/server/sieve.ts`) all log in with `OAUTHBEARER`/`XOAUTH2`. Dovecot and Postfix already accept these, so nothing changes on casey or smith.
- **One long-lived process.** Each signed-in user gets one shared IMAP connection, closed after 5 idle minutes. This matters because every IMAP login makes Dovecot call Ion. A second connection IDLEs on INBOX while a tab is open and pushes new-mail events to the browser over Server-Sent Events (`/api/events`).
- **Gmail features mapped onto IMAP:**
  - Labels are folders. "Move to" moves a message; "Label as" copies it.
  - Archive moves to `Archive`, which is created on demand. All Mail is every folder except Spam and Trash.
  - Starred is `\Flagged` and Important is `$Important`.
  - Snooze moves the message to a `Snoozed` folder; a server-side timer moves it back.
  - Inbox categories (Promotions / Social / Updates / Forums) are assigned from headers only: `List-Unsubscribe`, `Precedence`, ESP markers and sender domain. School senders (tjhsst.edu, fcps.edu) are never Promotions.
  - Gmail search syntax (`from:`, `to:`, `subject:`, `in:`, `is:unread`, `has:attachment`, `larger:`, `older_than:`, `-word` …) is translated to IMAP SEARCH (`lib/server/query.ts`).
- **Sending.**
  - Undo send and scheduled send are a server-side queue (`scheduled` table, payload encrypted), so closing the tab doesn't lose a message.
  - After sending, the app appends a copy to Sent (Bcc kept there, never in the transmitted headers).
  - Drafts autosave every few seconds to the IMAP Drafts folder.
- **Sender addresses.** Postfix enforces `reject_sender_login_mismatch` through `ldap_sender_login.cf` (`mail=%s` → `mail, uid`). The app reads the `mail` values on the user's own FreeIPA entry and only offers those as From addresses. The server re-checks From on every send.
- **Size limits.** Postfix advertises `SIZE 36700160` (35 MiB of encoded message), so attachments are capped at 25 MB total, because base64 adds about 37%. The app also checks the encoded size before sending.
- **Filters, blocked senders, forwarding and the vacation responder** are written as one Sieve script, `webmail`. Its settings are stored as JSON in a header comment. If another script was active before (for example Roundcube's `roundcube`), it stays in effect through `include :personal`.
- **Contacts.** Saved contacts live in SQLite. Recipient autocomplete also searches FreeIPA over LDAP, binding as `webmail-service`, and always uses StartTLS or ldaps. Roundcube contacts can be imported from a vCard or CSV under Settings → Accounts and Import.

## Security model for message content

HTML email is the main risk. There are two independent layers:

1. **Sanitizer** (`lib/server/sanitize.ts`, sanitize-html):
   - Removes scripts, event handlers, forms, iframes, object/embed, meta/base and SVG.
   - Allows only `http`, `https`, `mailto` and `tel` links.
   - Rewrites CSS (`@import`, `expression()`, `behavior`, and remote `url()`).
   - Routes every remote image through `/api/proxy`.
2. **Isolation.** The sanitized body is served from `/api/messages/:id/body` with:
   - `Content-Security-Policy: default-src 'none'; script-src 'none'; img-src 'self' data:; form-action 'none'; sandbox …`
   - Rendered in `<iframe sandbox="allow-same-origin allow-popups …">` without `allow-scripts`.

   Even if the sanitizer missed something, nothing in the message can execute.

**Image proxy** (`/api/proxy`):
- URLs are HMAC-signed, so it is not an open proxy.
- It resolves DNS itself, pins the connection to the checked IP, and refuses private, loopback, link-local and metadata addresses on every redirect hop.
- It accepts only raster image types (no SVG), caps responses at 10 MB, and hides the reader's IP and cookies from senders.

**Attachments** are served as `application/octet-stream` with `Content-Disposition: attachment`, except images, PDF and text when viewed inline. Inline responses carry `nosniff` and a restrictive CSP.

**Every state-changing API call** needs both of these, so cross-site requests are refused:
- a same-origin `Origin` / `Sec-Fetch-Site` header
- the per-session `X-CSRF-Token`

## Development

```bash
npm install
# Fixture mailbox that mirrors the reference screenshots (dev only):
DEMO=1 npm run dev        # then open http://localhost:3000/api/auth/login?demo=1
# Real Ion login (needs the OAuth app's redirect URI to be http://localhost:3000/api/auth/callback):
npm run dev               # reads CLIENT_ID / CLIENT_SECRET from ../.env in development
```

Dev-only switches are ignored when `NODE_ENV=production`:

- `DEMO=1` turns on the fixture mailbox.
- `DEV_LOGIN=1` allows `?dev=testuser` against a local test IMAP server.
- `DEV_TLS_INSECURE=1` accepts self-signed certificates from local test servers.

To run the IMAP/SMTP/Sieve code paths without real accounts, point `IMAP_HOST`, `SMTP_HOST` and `SIEVE_HOST` at local test servers (hoodiecrow-imap, smtp-server, and a ManageSieve stub).

## Configuration

See `.env.example`. Required in production:

- `APP_URL`
- `ION_CLIENT_ID`
- `ION_CLIENT_SECRET`
- `SESSION_SECRET`, at least 32 random characters
- `DATA_DIR`, a persistent volume for the SQLite database and pending uploads

## Deployment (webapps platform)

The `Dockerfile` builds a standalone Next.js server (`node server.js`, port 3000) that runs as an unprivileged user, with `/data` as a volume. The cutover plan:

1. **Fix Dovecot first.** On casey and smith, `/etc/dovecot/conf.d/auth-master.conf.ext` (placed by hand; enabled by commit `191e075f`) checks every login against one static password, with no `master = yes`. It should either become a real master-user passdb (password file, `master = yes`, `user*master` logins) or be removed. This app never uses it.
2. **Register the OAuth app.** In Ion, register (or update) the app with redirect URI `https://webmail-new.tjhsst.edu/api/auth/callback`. Add `https://webmail.tjhsst.edu/api/auth/callback` before cutover.
3. **Point the existing webapps entry at this app.** In `roles/webapps/defaults/main.yml`, change the `webmail` entry (`server_names: ["webmail-new.tjhsst.edu"]`) from `roundcube/roundcubemail` to this image or source. Pass the variables above through an env file, the same way the `notes` entry does, and keep `/data` persistent. Run a single replica: IMAP connections and the send queue live in the process.
4. **Test on `webmail-new.tjhsst.edu`.**
5. **Cut over.** Switch `webmail.tjhsst.edu` on www to include `webapps.conf`, which already passes WebSocket/streaming traffic through. For SSE, nginx must not buffer `/api/events`; the app sends `X-Accel-Buffering: no`. Keep Roundcube at `roundcube.tjhsst.edu` as a fallback; the footer links to it.
