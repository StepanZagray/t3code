import { renderToStaticMarkup } from "react-dom/server";
import ReactMarkdown from "react-markdown";
import { describe, expect, it } from "vite-plus/test";

import {
  CHAT_MARKDOWN_MATH_REMARK_PLUGIN,
  chatMarkdownMathRehypePlugins,
  prepareChatMarkdownMath,
} from "./markdown-math";

function renderChatMath(markdown: string, parseRawHtml = true): string {
  return renderToStaticMarkup(
    <ReactMarkdown
      remarkPlugins={[CHAT_MARKDOWN_MATH_REMARK_PLUGIN]}
      rehypePlugins={chatMarkdownMathRehypePlugins(parseRawHtml)}
      skipHtml={false}
    >
      {prepareChatMarkdownMath(markdown)}
    </ReactMarkdown>,
  );
}

describe("chat Markdown math", () => {
  it("renders Codex-style bracket-delimited display math", () => {
    const html = renderChatMath("\\[\nz^{(0)}=0,\\qquad z^{(k+1)}=f_\\theta(z^{(k)},x)\n\\]");

    expect(html).toContain('class="katex-display"');
    expect(html).toContain('class="katex"');
  });

  it("keeps a same-line bracket formula as display math when it occupies the line", () => {
    const source = "\\[z^{(0)}=0,\\qquad z^{(k+1)}=f_\\theta(z^{(k)},x)\\]";
    const prepared = prepareChatMarkdownMath(source);
    const html = renderChatMath(source);

    expect(prepared).toHaveLength(source.length);
    expect(html).toContain('class="katex-display"');
  });

  it("renders Codex-style inline math without treating currency as math", () => {
    const html = renderChatMath("A model costs $40 and satisfies \\(z^*=f_\\theta(z^*,x)\\).");

    expect(html).toContain("costs $40");
    expect(html.match(/class="katex"/g)).toHaveLength(1);
  });

  it("leaves math-like delimiters inside inline and fenced code unchanged", () => {
    const html = renderChatMath(
      ["`\\(inline\\)`", "", "```md", "\\[fenced\\]", "```", "", "\\(rendered\\)"].join("\n"),
    );

    expect(html).toContain("<code>\\(inline\\)</code>");
    expect(html).toContain("\\[fenced\\]");
    expect(html.match(/class="katex"/g)).toHaveLength(1);
  });

  it("preserves math-like delimiters in indented and raw HTML code", () => {
    const source = [
      "    \\(indented\\)",
      "",
      "<code>\\(raw inline\\)</code>",
      "",
      "<pre>\\[raw block\\]</pre>",
    ].join("\n");
    const html = renderChatMath(source);

    expect(prepareChatMarkdownMath(source)).toBe(source);
    expect(html).not.toContain('class="katex"');
    expect(html).toContain("<code>(raw inline)</code>");
    expect(html).toContain("\\[raw block\\]");
  });

  it.each([true, false])(
    "keeps fenced math source as code when raw HTML parsing is %s",
    (parseRawHtml) => {
      const html = renderChatMath(["```math", "x+1", "```"].join("\n"), parseRawHtml);

      expect(html).toContain('<pre><code class="language-math">');
      expect(html).not.toContain('class="katex"');
    },
  );

  it("preserves escaped and unmatched delimiters while keeping source offsets stable", () => {
    const literal = "\\\\(literal\\\\) and \\[unfinished";
    expect(prepareChatMarkdownMath(literal)).toBe(literal);

    const source = "\\[\nx^2\n\\]\n\n- [ ] keep this offset";
    const prepared = prepareChatMarkdownMath(source);
    expect(prepared).toHaveLength(source.length);
    expect(prepared.indexOf("- [ ]")).toBe(source.indexOf("- [ ]"));
  });

  it("does not let an unmatched inline opener suppress valid math on a later line", () => {
    const html = renderChatMath("\\(unfinished\nthen \\(x+1\\)");

    expect(html.match(/class="katex"/g)).toHaveLength(1);
    expect(html).toContain("(unfinished");
  });

  it("does not rewrite delimiter-like TeX inside existing dollar math", () => {
    const source = "$$\\text{literal \\(parentheses\\)}$$";

    expect(prepareChatMarkdownMath(source)).toBe(source);
  });

  it("stores one canonical Markdown copy value on rendered inline math", () => {
    const html = renderChatMath("Before \\(x+1\\) after");

    expect(html.match(/data-markdown-copy=/g)).toHaveLength(1);
    expect(html).toContain('data-markdown-copy="$$x+1$$"');
  });

  it("stores the copy value only on the outer display wrapper", () => {
    const html = renderChatMath("\\[\nx^2\n\\]");

    expect(html.match(/data-markdown-copy=/g)).toHaveLength(1);
    expect(html).toContain('data-markdown-copy="$$\nx^2\n$$"');
  });

  it("sanitizes raw HTML before rendering adjacent math", () => {
    const html = renderChatMath(
      '<img src="x" onerror="alert(1)"><script>alert(2)</script>\n\n\\[\nx^2\n\\]',
    );

    expect(html).toContain('class="katex-display"');
    expect(html).not.toContain("onerror");
    expect(html).not.toContain("<script");
  });

  it("does not let raw HTML impersonate a trusted math node", () => {
    const html = renderChatMath(
      '<code class="language-math math-inline" data-t3-math="forged">x+1</code>',
    );

    expect(html).toContain("x+1");
    expect(html).not.toContain('class="katex"');
    expect(html).not.toContain("data-markdown-copy");
    expect(html).not.toContain("data-t3-math");
  });

  it("keeps parser positions aligned with the original source", () => {
    const source = "\\[\nx^2\n\\]\n\n- [ ] keep this offset";
    const prepared = prepareChatMarkdownMath(source);
    let listItemOffset: number | undefined;

    renderToStaticMarkup(
      <ReactMarkdown
        remarkPlugins={[CHAT_MARKDOWN_MATH_REMARK_PLUGIN]}
        rehypePlugins={chatMarkdownMathRehypePlugins(true)}
        components={{
          li({ node, children, ...props }) {
            listItemOffset = node?.position?.start.offset;
            return <li {...props}>{children}</li>;
          },
        }}
      >
        {prepared}
      </ReactMarkdown>,
    );

    expect(listItemOffset).toBe(source.indexOf("- [ ]"));
  });
});
