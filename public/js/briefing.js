import { h, inline, downloadMarkdown } from "./dom.js";
import { loadMermaid } from "./mermaidLoader.js";

const briefingBox = document.getElementById("briefing");

// Mermaid's own theme follows the page's light/dark scheme; it draws to
// SVG with fixed colours, so it needs telling rather than inheriting CSS.
// It is loaded lazily (see mermaidLoader.js), so this runs once it arrives.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function initMermaid(mermaid) {
  mermaid.initialize({
    startOnLoad: false,
    // Mermaid draws its own "syntax error" graphic (a bomb) for a diagram it
    // can't parse. We show the diagram's source instead (see diagramView).
    suppressErrorRendering: true,
    theme: darkQuery.matches ? "dark" : "default",
  });
}
darkQuery.addEventListener("change", () => {
  if (window.mermaid) initMermaid(window.mermaid);
});
// Start fetching now so the first diagram is usually ready, but never wait on
// it here: a blocked CDN must not stop the page working.
loadMermaid()
  .then(initMermaid)
  .catch(() => {});

const FILES_OPEN_LIMIT = 10;

// The one PR Briefing currently on screen -- what "Download .md" acts on. A
// briefing is never posted to GitHub. Starting another run clears it.
let currentBriefing = null;
let diagramCounter = 0;

export function clearBriefing() {
  briefingBox.textContent = "";
  briefingBox.hidden = true;
  currentBriefing = null;
}

/**
 * Draws the briefing. The caller has already made the panel visible: Mermaid
 * measures text in the DOM, so a diagram drawn into a hidden panel comes out
 * empty.
 */
export async function showBriefing(markdown) {
  currentBriefing = markdown;
  briefingBox.hidden = false;
  await renderBriefing(markdown);
}

/** The briefing failed twice; the review goes on without it. */
export function showBriefingError(message) {
  currentBriefing = null;
  briefingBox.hidden = false;
  briefingBox.replaceChildren(
    h("p", "muted", `The briefing could not be written: ${message}`),
    h("p", "muted", "The code review below ran without it."),
  );
}

// ---- Parsing: the Markdown stays canonical (Download and Post use it
// verbatim); the UI just reads its shape, split by "## " headings. ----

function parseBriefing(markdown) {
  const lines = markdown.split("\n");
  let title = "PR Briefing";
  let prUrl = null;
  const sections = [];
  let current = null;
  let inFence = false;

  for (const line of lines) {
    if (line.startsWith("```")) inFence = !inFence;
    const heading = !inFence && line.match(/^## (.*)/);
    if (heading) {
      current = { title: heading[1].trim(), lines: [] };
      sections.push(current);
      continue;
    }
    if (current) {
      current.lines.push(line);
      continue;
    }
    const h1 = line.match(/^# (?:PR Briefing: )?(.*)/);
    if (h1) title = h1[1];
    else if (/^https:\/\/github\.com\/\S+\/pull\/\d+/.test(line.trim())) {
      prUrl = line.trim();
    }
  }
  return { title, prUrl, sections };
}

function prParts(prUrl) {
  const m = prUrl?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  return m ? { owner: m[1], repo: m[2], number: m[3] } : null;
}

// ---- Rendering. Everything below is built with textContent via h()/inline()
// (see dom.js), and only the SVG mermaid itself generates is inserted as
// markup. ----

async function diagramView(source) {
  const box = h("div", "diagram");
  try {
    const mermaid = await loadMermaid();
    initMermaid(mermaid);
    // Parse first: render() paints Mermaid's error graphic into the page
    // before it throws, so an invalid diagram must be rejected up front.
    await mermaid.parse(source);
    const { svg } = await mermaid.render(
      `briefing-diagram-${++diagramCounter}`,
      source,
    );
    box.innerHTML = svg;
  } catch {
    // Either the model produced something that isn't valid Mermaid, or
    // Mermaid itself could not be loaded (a blocked CDN) -- show the
    // diagram's source instead of silently dropping it.
    document.getElementById(`dbriefing-diagram-${diagramCounter}`)?.remove();
    const pre = h("pre", "");
    pre.textContent = source;
    box.append(
      h("p", "", "The diagram couldn't be rendered. Its source:"),
      pre,
    );
  }
  return box;
}

// Paragraphs, bullets and fenced blocks (a mermaid fence is drawn as a
// diagram). A small subset -- the shape formatBriefingMarkdown produces,
// not a general Markdown parser.
async function blocks(lines) {
  const out = [];
  let paragraph = [];
  let list = null;

  const flush = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(" ");
    const italic = text.match(/^_(.+)_$/);
    out.push(
      italic
        ? h("p", "muted", h("em", "", italic[1]))
        : h("p", "", inline(text)),
    );
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = line.match(/^```(\w*)/);
    if (fence) {
      flush();
      list = null;
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      if (fence[1] === "mermaid") out.push(await diagramView(body.join("\n")));
      else {
        const pre = h("pre", "");
        pre.textContent = body.join("\n");
        out.push(pre);
      }
      continue;
    }
    const heading = line.match(/^#{3,} (.*)/);
    if (heading) {
      flush();
      list = null;
      out.push(h("h4", "", inline(heading[1])));
      continue;
    }
    // "- item" is a bullet, "1. item" a numbered step (the reading order).
    const bullet = line.match(/^(?:- |\d+\. )(.*)/);
    if (bullet) {
      flush();
      const tag = /^\d/.test(line) ? "ol" : "ul";
      if (!list || list.tagName.toLowerCase() !== tag) {
        list = h(tag, "");
        out.push(list);
      }
      // A reading-order step is "`path`: why": the path gets its own line.
      const step = tag === "ol" && bullet[1].match(/^`([^`]+)`:?\s*(.*)$/);
      list.append(
        step
          ? h(
              "li",
              "bf-step",
              h(
                "div",
                "bf-step-body",
                h("code", "bf-step-path", step[1]),
                step[2] && h("span", "bf-step-why", inline(step[2])),
              ),
            )
          : h("li", "", inline(bullet[1])),
      );
      continue;
    }
    if (line.trim() === "") {
      flush();
      list = null;
      continue;
    }
    list = null;
    paragraph.push(line.trim());
  }
  flush();
  return out;
}

// The changed-files tree is one fenced block of "<marker> <path> (+A -D)"
// lines; each becomes a row with the counts coloured. Anything that doesn't
// match that shape is shown as plain text rather than dropped.
function filesView(lines) {
  const body = [];
  let inFence = false;
  for (const line of lines) {
    if (line.startsWith("```")) {
      inFence = !inFence;
      continue;
    }
    if (inFence && line.trim()) body.push(line);
  }
  if (body.length === 0 || body[0].startsWith("(no files")) {
    return h("p", "muted", "No files changed.");
  }
  const details = h("details", "bf-files");
  details.open = body.length <= FILES_OPEN_LIMIT;
  details.append(h("summary", "", `Changed files (${body.length})`));
  const list = h("div", "bf-file-list");
  for (const line of body) {
    const m = line.match(/^(\S+) (.*) \(\+(\d+) -(\d+)\)$/);
    list.append(
      m
        ? h(
            "div",
            "bf-file",
            h("span", "bf-marker", m[1]),
            h("code", "", m[2]),
            h("span", "bf-add", `+${m[3]}`),
            h("span", "bf-del", `-${m[4]}`),
          )
        : h("div", "bf-file", line),
    );
  }
  details.append(list);
  return details;
}

async function sectionView(section) {
  const key = section.title.toLowerCase();
  const isRisks = key.startsWith("risks");
  const isFiles = key === "changed files";
  // A class per section, so the style sheet can give each its own look.
  const kind = isRisks
    ? " bf-risks"
    : key === "summary"
      ? " bf-summary"
      : key === "how it fits in"
        ? " bf-fits"
        : key === "where to start reading"
          ? " bf-reading"
          : "";
  const el = h("section", `bf-section${kind}`);
  if (!isFiles) el.append(h("h3", "", section.title));
  if (isFiles) el.append(filesView(section.lines));
  else el.append(...(await blocks(section.lines)));
  return el;
}

function actionsView(prUrl) {
  const parts = prParts(prUrl);
  const box = h("div", "bf-actions");

  const download = h("button", "secondary", "Download .md");
  download.type = "button";
  download.addEventListener("click", () => {
    if (!currentBriefing) return;
    downloadMarkdown(
      parts
        ? `pr-briefing-${parts.owner}-${parts.repo}-${parts.number}.md`
        : "pr-briefing.md",
      currentBriefing,
    );
  });
  box.append(download);
  return box;
}

async function renderBriefing(markdown) {
  const { title, prUrl, sections } = parseBriefing(markdown);
  const parts = prParts(prUrl);
  const heading = h("h2", "");
  if (prUrl) {
    const link = h("a", "", inline(title));
    link.href = prUrl;
    link.target = "_blank";
    link.rel = "noopener";
    heading.append(link);
  } else {
    heading.append(...inline(title));
  }
  const header = h(
    "header",
    "bf-header",
    h(
      "div",
      "bf-title",
      heading,
      parts &&
        h("span", "bf-sub", `${parts.owner}/${parts.repo}#${parts.number}`),
    ),
    actionsView(prUrl),
  );

  briefingBox.textContent = "";
  briefingBox.append(header);
  for (const section of sections) {
    briefingBox.append(await sectionView(section));
  }
}
