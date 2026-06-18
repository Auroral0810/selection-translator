import {GFM, parser} from "@lezer/markdown";
import type {SyntaxNode} from "@lezer/common";
import {isTranslatableMarkdownText, normalizeMarkdownText} from "../translation/text-filter";

export type MarkdownTranslationBlockKind =
	| "heading"
	| "paragraph"
	| "list-item"
	| "task-item"
	| "blockquote"
	| "callout-body"
	| "table-cell";

export interface MarkdownTranslationBlock {
	id: string;
	kind: MarkdownTranslationBlockKind;
	from: number;
	to: number;
	sourceText: string;
	translationText: string;
	headingPath: string[];
	protectedTokens: ProtectedToken[];
}

export interface MarkdownTranslationReplacement {
	block: MarkdownTranslationBlock;
	translatedText: string;
}

export interface RenderTranslatedMarkdownOptions {
	includeSyncAnchors?: boolean;
}

export interface ProtectedToken {
	token: string;
	value: string;
}

interface PendingBlock {
	kind: MarkdownTranslationBlockKind;
	from: number;
	to: number;
	sourceText: string;
	translationText: string;
	headingPath: string[];
}

const markdownParser = parser.configure([GFM]);
const TRANSLATABLE_NODE_NAMES = new Set(["Paragraph", "Task", "HTMLBlock"]);
const SKIP_ANCESTOR_NAMES = new Set(["FencedCode", "CodeBlock", "HTMLBlock", "TableCell"]);
export const TRANSLATION_SYNC_ANCHOR_PREFIX = "selection-translator-anchor:";

export function parseMarkdownTranslationBlocks(markdown: string): MarkdownTranslationBlock[] {
	const tree = markdownParser.parse(markdown);
	const blocks: MarkdownTranslationBlock[] = [];
	const skipRanges = collectManualSkipRanges(markdown);
	const headingPath: string[] = [];

	tree.iterate({
		enter(node): boolean | void {
			if (isInsideRanges(node.from, node.to, skipRanges)) {
				return false;
			}

			if (isHeadingNode(node.name)) {
				const block = createHeadingBlock(markdown, node.node, headingPath);
				if (block) {
					headingPath.length = 0;
					headingPath.push(block.translationText);
					blocks.push(finalizeBlock(markdown, block));
				}
				return false;
			}

			if (node.name === "Blockquote") {
				const block = createBlockquoteBlock(markdown, node.node, headingPath);
				if (block) {
					blocks.push(finalizeBlock(markdown, block));
				}
				return false;
			}

			if (node.name === "TableCell") {
				const block = createTableCellBlock(markdown, node.node, headingPath);
				if (block) {
					blocks.push(finalizeBlock(markdown, block));
				}
				return false;
			}

			if (TRANSLATABLE_NODE_NAMES.has(node.name)) {
				const block = createTextBlock(markdown, node.node, headingPath);
				if (block) {
					blocks.push(finalizeBlock(markdown, block));
				}
				return false;
			}
		},
	});

	return dedupeOverlappingBlocks(blocks);
}

export function renderTranslatedMarkdown(
	markdown: string,
	replacements: MarkdownTranslationReplacement[],
	options: RenderTranslatedMarkdownOptions = {},
): string {
	const ordered = [...replacements].sort((a, b) => b.block.from - a.block.from);
	let output = markdown;

	for (const item of ordered) {
		const rendered = renderBlockTranslation(item.block, item.translatedText, options);
		output = `${output.slice(0, item.block.from)}${rendered}${output.slice(item.block.to)}`;
	}

	return output;
}

export function restoreProtectedTokens(text: string, tokens: ProtectedToken[]): string {
	let restored = text;
	for (const token of tokens) {
		restored = restored.split(token.token).join(token.value);
	}
	return restored;
}

function createHeadingBlock(markdown: string, node: SyntaxNode, headingPath: string[]): PendingBlock | null {
	const source = markdown.slice(node.from, node.to);
	if (node.name.startsWith("SetextHeading")) {
		const newlineIndex = source.indexOf("\n");
		if (newlineIndex <= 0) {
			return null;
		}
		const sourceText = source.slice(0, newlineIndex).trim();
		const leading = source.slice(0, source.search(/\S/));
		const from = node.from + leading.length;
		return createPendingBlock("heading", from, node.from + newlineIndex, sourceText, sourceText, headingPath);
	}

	const match = /^(\s{0,3}#{1,6}\s+)([\s\S]*?)(\s+#+\s*)?$/.exec(source);
	if (!match?.[2]) {
		return null;
	}
	const prefix = match[1] ?? "";
	const suffix = match[3] ?? "";
	const from = node.from + prefix.length;
	const to = node.to - suffix.length;
	const sourceText = markdown.slice(from, to);
	return createPendingBlock("heading", from, to, sourceText, sourceText, headingPath);
}

function createBlockquoteBlock(markdown: string, node: SyntaxNode, headingPath: string[]): PendingBlock | null {
	const source = markdown.slice(node.from, node.to);
	const lines = source.split("\n");
	const callout = parseCallout(lines);
	if (callout) {
		const sourceText = callout.bodyLines.join("\n");
		return createPendingBlock("callout-body", node.from, node.to, source, sourceText, headingPath);
	}

	const text = lines.map(stripBlockquoteMarker).join("\n").trim();
	return createPendingBlock("blockquote", node.from, node.to, source, text, headingPath);
}

function createTableCellBlock(markdown: string, node: SyntaxNode, headingPath: string[]): PendingBlock | null {
	const sourceText = markdown.slice(node.from, node.to).trim();
	if (!sourceText || isTableDelimiterCell(sourceText)) {
		return null;
	}
	return createPendingBlock("table-cell", node.from, node.to, sourceText, sourceText, headingPath);
}

function createTextBlock(markdown: string, node: SyntaxNode, headingPath: string[]): PendingBlock | null {
	if (node.name !== "HTMLBlock" && hasAncestor(node, SKIP_ANCESTOR_NAMES)) {
		return null;
	}

	if (node.name === "Paragraph" && hasAncestor(node, new Set(["Blockquote"]))) {
		return null;
	}

	if (node.name === "Task") {
		return createTaskBlock(markdown, node, headingPath);
	}

	const sourceText = markdown.slice(node.from, node.to);
	const kind: MarkdownTranslationBlockKind = hasAncestor(node, new Set(["ListItem"])) ? "list-item" : "paragraph";
	return createPendingBlock(kind, node.from, node.to, sourceText, sourceText, headingPath);
}

function createTaskBlock(markdown: string, node: SyntaxNode, headingPath: string[]): PendingBlock | null {
	const source = markdown.slice(node.from, node.to);
	const match = /^(\[[ xX]\]\s*)([\s\S]*)$/.exec(source);
	if (!match?.[2]) {
		return null;
	}
	const prefix = match[1] ?? "";
	const from = node.from + prefix.length;
	const sourceText = markdown.slice(from, node.to);
	return createPendingBlock("task-item", from, node.to, sourceText, sourceText, headingPath);
}

function createPendingBlock(
	kind: MarkdownTranslationBlockKind,
	from: number,
	to: number,
	sourceText: string,
	translationText: string,
	headingPath: string[],
): PendingBlock | null {
	if (!isTranslatableMarkdownText(translationText)) {
		return null;
	}

	return {
		kind,
		from,
		to,
		sourceText,
		translationText,
		headingPath: [...headingPath],
	};
}

function finalizeBlock(markdown: string, block: PendingBlock): MarkdownTranslationBlock {
	if (block.kind === "blockquote" || block.kind === "callout-body") {
		return {
			...block,
			id: makeBlockId(block, block.translationText),
			protectedTokens: [],
		};
	}

	const {text, tokens} = protectInlineMarkdown(markdown, block.from, block.to, block.translationText);
	return {
		...block,
		id: makeBlockId(block, text),
		translationText: text,
		protectedTokens: tokens,
	};
}

function protectInlineMarkdown(markdown: string, from: number, to: number, text: string): {text: string; tokens: ProtectedToken[]} {
	const tree = markdownParser.parse(markdown.slice(from, to));
	const protectedRanges: Array<{from: number; to: number}> = [];

	tree.iterate({
		enter(node): boolean | void {
			if (node.name === "InlineCode" || node.name === "Image" || node.name === "HTMLTag") {
				protectedRanges.push({from: node.from, to: node.to});
				return false;
			}
		},
	});

	if (protectedRanges.length === 0) {
		return {text, tokens: []};
	}

	const tokens: ProtectedToken[] = [];
	let protectedText = text;
	for (const range of protectedRanges.sort((a, b) => b.from - a.from)) {
		const value = text.slice(range.from, range.to);
		if (!value) {
			continue;
		}
		const token = `__ST_KEEP_${tokens.length}__`;
		tokens.push({token, value});
		protectedText = `${protectedText.slice(0, range.from)}${token}${protectedText.slice(range.to)}`;
	}
	return {text: protectedText, tokens};
}

export function encodeTranslationSyncAnchor(blockId: string): string {
	return `${TRANSLATION_SYNC_ANCHOR_PREFIX}${encodeURIComponent(blockId)}`;
}

export function decodeTranslationSyncAnchor(value: string): string | null {
	const trimmed = value.trim();
	if (!trimmed.startsWith(TRANSLATION_SYNC_ANCHOR_PREFIX)) {
		return null;
	}

	try {
		return decodeURIComponent(trimmed.slice(TRANSLATION_SYNC_ANCHOR_PREFIX.length));
	} catch {
		return null;
	}
}

function renderBlockTranslation(
	block: MarkdownTranslationBlock,
	translatedText: string,
	options: RenderTranslatedMarkdownOptions,
): string {
	const restored = restoreProtectedTokens(translatedText.trim(), block.protectedTokens);
	const anchor = options.includeSyncAnchors ? `<!-- ${encodeTranslationSyncAnchor(block.id)} -->` : "";
	if (block.kind === "blockquote") {
		return renderBlockquote(restored, anchor);
	}
	if (block.kind === "callout-body") {
		return renderCallout(block.sourceText, restored, anchor);
	}
	return `${anchor}${restored}`;
}

function renderBlockquote(text: string, anchor = ""): string {
	const lines = text
		.split("\n")
		.map(line => `> ${line}`)
		.join("\n");
	return anchor ? `> ${anchor}\n${lines}` : lines;
}

function renderCallout(source: string, translatedText: string, anchor = ""): string {
	const lines = source.split("\n");
	const firstLine = lines[0] ?? "";
	const body = translatedText
		.split("\n")
		.filter(line => line.trim().length > 0)
		.map(line => `> ${line}`);
	if (anchor) {
		body.unshift(`> ${anchor}`);
	}
	return [firstLine, ...body].join("\n");
}

function parseCallout(lines: string[]): {bodyLines: string[]} | null {
	const firstLine = stripBlockquoteMarker(lines[0] ?? "");
	if (!/^\[![^\]]+]/.test(firstLine.trim())) {
		return null;
	}

	const bodyLines = lines.slice(1)
		.map(stripBlockquoteMarker)
		.filter(line => line.trim().length > 0);
	return bodyLines.length > 0 ? {bodyLines} : null;
}

function stripBlockquoteMarker(line: string): string {
	return line.replace(/^\s*>\s?/, "");
}

function isHeadingNode(name: string): boolean {
	return /^ATXHeading[1-6]$/.test(name) || /^SetextHeading[1-2]$/.test(name);
}

function isTableDelimiterCell(text: string): boolean {
	return /^:?-{3,}:?$/.test(text.trim());
}

function hasAncestor(node: SyntaxNode, names: Set<string>): boolean {
	let current = node.parent;
	while (current) {
		if (names.has(current.name)) {
			return true;
		}
		current = current.parent;
	}
	return false;
}

function collectManualSkipRanges(markdown: string): Array<{from: number; to: number}> {
	const ranges: Array<{from: number; to: number}> = [];
	const frontmatter = /^---\n[\s\S]*?\n---(?:\n|$)/.exec(markdown);
	if (frontmatter) {
		ranges.push({from: 0, to: frontmatter[0].length});
	}

	for (const match of markdown.matchAll(/(^|\n)\$\$\s*\n[\s\S]*?\n\$\$\s*(?=\n|$)/g)) {
		const from = (match.index ?? 0) + (match[1] ? 1 : 0);
		ranges.push({from, to: (match.index ?? 0) + match[0].length});
	}

	for (const match of markdown.matchAll(/<!--\s*selection-translator-anchor:[\s\S]*?-->/g)) {
		ranges.push({from: match.index ?? 0, to: (match.index ?? 0) + match[0].length});
	}

	return ranges;
}

function isInsideRanges(from: number, to: number, ranges: Array<{from: number; to: number}>): boolean {
	return ranges.some(range => from >= range.from && to <= range.to);
}

function dedupeOverlappingBlocks(blocks: MarkdownTranslationBlock[]): MarkdownTranslationBlock[] {
	const result: MarkdownTranslationBlock[] = [];
	for (const block of blocks.sort((a, b) => a.from - b.from || b.to - a.to)) {
		if (result.some(item => rangesOverlap(item, block))) {
			continue;
		}
		result.push(block);
	}
	return result;
}

function rangesOverlap(a: MarkdownTranslationBlock, b: MarkdownTranslationBlock): boolean {
	return a.from < b.to && b.from < a.to;
}

function makeBlockId(block: PendingBlock, translationText: string): string {
	return [
		block.kind,
		block.headingPath.join(" > "),
		normalizeMarkdownText(translationText),
	].join("\u001f");
}
