# Deploying AIME

AIME takes mail on a subdomain, `agents.luminousworksllc.com`, so the Google MX records on the main
domain are never touched and owner@ keeps working.

## 1. Cloudflare, once (clicks)
1. Email Routing > Onboard Domain > `agents.luminousworksllc.com`. Accept the MX/TXT records it proposes
   (they are on the subdomain only).
2. Routing rules > Catch-all > Send to a Worker > `aime`. (Do this after step 2 below has deployed the Worker.)

## 2. Worker, from this repo
```
npm install
npx wrangler login                      # or set CLOUDFLARE_API_TOKEN (Workers + D1 edit)
npx wrangler d1 create aime             # copy the database_id into wrangler.jsonc
npx wrangler d1 execute aime --remote --file=schema.sql
npx wrangler secret put AIME_ADMIN_TOKEN   # dashboard password (any long random string)
npx wrangler secret put EMAIL_SECRET       # any long random string; signs reply routing
npx wrangler deploy
```

## 3. Check
- `https://aime.<account>.workers.dev/health` returns `ok`.
- `/` asks for a sign-in (user anything, password = AIME_ADMIN_TOKEN).
- Send mail from an allowed address to `aime@agents.luminousworksllc.com`; the Worker replies and the dashboard
  lists it. Anything from an address not in `AIME_ALLOWED` (or the dashboard allowlist) is dropped and logged.

`AIME_ALLOWED` is a comma-separated list; it is set to owner@luminousworksllc.com. Add agents' addresses in the dashboard.
