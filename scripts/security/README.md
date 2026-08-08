# CSP verification

The `Content-Security-Policy` in `/_headers` is enforcing. If it is wrong, real
features break in production silently — a blocked call just fails. These two
scripts prove the policy is correct **before** it ships.

Both read the live policy straight out of `_headers`, serve the real site files
locally with that policy applied as *enforcing*, and drive a real Chromium.

```bash
npm install playwright          # PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 if Chromium is preinstalled
node scripts/security/csp-page-check.js      # loads every page type, reports violations
node scripts/security/csp-runtime-check.js   # drives the actual outbound calls
```

`csp-page-check.js` catches load-time breakage: inline handlers, stylesheets,
fonts, the html2pdf CDN.

`csp-runtime-check.js` catches what page-load misses — the calls that only fire
on user action or after sign-in (contact-form submit, Google Drive sync, the
direct Gemini call on the own-key path). It also asserts that a fetch to an
attacker domain **is** blocked, and that a `blob:` Worker is allowed, since the
PDF exporter needs one.

A network error inside the sandbox is expected and is *not* a CSP failure — the
scripts distinguish the two by listening for `securitypolicyviolation` events
rather than by whether the request succeeded.

**Run these after adding any new third-party call**, then update `connect-src` /
`script-src` in `_headers` accordingly.
