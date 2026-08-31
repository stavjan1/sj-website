// Internal repo file — blocked from the public site (functions outrank static assets).
export async function onRequest() {
    return new Response("Not found", { status: 404 });
}
