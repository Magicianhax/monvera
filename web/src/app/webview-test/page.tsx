// Diagnostic twin of /brand with NO security headers (excluded in
// next.config.ts): if this loads in the X in-app browser while /brand does
// not, the frame-blocking headers are what crashes the webview. Remove after
// the investigation.
export { default } from "../brand/page";

export const metadata = { robots: { index: false, follow: false } };
export const revalidate = 86400;
