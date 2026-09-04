# CSP verification

The `Content-Security-Policy` in `site/_headers` is enforcing. If it is wrong, real
features break in production silently — a blocked call just fails. These two
scripts prove the policy is correct **before** it ships.

Both read the live policy straight out of `_headers`, serve the real site files
locally with that policy applied as *enforcing*, and drive a real Chromium.

They locate the repo from their own path, so they run from any checkout on any
OS. They used to carry an absolute `/home/user/sj-website`, which meant they
only ever ran on the one machine they were written on — written once, never
run again. They are not in CI: that would put Playwright into a repo that
deliberately has no dependencies. The durable guard against the quote-viewer
XSS is the dependency-free test in `tests/site.test.mjs`, which runs on every
push; these scripts are for proving it again in a real browser when you want
that.

```bash
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm install playwright   # drop the flag if Chromium isn't preinstalled
node scripts/security/csp-page-check.js      # loads every page type, reports violations
node scripts/security/csp-runtime-check.js   # drives the actual outbound calls
```

The scripts resolve `playwright` from the repo root, and point Chromium at
`/opt/pw-browsers/chromium-1194/...`. On a machine where Chromium sits elsewhere,
edit `executablePath` (or delete it to use Playwright's own download). If
`playwright` is installed somewhere else, run with
`NODE_PATH=/path/to/node_modules node scripts/security/...`.

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

## Stored-XSS regression (public quote viewer)

```bash
node scripts/security/xss-quote-viewer-e2e.js
```

Serves the real `q/index.html`, mocks `/api/quote-share` with an attacker's
stored payload (a valid GIF data-URL followed by an `onload=` attribute
breakout) and checks in a real browser whether the injected code ran. Three
cases, all must pass:

1. **Control** — the original vulnerable code reconstructed. The exploit *must*
   fire, otherwise the test proves nothing. It sets `document.title` to `PWNED`.
2. **Shipped** — the code as it ships. The exploit must not fire.
3. **Regression** — a legitimate base64 logo and signature must still render,
   so the hardening didn't break real quotes.

Keep the control case working. When the first version of this test was written
it only swapped the loose regex back in and left the new `esc()` wrapper at the
sink, so the "vulnerable" build passed too — a green run that proved nothing.
A control that cannot reproduce the bug is not a test.
