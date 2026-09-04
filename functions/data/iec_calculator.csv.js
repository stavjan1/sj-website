// Internal file deployed with the site. `_redirects` cannot answer 404 on
// Cloudflare Pages (only redirects and 200 rewrites), so a Function is what
// actually keeps it off the public web. See functions/_deny.js.
export { onRequest } from '../_deny.js';
