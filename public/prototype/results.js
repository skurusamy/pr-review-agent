// PROTOTYPE -- throwaway. Question (ticket #20): what should a Review Run's
// results look like, one card per review comment? Three structurally
// different variants of the same fake run, switchable via ?variant=A|B|C on
// the existing page. Nothing here talks to the server.
const NAMES = { A: "Thread cards", B: "Master / detail", C: "Triage by outcome" };
const KEYS = Object.keys(NAMES);

const RUN = {
  pr: "acme/widgets#42",
  dryRun: true,
  threads: [
    {
      id: 1, path: "src/auth.ts", line: 42, reviewer: "maria",
      comment: "This doesn't handle a null token when the session expires.",
      verdict: "bug",
      reasoning: "Confirmed: getSession() returns null after expiry and line 42 dereferences token.value without a check.",
      outcome: "fix", attempts: 1, gate: ["typecheck", "lint", "test"],
      diff: ["@@ -40,4 +40,5 @@", " const s = getSession();", "-const t = s.token.value;", "+if (!s?.token) return redirectToLogin();", "+const t = s.token.value;"],
      log: ["tool  Read src/auth.ts", "think Session can be null after expiry", "tool  Edit src/auth.ts", "ok    Validation Gate passed (typecheck, lint, test)"],
    },
    {
      id: 2, path: "src/api.ts", line: 10, reviewer: "tom",
      comment: "Should this be async?",
      verdict: "not-a-bug",
      reasoning: "It only reads an in-memory cache populated at startup; nothing awaits inside.",
      outcome: "draft",
      draft: "Thanks for checking! This only reads the cache that's filled at startup (see initCache), so it has nothing to await. Happy to add a comment saying so.",
      log: ["tool  Grep initCache", "tool  Read src/api.ts", "think Cache is sync, no I/O in this path"],
    },
    {
      id: 3, path: "src/cache.ts", line: 88, reviewer: "maria",
      comment: "Race condition if two refreshes overlap.",
      verdict: "bug",
      reasoning: "Real, but the fix needs a lock the codebase doesn't have yet.",
      outcome: "fix-failed", attempts: 3, failedGate: "test",
      draft: "Agreed this can race. I tried three fixes but the test suite kept failing on cache.refresh.test.ts; needs a human decision on the locking approach.",
      log: ["tool  Read src/cache.ts", "warn  Attempt 1 failed at test", "warn  Attempt 2 failed at test", "warn  Attempt 3 failed at test", "warn  Working tree reset"],
    },
    {
      id: 4, path: "src/util.ts", line: null, reviewer: "tom", outdated: true,
      comment: "Rename this helper.",
      verdict: "not-a-bug",
      reasoning: "The commit this comment was left on has since changed; outdated comments always become Draft Replies.",
      outcome: "draft",
      draft: "This code has changed since the comment; is the rename still wanted?",
      log: ["info  Comment is outdated"],
    },
    {
      id: 5, path: "src/db.ts", line: 120, reviewer: "sam",
      comment: "Missing index on user_id?",
      verdict: null,
      reasoning: null,
      outcome: "skipped",
      log: ["info  Agent Marker found: already replied, skipping"],
    },
  ],
};

const OUTCOME = {
  fix: { label: dry => (dry ? "Fix ready (would push)" : "Fix pushed"), tone: "success" },
  draft: { label: () => "Draft reply", tone: "info" },
  "fix-failed": { label: () => "Fix failed, draft reply", tone: "warn" },
  skipped: { label: () => "Skipped (already replied)", tone: "muted" },
};

function h(tag, attrs, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs ?? {})) {
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v);
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid.nodeType ? kid : document.createTextNode(kid));
  }
  return el;
}

const loc = t => `${t.path}${t.line ? ":" + t.line : ""}`;
const badge = (text, tone) => h("span", { class: `pr-badge pr-${tone}` }, text);
const verdictBadge = t =>
  t.verdict === "bug" ? badge("BUG", "danger") : t.verdict ? badge("NOT A BUG", "success") : badge("NO VERDICT", "muted");
const outcomeBadge = t => badge(OUTCOME[t.outcome].label(RUN.dryRun), OUTCOME[t.outcome].tone);
const diffView = lines =>
  h("pre", { class: "pr-diff" }, lines.map(l =>
    h("div", { class: l.startsWith("+") ? "add" : l.startsWith("-") ? "del" : "" }, l)));
const logView = lines =>
  h("div", { class: "pr-log" }, lines.map(l => h("div", { class: `log-line log-${{ tool: "tool", think: "thinking", ok: "success", warn: "warn", info: "info" }[l.split(" ")[0]]}` }, l)));
const reasoning = t => h("details", { class: "pr-reasoning" }, h("summary", {}, "Show reasoning"), logView(t.log));

function detailBody(t) {
  return [
    h("blockquote", { class: "pr-quote" }, h("b", {}, `@${t.reviewer}: `), t.comment),
    t.reasoning && h("p", {}, h("b", {}, "Agent: "), t.reasoning),
    t.diff && [h("p", { class: "pr-sub" }, `Validation Gate passed (${t.gate.join(", ")}) after ${t.attempts} attempt`), diffView(t.diff)],
    t.outcome === "fix-failed" && h("p", { class: "pr-sub" }, `${t.attempts} attempts, last failed at ${t.failedGate}. Working tree reset.`),
    t.draft && [h("p", { class: "pr-sub" }, "Draft reply (pending, not submitted):"), h("div", { class: "pr-draft" }, t.draft)],
    reasoning(t),
  ];
}

const counts = () => {
  const c = { fix: 0, draft: 0, "fix-failed": 0, skipped: 0 };
  RUN.threads.forEach(t => c[t.outcome]++);
  return c;
};
const banner = () =>
  h("div", { class: "pr-banner" }, RUN.dryRun ? "Dry run: nothing was pushed or posted." : "Live run.", ` ${RUN.pr}`);

// ---- Variant A: one card per thread, in file order ----
function VariantA() {
  return h("div", {}, banner(), h("div", { class: "pr-summary" },
    `${RUN.threads.length} threads: `, `${counts().fix} fixed, ${counts().draft + counts()["fix-failed"]} draft replies, ${counts().skipped} skipped`),
    RUN.threads.map(t => h("section", { class: "pr-card" },
      h("header", {}, h("code", {}, loc(t)), t.outdated && badge("outdated", "muted"), verdictBadge(t), outcomeBadge(t)),
      detailBody(t))));
}

// ---- Variant B: compact list on the left, one thread's detail on the right ----
function VariantB() {
  let sel = 0;
  const root = h("div", {});
  const draw = () => {
    root.replaceChildren(banner(), h("div", { class: "pr-split" },
      h("nav", { class: "pr-list" }, RUN.threads.map((t, i) =>
        h("button", { class: `pr-row${i === sel ? " sel" : ""}`, onclick: () => { sel = i; draw(); } },
          h("span", { class: `pr-dot pr-${OUTCOME[t.outcome].tone}` }), h("code", {}, loc(t))))),
      h("article", { class: "pr-detail" },
        h("header", {}, h("code", {}, loc(RUN.threads[sel])), verdictBadge(RUN.threads[sel]), outcomeBadge(RUN.threads[sel])),
        detailBody(RUN.threads[sel]))));
  };
  draw();
  return root;
}

// ---- Variant C: grouped by what needs the human, outcomes first ----
function VariantC() {
  const groups = [
    ["Needs your attention: draft replies to review", t => t.outcome === "draft" || t.outcome === "fix-failed"],
    ["Fixes " + (RUN.dryRun ? "ready to push" : "pushed"), t => t.outcome === "fix"],
    ["Skipped", t => t.outcome === "skipped"],
  ];
  return h("div", {}, banner(), groups.map(([title, pred]) => {
    const items = RUN.threads.filter(pred);
    return items.length && h("section", { class: "pr-group" }, h("h3", {}, `${title} (${items.length})`),
      items.map(t => h("details", { class: "pr-line" },
        h("summary", {}, h("code", {}, loc(t)), verdictBadge(t), h("span", { class: "pr-oneliner" }, t.comment)),
        h("div", { class: "pr-inner" }, detailBody(t)))));
  }));
}

const VARIANTS = { A: VariantA, B: VariantB, C: VariantC };

function mount() {
  const params = new URLSearchParams(location.search);
  if (!params.has("variant")) return;
  const host = h("div", { id: "proto-results" });
  document.body.append(host);
  const bar = h("div", { id: "proto-bar" });
  document.body.append(bar);
  let tab = "summary";

  const render = () => {
    const v = KEYS.includes(params.get("variant")) ? params.get("variant") : "A";
    host.replaceChildren(
      h("div", { class: "pr-tabs" },
        ["summary", "log"].map(k => h("button", { class: tab === k ? "on" : "", onclick: () => { tab = k; render(); } }, k === "summary" ? "Summary" : "Raw log"))),
      tab === "summary" ? VARIANTS[v]() : h("div", { id: "output", style: "display:block" }, RUN.threads.flatMap(t => [h("div", { class: "log-line log-section" }, `== ${loc(t)} ==`), ...t.log.map(l => h("div", { class: "log-line" }, l))])));
    const step = d => { params.set("variant", KEYS[(KEYS.indexOf(v) + d + KEYS.length) % KEYS.length]); history.replaceState(null, "", "?" + params); render(); };
    bar.replaceChildren(h("button", { onclick: () => step(-1) }, "←"), h("span", {}, `${v} (${NAMES[v]})`), h("button", { onclick: () => step(1) }, "→"));
    bar.step = step;
  };
  document.addEventListener("keydown", e => {
    if (/input|textarea/i.test(document.activeElement?.tagName)) return;
    if (e.key === "ArrowLeft") bar.step(-1);
    if (e.key === "ArrowRight") bar.step(1);
  });
  render();
}
mount();
