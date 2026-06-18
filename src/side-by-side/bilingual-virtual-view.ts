import {ItemView, MarkdownRenderer, TFile, WorkspaceLeaf} from "obsidian";
import {t} from "../i18n";
import type TranslationPlugin from "../main";
import {decodeTranslationSyncAnchor, parseMarkdownTranslationBlocks} from "../markdown/markdown-ast";
import {getTFileByPath} from "../vault/files";

export const BILINGUAL_VIRTUAL_VIEW_TYPE = "selection-translator-bilingual-virtual";

interface BilingualVirtualViewState {
	sourcePath?: string;
	targetLanguage?: string;
}

interface BilingualSection {
	id: string;
	anchorIds: string[];
	kind: "normal" | "table";
	sourceMarkdown: string;
	translatedMarkdown: string;
	sourcePath: string;
	translatedPath: string;
}

interface TranslatedAnchorBlock {
	id: string;
	from: number;
	to: number;
	markdown: string;
}

interface MarkdownTableRange {
	from: number;
	to: number;
	anchorIds: string[];
}

export class BilingualVirtualView extends ItemView {
	private state: BilingualVirtualViewState = {};
	private sections: BilingualSection[] = [];
	private scroller: HTMLElement | null = null;
	private renderGeneration = 0;

	constructor(
		leaf: WorkspaceLeaf,
		private readonly plugin: TranslationPlugin,
	) {
		super(leaf);
	}

	getViewType(): string {
		return BILINGUAL_VIRTUAL_VIEW_TYPE;
	}

	getDisplayText(): string {
		const sourceFile = this.getSourceFile();
		return sourceFile ? `${sourceFile.basename} 对照阅读` : "对照阅读";
	}

	getIcon(): string {
		return "book-open";
	}

	getState(): Record<string, unknown> {
		return {...this.state};
	}

	async setState(state: unknown): Promise<void> {
		this.state = isBilingualState(state) ? state : {};
		await this.renderView();
	}

	async onOpen(): Promise<void> {
		this.addAction("refresh-cw", t(this.plugin, "common.refresh"), () => {
			void this.renderView();
		});
		await this.renderView();
	}

	private async renderView(): Promise<void> {
		const generation = ++this.renderGeneration;
		this.sections = [];
		this.scroller = null;
		this.contentEl.empty();
		this.contentEl.addClass("selection-translator-bilingual-view");

		const sourceFile = this.getSourceFile();
		if (!sourceFile) {
			this.renderEmpty(t(this.plugin, "notice.openMarkdown"));
			return;
		}

		const targetLanguage = this.state.targetLanguage || this.plugin.settings.targetLanguage;
		const translatedFile = await this.plugin.documentTranslationService.translateFile(sourceFile, targetLanguage);
		if (generation !== this.renderGeneration) {
			return;
		}

		const [sourceMarkdown, translatedMarkdown] = await Promise.all([
			this.plugin.app.vault.cachedRead(sourceFile),
			this.plugin.app.vault.cachedRead(translatedFile),
		]);
		if (generation !== this.renderGeneration) {
			return;
		}

		this.sections = this.createSections(sourceMarkdown, translatedMarkdown, sourceFile.path, translatedFile.path);
		if (this.sections.length === 0) {
			this.renderEmpty(t(this.plugin, "document.noTranslatableContent"));
			return;
		}

		this.renderShell();
		await this.renderArticles(generation);
	}

	private renderEmpty(message: string): void {
		this.contentEl.createDiv({
			cls: "selection-translator-bilingual-empty",
			text: message,
		});
	}

	private renderShell(): void {
		const toolbar = this.contentEl.createDiv({cls: "selection-translator-bilingual-toolbar"});
		toolbar.createDiv({
			cls: "selection-translator-bilingual-title",
			text: this.getDisplayText(),
		});
		toolbar.createDiv({
			cls: "selection-translator-bilingual-meta",
			text: this.state.targetLanguage || this.plugin.settings.targetLanguage,
		});

		this.scroller = this.contentEl.createDiv({cls: "selection-translator-bilingual-scroll"});
		this.scroller.createDiv({cls: "selection-translator-bilingual-reader"});
	}

	private async renderArticles(generation: number): Promise<void> {
		const reader = this.contentEl.querySelector<HTMLElement>(".selection-translator-bilingual-reader");
		if (!reader) {
			return;
		}

		for (const section of this.sections) {
			if (generation !== this.renderGeneration) {
				return;
			}

			const row = reader.createDiv({cls: "selection-translator-bilingual-row"});
			row.dataset.anchorId = section.id;
			row.dataset.anchorIds = section.anchorIds.join("\n");
			row.dataset.sectionKind = section.kind;

			const sourceSection = row.createDiv({cls: "selection-translator-bilingual-section selection-translator-bilingual-source-section"});
			const translatedSection = row.createDiv({cls: "selection-translator-bilingual-section selection-translator-bilingual-translated-section"});
			sourceSection.dataset.anchorId = section.id;
			sourceSection.dataset.anchorIds = section.anchorIds.join("\n");
			sourceSection.dataset.sectionKind = section.kind;
			translatedSection.dataset.anchorId = section.id;
			translatedSection.dataset.anchorIds = section.anchorIds.join("\n");
			translatedSection.dataset.sectionKind = section.kind;

			await Promise.all([
				MarkdownRenderer.render(this.plugin.app, section.sourceMarkdown, sourceSection, section.sourcePath, this),
				MarkdownRenderer.render(this.plugin.app, section.translatedMarkdown, translatedSection, section.translatedPath, this),
			]);
		}
	}

	private createSections(sourceMarkdown: string, translatedMarkdown: string, sourcePath: string, translatedPath: string): BilingualSection[] {
		const sourceBlocks = parseMarkdownTranslationBlocks(sourceMarkdown);
		const translatedBlocks = this.extractTranslatedBlocks(translatedMarkdown);
		const translatedById = new Map(translatedBlocks.map(block => [block.id, block.markdown]));
		const sourceTables = createTableRanges(sourceMarkdown, sourceBlocks);
		const translatedTables = createTranslatedTableRanges(translatedMarkdown);
		const usedTables = new Set<MarkdownTableRange>();
		let usedTableCount = 0;
		const sections: BilingualSection[] = [];

		for (const [index, block] of sourceBlocks.entries()) {
			const sourceTable = block.kind === "table-cell" ? findTableContainingBlock(sourceTables, block.from, block.to) : null;
			if (sourceTable) {
				if (!usedTables.has(sourceTable)) {
					usedTables.add(sourceTable);
					sections.push({
						id: sourceTable.anchorIds[0] ?? block.id,
						anchorIds: sourceTable.anchorIds,
						kind: "table",
						sourceMarkdown: sourceMarkdown.slice(sourceTable.from, sourceTable.to),
						translatedMarkdown: findTranslatedTableMarkdown(sourceTable.anchorIds, translatedMarkdown, translatedTables, translatedBlocks, usedTableCount),
						sourcePath,
						translatedPath,
					});
					usedTableCount++;
				}
				continue;
			}

			sections.push({
				id: block.id,
				anchorIds: [block.id],
				kind: "normal",
				sourceMarkdown: block.sourceText,
				translatedMarkdown: translatedById.get(block.id) ?? translatedBlocks[index]?.markdown ?? "",
				sourcePath,
				translatedPath,
			});
		}

		return sections;
	}

	private extractTranslatedBlocks(markdown: string): TranslatedAnchorBlock[] {
		const markerPattern = /<!--\s*(selection-translator-anchor:[\s\S]*?)\s*-->/g;
		const markers = Array.from(markdown.matchAll(markerPattern))
			.map(match => {
				const id = decodeTranslationSyncAnchor(match[1] ?? "");
				if (!id) {
					return null;
				}
				const markerFrom = match.index ?? 0;
				return {
					id,
					markerFrom,
					markerTo: markerFrom + match[0].length,
				};
			})
			.filter((marker): marker is {id: string; markerFrom: number; markerTo: number} => !!marker);

		if (markers.length === 0) {
			return parseMarkdownTranslationBlocks(markdown).map(block => ({
				id: block.id,
				from: block.from,
				to: block.to,
				markdown: block.sourceText,
			}));
		}

		return markers.map((marker, index) => {
			const nextMarkerFrom = markers[index + 1]?.markerFrom ?? markdown.length;
			const from = skipWhitespace(markdown, marker.markerTo, nextMarkerFrom);
			const to = trimRangeEnd(markdown, from, nextMarkerFrom);
			return {
				id: marker.id,
				from,
				to,
				markdown: markdown.slice(from, to),
			};
		});
	}

	private getSourceFile(): TFile | null {
		const sourcePath = this.state.sourcePath;
		return sourcePath ? getTFileByPath(this.plugin.app.vault, sourcePath) : null;
	}
}

export async function openBilingualVirtualView(plugin: TranslationPlugin, sourceFile: TFile, targetLanguage = plugin.settings.targetLanguage): Promise<void> {
	const leaf = findReusableBilingualLeaf(plugin, sourceFile.path, targetLanguage) ?? plugin.app.workspace.getLeaf("split", "vertical");
	await leaf.setViewState({
		type: BILINGUAL_VIRTUAL_VIEW_TYPE,
		active: true,
		state: {
			sourcePath: sourceFile.path,
			targetLanguage,
		},
	});
	await plugin.app.workspace.revealLeaf(leaf);
}

function findReusableBilingualLeaf(plugin: TranslationPlugin, sourcePath: string, targetLanguage: string): WorkspaceLeaf | null {
	const leaves = plugin.app.workspace.getLeavesOfType(BILINGUAL_VIRTUAL_VIEW_TYPE);
	const exactLeaf = leaves.find(leaf => {
		const state = leaf.getViewState().state;
		return isBilingualState(state)
			&& state.sourcePath === sourcePath
			&& (state.targetLanguage ?? plugin.settings.targetLanguage) === targetLanguage;
	});
	return exactLeaf ?? leaves[0] ?? null;
}

function isBilingualState(value: unknown): value is BilingualVirtualViewState {
	if (!value || typeof value !== "object") {
		return false;
	}
	const record = value as Record<string, unknown>;
	return (record.sourcePath === undefined || typeof record.sourcePath === "string")
		&& (record.targetLanguage === undefined || typeof record.targetLanguage === "string");
}

function skipWhitespace(text: string, from: number, to: number): number {
	let index = from;
	while (index < to && /\s/.test(text[index] ?? "")) {
		index++;
	}
	return index;
}

function trimRangeEnd(text: string, from: number, to: number): number {
	let index = to;
	while (index > from && /\s/.test(text[index - 1] ?? "")) {
		index--;
	}
	return index;
}

function createTableRanges(markdown: string, blocks: ReturnType<typeof parseMarkdownTranslationBlocks>): MarkdownTableRange[] {
	const lines = getLineRanges(markdown);
	const tables: MarkdownTableRange[] = [];
	for (let index = 0; index < lines.length - 1; index++) {
		const headerLine = lines[index];
		const delimiterLine = lines[index + 1];
		if (!headerLine || !delimiterLine) {
			continue;
		}
		const header = markdown.slice(headerLine.from, headerLine.to);
		const delimiter = markdown.slice(delimiterLine.from, delimiterLine.to);
		if (!isMarkdownTableRow(header) || !isMarkdownTableDelimiterRow(delimiter)) {
			continue;
		}

		const fromLine = index;
		let toLine = index + 2;
		while (toLine < lines.length) {
			const line = lines[toLine];
			if (!line || !isMarkdownTableRow(markdown.slice(line.from, line.to))) {
				break;
			}
			toLine++;
		}

		const firstLine = lines[fromLine];
		const lastLine = lines[toLine - 1];
		if (!firstLine || !lastLine) {
			continue;
		}
		const from = firstLine.from;
		const to = lastLine.to;
		const anchorIds = blocks
			.filter(block => block.kind === "table-cell" && block.from >= from && block.to <= to)
			.map(block => block.id);
		if (anchorIds.length > 0) {
			tables.push({from, to, anchorIds});
		}
		index = toLine - 1;
	}
	return tables;
}

function createTranslatedTableRanges(markdown: string): MarkdownTableRange[] {
	const blocks = parseMarkdownTranslationBlocks(markdown);
	return createTableRanges(markdown, blocks);
}

function findTableContainingBlock(tables: MarkdownTableRange[], from: number, to: number): MarkdownTableRange | null {
	return tables.find(table => from >= table.from && to <= table.to) ?? null;
}

function findTranslatedTableMarkdown(
	sourceAnchorIds: string[],
	translatedMarkdown: string,
	translatedTables: MarkdownTableRange[],
	translatedBlocks: TranslatedAnchorBlock[],
	fallbackTableIndex: number,
): string {
	const anchorSet = new Set(sourceAnchorIds);
	const anchoredBlocks = translatedBlocks.filter(block => anchorSet.has(block.id));
	if (anchoredBlocks.length > 0) {
		const first = Math.min(...anchoredBlocks.map(block => block.from));
		const last = Math.max(...anchoredBlocks.map(block => block.to));
		const containingTable = translatedTables.find(table => first >= table.from && last <= table.to);
		if (containingTable) {
			return translatedMarkdown.slice(containingTable.from, containingTable.to);
		}
		return translatedMarkdown.slice(first, last);
	}

	const firstTranslatedTable = translatedTables.find(table => table.anchorIds.some(id => anchorSet.has(id)));
	if (firstTranslatedTable) {
		return translatedMarkdown.slice(firstTranslatedTable.from, firstTranslatedTable.to);
	}

	const fallbackTable = translatedTables[fallbackTableIndex];
	if (fallbackTable) {
		return translatedMarkdown.slice(fallbackTable.from, fallbackTable.to);
	}

	return sourceAnchorIds
		.map(id => translatedBlocks.find(block => block.id === id)?.markdown)
		.filter((markdown): markdown is string => !!markdown)
		.join("\n\n");
}

function getLineRanges(markdown: string): Array<{from: number; to: number}> {
	const ranges: Array<{from: number; to: number}> = [];
	let from = 0;
	for (let index = 0; index <= markdown.length; index++) {
		if (index === markdown.length || markdown[index] === "\n") {
			ranges.push({from, to: index});
			from = index + 1;
		}
	}
	return ranges;
}

function isMarkdownTableRow(line: string): boolean {
	const trimmed = line.trim();
	return trimmed.includes("|") && !/^```/.test(trimmed);
}

function isMarkdownTableDelimiterRow(line: string): boolean {
	const cells = line
		.trim()
		.replace(/^\|/, "")
		.replace(/\|$/, "")
		.split("|")
		.map(cell => cell.trim());
	return cells.length > 0 && cells.every(cell => /^:?-{3,}:?$/.test(cell));
}
