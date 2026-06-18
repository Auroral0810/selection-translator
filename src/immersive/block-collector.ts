import type {MarkdownPostProcessorContext} from "obsidian";
import TranslationPlugin from "../main";
import {MarkdownTranslationBlock, parseMarkdownTranslationBlocks} from "../markdown/markdown-ast";
import {RenderedTranslationTarget} from "./types";
import {isTranslatableMarkdownText, normalizeMarkdownText} from "../translation/text-filter";

interface CandidateElement {
	element: HTMLElement;
	fingerprint: string;
}

export function collectRenderedTranslationBlocks(
	containerEl: HTMLElement,
	sourcePath: string,
	plugin: TranslationPlugin,
	ctx?: MarkdownPostProcessorContext,
): RenderedTranslationTarget[] {
	const astTargets = collectAstMatchedBlocks(containerEl, sourcePath, plugin, ctx);
	if (astTargets.length === 0) {
		return collectDomFallbackBlocks(containerEl, sourcePath, plugin, new Set());
	}

	const usedElements = new Set(astTargets.map(target => target.element));
	return [
		...astTargets,
		...collectDomFallbackBlocks(containerEl, sourcePath, plugin, usedElements),
	].sort((a, b) => compareDocumentOrder(a.element, b.element));
}

function collectAstMatchedBlocks(
	containerEl: HTMLElement,
	sourcePath: string,
	plugin: TranslationPlugin,
	ctx?: MarkdownPostProcessorContext,
): RenderedTranslationTarget[] {
	const section = ctx?.getSectionInfo(containerEl);
	if (!section) {
		return [];
	}

	const blocks = parseMarkdownTranslationBlocks(section.text);
	if (blocks.length === 0) {
		return [];
	}

	const candidates = collectAstCandidates(containerEl);
	const usedCandidates = new Set<HTMLElement>();
	const targets: RenderedTranslationTarget[] = [];

	for (const block of blocks) {
		const candidate = findCandidateForBlock(block, candidates, usedCandidates);
		if (!candidate) {
			continue;
		}

		const sourceText = getReadableBlockText(block.translationText);
		if (!sourceText) {
			continue;
		}

		const compact = isCompactBlock(block, candidate.element);
		if (!isTranslatableMarkdownText(sourceText)) {
			continue;
		}

		usedCandidates.add(candidate.element);
		targets.push({
			element: candidate.element,
			placement: getPlacement(block, candidate.element),
			compact,
			block: {
				id: `${sourcePath}:ast:${section.lineStart}:${block.id}`,
				sourceText,
				filePath: sourcePath,
				headingPath: block.headingPath,
				startLine: section.lineStart + countLinesBefore(section.text, block.from),
				endLine: section.lineStart + countLinesBefore(section.text, block.to),
			},
		});
	}

	return targets;
}

function collectDomFallbackBlocks(
	containerEl: HTMLElement,
	sourcePath: string,
	plugin: TranslationPlugin,
	usedElements: Set<HTMLElement>,
): RenderedTranslationTarget[] {
	const elements = collectCandidateElements(containerEl, "h1, h2, h3, h4, h5, h6, p, li, td, th")
		.filter(element => !usedElements.has(element) && !hasUsedAncestor(element, usedElements) && isCandidateElement(element));

	return elements
		.map((element, index) => {
			const compact = element.matches("li, td, th");
			const sourceText = getElementText(element);
			return {
				element,
				placement: compact ? "inside" as const : "after" as const,
				compact,
				block: {
					id: `${sourcePath}:rendered:${index}:${sourceText.slice(0, 24)}`,
					sourceText,
					filePath: sourcePath,
					headingPath: getNearestHeadingPath(element),
				},
			};
		})
		.filter(item => isTranslatableMarkdownText(item.block.sourceText));
}

function collectAstCandidates(containerEl: HTMLElement): CandidateElement[] {
	return collectCandidateElements(containerEl, "h1, h2, h3, h4, h5, h6, p, li, td, th, blockquote, .callout-content")
		.filter(isAstCandidateElement)
		.map(element => ({
			element,
			fingerprint: fingerprintText(getElementText(element)),
		}))
		.filter(candidate => Boolean(candidate.fingerprint));
}

function findCandidateForBlock(
	block: MarkdownTranslationBlock,
	candidates: CandidateElement[],
	usedCandidates: Set<HTMLElement>,
): CandidateElement | null {
	const selectors = getPreferredSelectors(block);
	const blockFingerprint = fingerprintText(block.sourceText || block.translationText);
	if (!blockFingerprint) {
		return null;
	}

	const preferred = candidates.filter(candidate => !usedCandidates.has(candidate.element) && selectors.some(selector => candidate.element.matches(selector)));
	return preferred.find(candidate => candidate.fingerprint === blockFingerprint)
		?? preferred.find(candidate => fingerprintsAreCompatible(candidate.fingerprint, blockFingerprint))
		?? null;
}

function getPreferredSelectors(block: MarkdownTranslationBlock): string[] {
	switch (block.kind) {
		case "heading":
			return ["h1", "h2", "h3", "h4", "h5", "h6"];
		case "list-item":
		case "task-item":
			return ["li"];
		case "table-cell":
			return ["td", "th"];
		case "blockquote":
			return ["blockquote"];
		case "callout-body":
			return [".callout-content"];
		case "paragraph":
		default:
			return ["p"];
	}
}

function isCompactBlock(block: MarkdownTranslationBlock, element: HTMLElement): boolean {
	return block.kind === "list-item"
		|| block.kind === "task-item"
		|| block.kind === "table-cell"
		|| element.matches("li, td, th");
}

function getPlacement(block: MarkdownTranslationBlock, element: HTMLElement): "after" | "inside" {
	if (block.kind === "list-item" || block.kind === "task-item" || block.kind === "table-cell" || element.matches("li, td, th, .callout-content")) {
		return "inside";
	}
	return "after";
}

function isAstCandidateElement(element: HTMLElement): boolean {
	if (!isCandidateElement(element)) {
		return false;
	}

	if (element.matches("p") && element.closest("blockquote, .callout-content")) {
		return false;
	}

	return true;
}

function collectCandidateElements(containerEl: HTMLElement, selector: string): HTMLElement[] {
	const elements = containerEl.matches(selector) ? [containerEl] : [];
	elements.push(...Array.from(containerEl.querySelectorAll<HTMLElement>(selector)));
	return Array.from(new Set(elements));
}

function getNearestHeadingPath(element: HTMLElement): string[] {
	const headings: string[] = [];
	let current: Element | null = element.previousElementSibling;
	while (current) {
		if (current.instanceOf(HTMLElement) && current.matches("h1, h2, h3, h4, h5, h6")) {
			headings.unshift(getElementText(current));
			break;
		}
		current = current.previousElementSibling;
	}
	return headings.filter(Boolean);
}

function isCandidateElement(element: HTMLElement): boolean {
	if (element.closest("pre, code, .math, .math-block, .mjx-container, .selection-translator-immersive")) {
		return false;
	}

	if (element.closest(".callout-title, .callout-icon")) {
		return false;
	}

	if (element.matches("p") && element.closest("li, td, th")) {
		return false;
	}

	if (element.matches("button, input, textarea, select") || element.closest("button")) {
		return false;
	}

	return Boolean(getReadableDomText(element));
}

function getElementText(element: HTMLElement): string {
	return getReadableDomText(element);
}

function getReadableDomText(element: HTMLElement): string {
	const clone = element.cloneNode(true) as HTMLElement;
	clone.querySelectorAll([
		"ul",
		"ol",
		"table",
		"pre",
		"code",
		"button",
		"input",
		"textarea",
		"select",
		"img",
		"svg",
		".internal-embed",
		".image-embed",
		".file-embed",
		".markdown-embed",
		".media-embed",
		".selection-translator-immersive",
	].join(", ")).forEach(child => child.remove());
	return clone.innerText.replace(/\s+/g, " ").trim();
}

function getReadableBlockText(text: string): string {
	const withoutEmbeds = text
		.replace(/!\[\[[^\]]+]]/g, " ")
		.replace(/\[\[[^\]]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif|pdf|mp3|mp4|wav|webm|mov)(?:#[^\]]*)?(?:\|[^\]]*)?]]/gi, " ")
		.replace(/!\[[^\]]*]\([^)]*\)/g, " ")
		.replace(/<img\b[^>]*>/gi, " ");
	const normalized = withoutEmbeds.replace(/\s+/g, " ").trim();
	return isReadableText(normalized) ? normalized : "";
}

function isReadableText(text: string): boolean {
	if (!text) {
		return false;
	}
	if (/^[\p{P}\p{S}\p{Number}\s]+$/u.test(text)) {
		return false;
	}
	if (/^[\w\s.-]+\.(?:png|jpe?g|gif|webp|svg|bmp|avif|pdf|mp3|mp4|wav|webm|mov)$/i.test(text)) {
		return false;
	}
	return /\p{Letter}/u.test(text);
}

function fingerprintText(text: string): string {
	return normalizeMarkdownText(text).replace(/\s+/g, "").toLowerCase();
}

function fingerprintsAreCompatible(a: string, b: string): boolean {
	const [shorter, longer] = a.length < b.length ? [a, b] : [b, a];
	return shorter.length >= 2 && longer.includes(shorter);
}

function countLinesBefore(text: string, offset: number): number {
	return text.slice(0, Math.max(0, offset)).split("\n").length - 1;
}

function hasUsedAncestor(element: HTMLElement, usedElements: Set<HTMLElement>): boolean {
	let parent = element.parentElement;
	while (parent) {
		if (usedElements.has(parent)) {
			return true;
		}
		parent = parent.parentElement;
	}
	return false;
}

function compareDocumentOrder(a: HTMLElement, b: HTMLElement): number {
	if (a === b) {
		return 0;
	}
	const position = a.compareDocumentPosition(b);
	if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
		return -1;
	}
	if (position & Node.DOCUMENT_POSITION_PRECEDING) {
		return 1;
	}
	return 0;
}
