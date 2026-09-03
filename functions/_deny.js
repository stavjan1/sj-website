// Internal repo file — blocked from the public site (functions outrank static assets).
// Every stub that hides a repo file re-exports this one handler; a re-exported
// onRequest is still a route.
export async function onRequest() {
    return new Response('Not found', { status: 404 });
}
