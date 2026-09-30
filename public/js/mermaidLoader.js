// Mermaid draws the briefing's diagram. It comes from a CDN, and it is loaded
// here, after the page has rendered, rather than with a <script> tag in the
// page's <head>: a script there blocks the whole page, so on a network where
// the CDN is blocked or stalls (a company proxy, say) the browser shows a
// blank white page until the request gives up. Loaded this way, the worst
// case is one diagram shown as its source text.
const MERMAID_URL =
  "https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js";
const TIMEOUT_MS = 8000;

let loading = null;

/** Resolves with the global `mermaid`, or rejects if it cannot be loaded in time. */
export function loadMermaid(url = MERMAID_URL, timeoutMs = TIMEOUT_MS) {
  if (window.mermaid) return Promise.resolve(window.mermaid);
  loading ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    const fail = (reason) => {
      clearTimeout(timer);
      script.remove();
      // Forget the failure so a later diagram can try again.
      loading = null;
      reject(new Error(reason));
    };
    const timer = setTimeout(
      () => fail("Timed out loading Mermaid"),
      timeoutMs,
    );
    script.src = url;
    script.async = true;
    script.addEventListener("load", () => {
      clearTimeout(timer);
      if (window.mermaid) resolve(window.mermaid);
      else fail("Mermaid loaded but did not define itself");
    });
    script.addEventListener("error", () => fail("Could not load Mermaid"));
    document.head.append(script);
  });
  return loading;
}
