import { describe, expect, it } from "vitest";
// Plain browser JS with no types, like runState.js.
// @ts-expect-error untyped module
import { splitCodeTokens } from "../public/js/codeTokens.js";

type Part = { code: boolean; text: string };
const codeOf = (text: string): string[] =>
  (splitCodeTokens(text) as Part[]).filter((p) => p.code).map((p) => p.text);

describe("splitCodeTokens", () => {
  it("gives the input back exactly when the parts are joined", () => {
    const text =
      "ingestion.ts calls sortPicturesBySection() and reads IMAGE_SECTION_PRIORITY, see packages/api/src/a.ts.";
    expect((splitCodeTokens(text) as Part[]).map((p) => p.text).join("")).toBe(
      text,
    );
  });

  it("finds file paths and file names", () => {
    expect(
      codeOf(
        "Edit packages/api/src/backbone/ingestion.ts and section-ordering.ts.",
      ),
    ).toEqual([
      "packages/api/src/backbone/ingestion.ts",
      "section-ordering.ts",
    ]);
    expect(codeOf("Changes @wunderflats/constants and ./x/y.ts")).toEqual([
      "@wunderflats/constants",
      "./x/y.ts",
    ]);
  });

  it("finds calls, member chains, constants and camelCase or PascalCase names", () => {
    expect(codeOf("Use pickCoverImage() here.")).toEqual(["pickCoverImage()"]);
    expect(codeOf("via ctx.imagesLib.categorizeImages.")).toEqual([
      "ctx.imagesLib.categorizeImages",
    ]);
    expect(codeOf("imagesById.get(id)! is asserted")).toEqual([
      "imagesById.get(id)!",
    ]);
    expect(
      codeOf(
        "IMAGE_SECTION_DISPLAY_PRIORITY and picturesBySection and ReviewThread",
      ),
    ).toEqual([
      "IMAGE_SECTION_DISPLAY_PRIORITY",
      "picturesBySection",
      "ReviewThread",
    ]);
    expect(codeOf("a snake_case_name")).toEqual(["snake_case_name"]);
  });

  it("leaves ordinary words and sentence punctuation alone", () => {
    expect(
      codeOf(
        "This is fine, e.g. for users. It works, i.e. always; and/or never. See 24/7 support, yes/no, images/pictures.",
      ),
    ).toEqual([]);
    expect(
      codeOf("Node.js and GitHub and JavaScript and TypeScript and DevOps"),
    ).toEqual([]);
    expect(codeOf("Version 1.2.3 costs 3.5 euros.")).toEqual([]);
  });

  it("does not split a URL into code", () => {
    expect(
      codeOf("Open https://github.com/wunderflats/api/pull/8383 now"),
    ).toEqual([]);
  });

  it("keeps a trailing full stop out of the code", () => {
    const parts = splitCodeTokens("It is in ingestion.ts.") as Part[];
    expect(parts.filter((p) => p.code).map((p) => p.text)).toEqual([
      "ingestion.ts",
    ]);
    expect(parts.at(-1)?.text).toBe(".");
  });

  it("returns one plain part for text with no code", () => {
    expect(splitCodeTokens("Nothing to see here")).toEqual([
      { code: false, text: "Nothing to see here" },
    ]);
  });
});
