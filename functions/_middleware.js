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
 */
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

    return next();
}
