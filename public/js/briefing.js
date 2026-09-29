const briefingBox = document.getElementById("briefing");
const briefingActions = document.getElementById("briefing-actions");
const downloadButton = document.getElementById("download-button");
const postButton = document.getElementById("post-button");
const postStatus = document.getElementById("post-status");

// Mermaid's own theme follows the page's light/dark scheme; it draws to
// SVG with fixed colours, so it needs telling rather than inheriting CSS.
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function initMermaid() {
  mermaid.initialize({
    startOnLoad: false,
    theme: darkQuery.matches ? "dark" : "default",
  });
}
initMermaid();
darkQuery.addEventListener("change", initMermaid);

// The one PR Briefing currently on screen -- what "Download .md" and
// "Post to GitHub" act on. Generating a new Briefing (or running a
// review) clears it, since posting a stale one for a different PR
// would be a real bug, not just a stale UI.
let currentBriefing = null;

export function clearBriefing() {
  briefingBox.hidden = true;
  briefingBox.textContent = "";
  briefingActions.hidden = true;
  postStatus.textContent = "";
  currentBriefing = null;
}

export async function showBriefing(markdown) {
  currentBriefing = markdown;
  briefingActions.hidden = false;
  await renderBriefing(markdown);
}

// Text inside a briefing comes from PR titles, descriptions and
// comments, so it's never trusted as HTML: everything below is built
// with textContent, and only the SVG mermaid itself generates is
// inserted as markup.
function appendInline(parent, text) {
  text.split("`").forEach((part, i) => {
    if (i % 2 === 1) {
      const code = document.createElement("code");
      code.textContent = part;
      parent.appendChild(code);
    } else {
      parent.appendChild(document.createTextNode(part));
    }
  });
}

async function appendDiagram(source) {
  const box = document.createElement("div");
  box.className = "diagram";
  try {
    const { svg } = await mermaid.render("briefing-diagram", source);
    box.innerHTML = svg;
  } catch {
    // The model produced something that isn't valid Mermaid -- show
    // its source instead of silently dropping the diagram.
    const note = document.createElement("p");
    note.textContent = "The diagram couldn't be rendered. Its source:";
    const pre = document.createElement("pre");
    pre.textContent = source;
    box.append(note, pre);
  }
  briefingBox.appendChild(box);
}

// Renders the same Markdown the CLI prints, in order: headings,
// paragraphs, bullets and code blocks, with the mermaid block drawn as
// a diagram in place. Deliberately a small subset -- this is the shape
// formatBriefingMarkdown produces, not a general Markdown parser.
async function renderBriefing(markdown) {
  briefingBox.textContent = "";
  briefingBox.hidden = false;
  const lines = markdown.split("\n");
  let paragraph = [];
  let list = null;

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const p = document.createElement("p");
    appendInline(p, paragraph.join(" "));
    briefingBox.appendChild(p);
    paragraph = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const fence = line.match(/^```(\w*)/);
    if (fence) {
      flushParagraph();
      list = null;
      const body = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      if (fence[1] === "mermaid") {
        await appendDiagram(body.join("\n"));
      } else {
        const pre = document.createElement("pre");
        pre.textContent = body.join("\n");
        briefingBox.appendChild(pre);
      }
      continue;
    }

    const heading = line.match(/^(#{1,3}) (.*)/);
    if (heading) {
      flushParagraph();
      list = null;
      // The page already has an h1, so a Markdown # becomes an h2.
      const h = document.createElement(`h${heading[1].length + 1}`);
      appendInline(h, heading[2]);
      briefingBox.appendChild(h);
      continue;
    }

    const bullet = line.match(/^- (.*)/);
    if (bullet) {
      flushParagraph();
      if (!list) {
        list = document.createElement("ul");
        briefingBox.appendChild(list);
      }
      const li = document.createElement("li");
      appendInline(li, bullet[1]);
      list.appendChild(li);
      continue;
    }

    if (line.trim() === "") {
      flushParagraph();
      list = null;
      continue;
    }

    list = null;
    paragraph.push(line.trim());
  }
  flushParagraph();
}

downloadButton.addEventListener("click", () => {
  if (!currentBriefing) return;
  const blob = new Blob([currentBriefing], { type: "text/markdown" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "pr-briefing.md";
  a.click();
  URL.revokeObjectURL(url);
});

export function initBriefingActions(getPrUrl) {
  postButton.addEventListener("click", async () => {
    if (!currentBriefing) return;
    postButton.disabled = true;
    postStatus.textContent = "Posting...";

    try {
      const response = await fetch("/brief/post", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prUrl: getPrUrl(),
          markdown: currentBriefing,
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error ?? `Request failed (${response.status})`);
      }
      postStatus.textContent = "";
      const link = document.createElement("a");
      link.href = data.url;
      link.target = "_blank";
      link.rel = "noopener";
      link.textContent = data.url;
      postStatus.append("Posted: ", link);
    } catch (err) {
      postStatus.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      postButton.disabled = false;
    }
  });
}
