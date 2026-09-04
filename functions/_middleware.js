/**
 * One host, one origin.
 *
 * Both sj-eng.co.il and www.sj-eng.co.il answered 200 for the whole site, but
 * only https://www.sj-eng.co.il is registered as an authorized JavaScript
 * origin on the Google OAuth client. So anyone who reached /sale/ on the naked
 * domain and pressed "כניסה עם חשבון Google" got Google's redirect_uri_mismatch
 * page instead of a login — the app could not be signed up for at all from that
 * door (Stav, 25/08: "המערכת לא נפתחת כשלוחצים על התחל עכשיו חינם מהטלפון").
 *
 * Every <link rel=canonical> and og:url in the repo already says www, and the
 * sitemap lists www only, so the naked domain was a duplicate of the site as
 * well as a broken door. It now redirects, permanently.
 *
 * Deliberately narrow:
 *   - only the exact naked apex — *.pages.dev previews and localhost are left alone;
 *   - only GET/HEAD — a 301 turns a POST into a GET, and /api/telegram is a
 *     webhook Telegram POSTs to at whatever origin it was registered with;
 *   - never /api/* — same reason, for every integration that holds a URL.
 *
 * Also the one place that can put security headers on Function responses:
 * `_headers` applies to static files only, so an /api/* reply used to leave
 * with no nosniff at all. Every API response now carries the two headers
 * that matter for bytes a browser might be tricked into rendering.
 */
const API_HEADERS = { 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
export async function onRequest(context) {
    const { request, next } = context;
    const url = new URL(request.url);

    const isApex = url.hostname === 'sj-eng.co.il';
    const isRead = request.method === 'GET' || request.method === 'HEAD';
    const isApi = url.pathname.startsWith('/api/');

    if (isApex && isRead && !isApi) {
        url.protocol = 'https:';
        url.hostname = 'www.sj-eng.co.il';
        return new Response(null, {
            status: 301,
            headers: { Location: url.toString(), 'Cache-Control': 'max-age=3600' },
        });
    }

    if (!isApi) return next();
    const res = await next();
    const headers = new Headers(res.headers);
    for (const [k, v] of Object.entries(API_HEADERS)) if (!headers.has(k)) headers.set(k, v);
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
