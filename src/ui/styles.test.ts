import { describe, expect, it } from "vitest";
import { LUMI_MIND_CSS } from "./styles";

describe("LumiMind style isolation", () => {
  it("does not resize SVGs owned by mounted Lumiverse components", () => {
    expect(LUMI_MIND_CSS).not.toMatch(/\.lm-root\s+svg\s*\{/);
    expect(LUMI_MIND_CSS).toContain(".lm-icon > svg, .lm-brand-mark > svg, .lm-empty-icon > svg");
  });
});
