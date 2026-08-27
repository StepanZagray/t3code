import type { Options as ReactMarkdownOptions } from "react-markdown";
import rehypeKatex from "rehype-katex";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkMath from "remark-math";

interface MarkdownHtmlAstNode {
  type?: string;
  tagName?: string;
  value?: string;
  data?: Record<string, unknown>;
  properties?: Record<string, unknown>;
  children?: MarkdownHtmlAstNode[];
}

type MathCarrierKind = "inline" | "display";

const MATH_CARRIER_CLASSES = new Set(["language-math", "math-inline", "math-display"]);
const TRUSTED_MATH_NODE_TYPE = "t3TrustedMath";
const MATH_CODE_FENCE_NODE_TYPE = "t3MathCodeFence";
const WINDOWS_DRIVE_PATH_REGEX = /^[A-Za-z]:[\\/]/;

const CHAT_MARKDOWN_SANITIZE_SCHEMA = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    "*": (defaultSchema.attributes?.["*"] ?? []).filter((attribute) => attribute !== "title"),
    code: [...(defaultSchema.attributes?.code ?? []), "dataCodeMeta", "dataInlineCode"],
    blockquote: [...(defaultSchema.attributes?.blockquote ?? []), "dataAlert"],
  },
  protocols: {
    ...defaultSchema.protocols,
    href: [...(defaultSchema.protocols?.href ?? []), "file"],
    src: [...(defaultSchema.protocols?.src ?? []), "file"],
  },
} satisfies Parameters<typeof rehypeSanitize>[0];

export const CHAT_MARKDOWN_MATH_REMARK_PLUGIN = [
  remarkMath,
  { singleDollarTextMath: false },
] satisfies NonNullable<ReactMarkdownOptions["remarkPlugins"]>[number];

function hasClassName(element: MarkdownHtmlAstNode, className: string): boolean {
  const value = element.properties?.className;
  return Array.isArray(value) ? value.includes(className) : value === className;
}

function visitElements(
  node: MarkdownHtmlAstNode,
  visitor: (element: MarkdownHtmlAstNode) => void,
): void {
  if (node.type === "element") visitor(node);
  node.children?.forEach((child) => visitElements(child, visitor));
}

function rehypePromoteStandaloneMath() {
  return (tree: MarkdownHtmlAstNode) => {
    const visit = (node: MarkdownHtmlAstNode): void => {
      if (node.type === "element" && node.tagName === "p") {
        const meaningfulChildren = (node.children ?? []).filter(
          (child) => child.type !== "text" || Boolean(child.value?.trim()),
        );
        const candidate = meaningfulChildren.length === 1 ? meaningfulChildren[0] : undefined;
        if (
          candidate?.type === "element" &&
          candidate.tagName === "code" &&
          hasClassName(candidate, "language-math") &&
          hasClassName(candidate, "math-inline")
        ) {
          const classNames = classNamesWithoutMathCarriers(candidate.properties?.className);
          candidate.properties ??= {};
          candidate.properties.className = [...classNames, "language-math", "math-display"];
          node.tagName = candidate.tagName;
          node.properties = candidate.properties;
          if (candidate.children) node.children = candidate.children;
          else delete node.children;
          if (candidate.data) node.data = candidate.data;
          else delete node.data;
        }
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function rehypePreserveTrustedMathCarriers() {
  return (tree: MarkdownHtmlAstNode) => {
    visitElements(tree, (element) => {
      if (element.tagName !== "code" || !hasClassName(element, "language-math")) return;
      const kind: MathCarrierKind | null = hasClassName(element, "math-display")
        ? "display"
        : hasClassName(element, "math-inline")
          ? "inline"
          : null;
      if (kind === null) return;
      element.type = TRUSTED_MATH_NODE_TYPE;
      element.data = { ...element.data, t3MathKind: kind };
    });
  };
}

function rehypeProtectMathCodeFences() {
  return (tree: MarkdownHtmlAstNode) => {
    visitElements(tree, (element) => {
      if (
        element.tagName !== "code" ||
        !hasClassName(element, "language-math") ||
        hasClassName(element, "math-inline") ||
        hasClassName(element, "math-display")
      ) {
        return;
      }
      element.type = MATH_CODE_FENCE_NODE_TYPE;
      element.data = { ...element.data, t3MathCodeFence: true };
    });
  };
}

function classNamesWithoutMathCarriers(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return values.filter(
    (className): className is string =>
      typeof className === "string" && !MATH_CARRIER_CLASSES.has(className),
  );
}

function rehypeNormalizeMathCarriersAfterRaw() {
  return (tree: MarkdownHtmlAstNode) => {
    const visit = (node: MarkdownHtmlAstNode): void => {
      if (node.type === TRUSTED_MATH_NODE_TYPE || node.type === MATH_CODE_FENCE_NODE_TYPE) {
        node.type = "element";
      }
      if (node.type === "element" && node.tagName === "code") {
        node.properties ??= {};
        const classNames = classNamesWithoutMathCarriers(node.properties.className);
        if (classNames.length > 0) node.properties.className = classNames;
        else delete node.properties.className;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

/** Preserve Windows drive paths through the protocol allowlist in rehype-sanitize. */
function rehypeNormalizeWindowsImageSrc() {
  return (tree: MarkdownHtmlAstNode) => {
    const visit = (node: MarkdownHtmlAstNode): void => {
      const src = node.properties?.src;
      if (
        node.type === "element" &&
        node.tagName === "img" &&
        typeof src === "string" &&
        WINDOWS_DRIVE_PATH_REGEX.test(src)
      ) {
        node.properties = {
          ...node.properties,
          src: `file:///${src.replaceAll("\\", "/")}`,
        };
      }
      node.children?.forEach(visit);
    };

    visit(tree);
  };
}

function rehypeRestoreMathCodeFences() {
  return (tree: MarkdownHtmlAstNode) => {
    const visit = (node: MarkdownHtmlAstNode): void => {
      if (node.type === MATH_CODE_FENCE_NODE_TYPE) node.type = "element";
      if (node.type === "element" && node.tagName === "code" && node.data?.t3MathCodeFence) {
        node.properties ??= {};
        const classNames = classNamesWithoutMathCarriers(node.properties.className);
        node.properties.className = [...classNames, "language-math"];
        delete node.data.t3MathCodeFence;
      }
      node.children?.forEach(visit);
    };
    visit(tree);
  };
}

function rehypeRestoreTrustedMathCarriers() {
  return (tree: MarkdownHtmlAstNode) => {
    visitElements(tree, (element) => {
      if (element.tagName !== "code") return;
      element.properties ??= {};
      const classNames = classNamesWithoutMathCarriers(element.properties.className);
      const kind = element.data?.t3MathKind;
      if (element.data) delete element.data.t3MathKind;
      if (kind === "inline" || kind === "display") {
        classNames.push("language-math", `math-${kind}`);
      }
      if (classNames.length > 0) element.properties.className = classNames;
      else delete element.properties.className;
    });
  };
}

function texAnnotation(node: MarkdownHtmlAstNode): string | null {
  if (node.type === "element" && node.tagName === "annotation") {
    const text = (node.children ?? [])
      .filter((child) => child.type === "text")
      .map((child) => child.value ?? "")
      .join("");
    return text || null;
  }
  for (const child of node.children ?? []) {
    const annotation = texAnnotation(child);
    if (annotation !== null) return annotation;
  }
  return null;
}

function rehypeTagMathCopySource() {
  return (tree: MarkdownHtmlAstNode) => {
    const visit = (node: MarkdownHtmlAstNode): void => {
      if (node.type !== "element") {
        node.children?.forEach(visit);
        return;
      }

      const display = hasClassName(node, "katex-display");
      const inline = hasClassName(node, "katex");
      if (display || inline) {
        const source = texAnnotation(node);
        if (source !== null) {
          node.properties ??= {};
          node.properties.dataMarkdownCopy = display ? `$$\n${source}\n$$` : `$$${source}$$`;
          return;
        }
      }
      node.children?.forEach(visit);
    };

    tree.children?.forEach(visit);
  };
}

const CHAT_MARKDOWN_MATH_REHYPE_PLUGINS = [
  rehypePromoteStandaloneMath,
  rehypeProtectMathCodeFences,
  [rehypeKatex, { trust: false }],
  rehypeRestoreMathCodeFences,
  rehypeTagMathCopySource,
] satisfies NonNullable<ReactMarkdownOptions["rehypePlugins"]>;

export function chatMarkdownMathRehypePlugins(
  parseRawHtml: boolean,
): NonNullable<ReactMarkdownOptions["rehypePlugins"]> {
  if (!parseRawHtml) return CHAT_MARKDOWN_MATH_REHYPE_PLUGINS;

  return [
    rehypePromoteStandaloneMath,
    rehypePreserveTrustedMathCarriers,
    rehypeProtectMathCodeFences,
    [rehypeRaw, { passThrough: [TRUSTED_MATH_NODE_TYPE, MATH_CODE_FENCE_NODE_TYPE] }],
    rehypeNormalizeMathCarriersAfterRaw,
    rehypeNormalizeWindowsImageSrc,
    [rehypeSanitize, CHAT_MARKDOWN_SANITIZE_SCHEMA],
    rehypeRestoreTrustedMathCarriers,
    [rehypeKatex, { trust: false }],
    rehypeRestoreMathCodeFences,
    rehypeTagMathCopySource,
  ];
}

function markFencedCode(markdown: string, protectedCharacters: Uint8Array): void {
  let activeFence: { character: "`" | "~"; length: number; start: number } | null = null;
  let lineStart = 0;

  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline + 1;
    const line = markdown
      .slice(lineStart, newline === -1 ? markdown.length : newline)
      .replace(/\r$/, "");

    if (activeFence) {
      const closing = /^ {0,3}(`{3,}|~{3,})[\t ]*$/.exec(line)?.[1];
      if (closing?.[0] === activeFence.character && closing.length >= activeFence.length) {
        protectedCharacters.fill(1, activeFence.start, lineEnd);
        activeFence = null;
      }
    } else {
      const openingMatch = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
      const opening = openingMatch?.[1];
      const info = openingMatch?.[2] ?? "";
      if (opening && (opening[0] === "~" || !info.includes("`"))) {
        activeFence = {
          character: opening[0] as "`" | "~",
          length: opening.length,
          start: lineStart,
        };
      }
    }

    lineStart = lineEnd;
  }

  if (activeFence) {
    protectedCharacters.fill(1, activeFence.start);
  }
}

function markIndentedCode(markdown: string, protectedCharacters: Uint8Array): void {
  let lineStart = 0;
  while (lineStart < markdown.length) {
    const newline = markdown.indexOf("\n", lineStart);
    const lineEnd = newline === -1 ? markdown.length : newline + 1;
    if (
      protectedCharacters[lineStart] !== 1 &&
      (markdown.startsWith("    ", lineStart) || markdown[lineStart] === "\t")
    ) {
      protectedCharacters.fill(1, lineStart, lineEnd);
    }
    lineStart = lineEnd;
  }
}

function backtickRunLength(markdown: string, start: number): number {
  let end = start;
  while (markdown[end] === "`") end += 1;
  return end - start;
}

function markInlineCode(markdown: string, protectedCharacters: Uint8Array): void {
  let index = 0;
  while (index < markdown.length) {
    if (protectedCharacters[index] === 1 || markdown[index] !== "`") {
      index += 1;
      continue;
    }

    const openingLength = backtickRunLength(markdown, index);
    let candidate = index + openingLength;
    let closingEnd = -1;
    while (candidate < markdown.length && protectedCharacters[candidate] !== 1) {
      if (markdown[candidate] !== "`") {
        candidate += 1;
        continue;
      }
      const candidateLength = backtickRunLength(markdown, candidate);
      if (candidateLength === openingLength) {
        closingEnd = candidate + candidateLength;
        break;
      }
      candidate += candidateLength;
    }

    if (closingEnd === -1) {
      index += openingLength;
      continue;
    }
    protectedCharacters.fill(1, index, closingEnd);
    index = closingEnd;
  }
}

function htmlTagEnd(markdown: string, start: number): number {
  let quote: '"' | "'" | null = null;
  for (let index = start; index < markdown.length; index += 1) {
    const character = markdown[index];
    if (quote) {
      if (character === quote) quote = null;
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index + 1;
    }
  }
  return markdown.length;
}

function markRawCodeContainers(markdown: string, protectedCharacters: Uint8Array): void {
  const openingTag = /<(pre|code)\b/gi;
  let opening: RegExpExecArray | null;
  while ((opening = openingTag.exec(markdown))) {
    if (protectedCharacters[opening.index] === 1) continue;
    const openingEnd = htmlTagEnd(markdown, openingTag.lastIndex);
    const closingTag = new RegExp(`</${opening[1]}\\s*>`, "gi");
    closingTag.lastIndex = openingEnd;
    const closing = closingTag.exec(markdown);
    const protectedEnd = closing ? closing.index + closing[0].length : markdown.length;
    protectedCharacters.fill(1, opening.index, protectedEnd);
    openingTag.lastIndex = protectedEnd;
  }
}

function isEscaped(markdown: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && markdown[cursor] === "\\"; cursor -= 1) {
    backslashes += 1;
  }
  return backslashes % 2 === 1;
}

function dollarRunLength(markdown: string, start: number): number {
  let end = start;
  while (markdown[end] === "$") end += 1;
  return end - start;
}

function markExistingDollarMath(markdown: string, protectedCharacters: Uint8Array): void {
  let index = 0;
  while (index < markdown.length - 1) {
    if (
      protectedCharacters[index] === 1 ||
      markdown[index] !== "$" ||
      markdown[index + 1] !== "$" ||
      isEscaped(markdown, index)
    ) {
      index += 1;
      continue;
    }

    const openingLength = dollarRunLength(markdown, index);
    let candidate = index + openingLength;
    let closingEnd = -1;
    while (candidate < markdown.length && protectedCharacters[candidate] !== 1) {
      if (markdown[candidate] !== "$" || isEscaped(markdown, candidate)) {
        candidate += 1;
        continue;
      }
      const candidateLength = dollarRunLength(markdown, candidate);
      if (candidateLength === openingLength) {
        closingEnd = candidate + candidateLength;
        break;
      }
      candidate += candidateLength;
    }

    if (closingEnd === -1) {
      index += openingLength;
      continue;
    }
    protectedCharacters.fill(1, index, closingEnd);
    index = closingEnd;
  }
}

function findMathClosingDelimiter(
  markdown: string,
  protectedCharacters: Uint8Array,
  start: number,
  closingCharacter: ")" | "]",
  allowNewlines: boolean,
): number {
  for (let index = start; index < markdown.length - 1; index += 1) {
    if (!allowNewlines && markdown[index] === "\n") return -1;
    if (protectedCharacters[index] === 1) continue;
    if (
      markdown[index] === "\\" &&
      markdown[index + 1] === closingCharacter &&
      protectedCharacters[index + 1] !== 1 &&
      !isEscaped(markdown, index)
    ) {
      return index;
    }
  }
  return -1;
}

export function prepareChatMarkdownMath(markdown: string): string {
  const protectedCharacters = new Uint8Array(markdown.length);
  markFencedCode(markdown, protectedCharacters);
  markIndentedCode(markdown, protectedCharacters);
  markInlineCode(markdown, protectedCharacters);
  markRawCodeContainers(markdown, protectedCharacters);
  markExistingDollarMath(markdown, protectedCharacters);

  const normalized = markdown.split("");
  let inlineClosingDelimiterUnavailableUntil = 0;
  let noDisplayClosingDelimiterRemaining = false;
  for (let index = 0; index < markdown.length - 1; index += 1) {
    if (
      protectedCharacters[index] === 1 ||
      markdown[index] !== "\\" ||
      isEscaped(markdown, index)
    ) {
      continue;
    }

    const openingCharacter = markdown[index + 1];
    if (openingCharacter !== "(" && openingCharacter !== "[") continue;
    if (
      (openingCharacter === "(" && index < inlineClosingDelimiterUnavailableUntil) ||
      (openingCharacter === "[" && noDisplayClosingDelimiterRemaining)
    ) {
      continue;
    }
    const closingIndex = findMathClosingDelimiter(
      markdown,
      protectedCharacters,
      index + 2,
      openingCharacter === "(" ? ")" : "]",
      openingCharacter === "[",
    );
    if (closingIndex === -1) {
      if (openingCharacter === "(") {
        const newline = markdown.indexOf("\n", index + 2);
        inlineClosingDelimiterUnavailableUntil = newline === -1 ? markdown.length : newline + 1;
      } else {
        noDisplayClosingDelimiterRemaining = true;
      }
      continue;
    }
    if (!markdown.slice(index + 2, closingIndex).trim()) continue;

    normalized[index] = "$";
    normalized[index + 1] = "$";
    normalized[closingIndex] = "$";
    normalized[closingIndex + 1] = "$";
    index = closingIndex + 1;
  }

  return normalized.join("");
}
