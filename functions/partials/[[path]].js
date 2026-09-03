// The header/footer partials are build inputs, not pages; _redirects cannot 404 on Pages, this can.
export { onRequest } from '../_deny.js';
