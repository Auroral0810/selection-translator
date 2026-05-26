import {Editor, MarkdownFileInfo, MarkdownView, TFile} from "obsidian";
import TranslationPlugin from "../main";
import {isHTMLElement, isHTMLImageElement} from "../ui/dom";
import {getTFileByPath} from "../vault/files";

const SUPPORTED_IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp"]);

interface ImageMarkdownMatch {
	path: string;
	index: number;
	length: number;
}

export interface ImageReferenceContext {
	file: TFile;
	sourceFile: TFile | null;
	editor?: Editor;
	line?: number;
	match?: ImageMarkdownMatch;
}

export function isSupportedImageFile(file: TFile): boolean {
	return SUPPORTED_IMAGE_EXTENSIONS.has(file.extension.toLowerCase());
}

export function resolveImageContextFromEditor(plugin: TranslationPlugin, editor: Editor, info: MarkdownView | MarkdownFileInfo): ImageReferenceContext | null {
	const line = editor.getLine(editor.getCursor().line);
	const lineNumber = editor.getCursor().line;
	const match = findImageMarkdownMatch(line, editor.getCursor().ch);
	const sourceFile = "file" in info ? info.file ?? null : null;
	if (!match) {
		return null;
	}
	const file = resolveVaultImage(plugin, match.path, sourceFile?.path ?? "");
	return file ? {file, sourceFile, editor, line: lineNumber, match} : null;
}

export function resolveImageContextFromReadingDom(plugin: TranslationPlugin, event: MouseEvent): ImageReferenceContext | null {
	const target = isHTMLElement(event.target) ? event.target : null;
	const maybeImage = target?.closest("img") ?? null;
	if (!isHTMLImageElement(maybeImage)) {
		return null;
	}
	const image = maybeImage;

	const sourcePath = image.closest(".markdown-preview-view")?.getAttribute("data-path") ?? "";
	const candidates = [
		image.getAttribute("alt") ?? "",
		image.getAttribute("src") ?? "",
		image.currentSrc,
	];
	const sourceFile = getTFileByPath(plugin.app.vault, sourcePath);

	for (const candidate of candidates) {
		const file = resolveVaultImage(plugin, candidate, sourcePath);
		if (file) {
			return {file, sourceFile};
		}
	}

	return null;
}

export async function resolveImageContextFromNoteFile(plugin: TranslationPlugin, imageFile: TFile, sourceFile: TFile | null): Promise<ImageReferenceContext | null> {
	if (!sourceFile || sourceFile.extension !== "md") {
		return null;
	}

	const markdown = await plugin.app.vault.cachedRead(sourceFile);
	const located = findImageReferenceInMarkdown(plugin, markdown, imageFile, sourceFile.path);
	return located ? {file: imageFile, sourceFile, line: located.line, match: located.match} : null;
}

export async function createAvailableSiblingFile(plugin: TranslationPlugin, sourceFile: TFile, suffix: string, extension: string, data: ArrayBuffer): Promise<TFile> {
	const basePath = sourceFile.path.slice(0, -sourceFile.extension.length - 1);
	const normalizedExtension = extension.replace(/^\./, "");
	let path = `${basePath}${suffix}.${normalizedExtension}`;
	let counter = 2;

	while (getTFileByPath(plugin.app.vault, path)) {
		path = `${basePath}${suffix}.${counter}.${normalizedExtension}`;
		counter++;
	}

	return plugin.app.vault.createBinary(path, data);
}

export async function insertTranslatedImageBelow(plugin: TranslationPlugin, context: ImageReferenceContext, translatedFile: TFile): Promise<void> {
	const sourceFile = requireSourceFile(context);
	const embed = createImageEmbed(plugin, translatedFile, sourceFile.path);
	if (context.editor && context.line !== undefined && context.match) {
		const line = context.editor.getLine(context.line);
		context.editor.replaceRange(`\n${embed}`, {line: context.line, ch: line.length});
		return;
	}

	const markdown = await plugin.app.vault.read(sourceFile);
	const located = findImageReferenceInMarkdown(plugin, markdown, context.file, sourceFile.path);
	if (!located) {
		throw new Error("Could not find the original image reference in the note.");
	}

	const lines = markdown.split("\n");
	lines.splice(located.line + 1, 0, embed);
	await plugin.app.vault.modify(sourceFile, lines.join("\n"));
}

export async function replaceImageReference(plugin: TranslationPlugin, context: ImageReferenceContext, translatedFile: TFile): Promise<void> {
	const sourceFile = requireSourceFile(context);
	const embed = createImageEmbed(plugin, translatedFile, sourceFile.path);
	if (context.editor && context.line !== undefined && context.match) {
		context.editor.replaceRange(embed, {
			line: context.line,
			ch: context.match.index,
		}, {
			line: context.line,
			ch: context.match.index + context.match.length,
		});
		return;
	}

	const markdown = await plugin.app.vault.read(sourceFile);
	const located = findImageReferenceInMarkdown(plugin, markdown, context.file, sourceFile.path);
	if (!located) {
		throw new Error("Could not find the original image reference in the note.");
	}

	const lines = markdown.split("\n");
	const line = lines[located.line] ?? "";
	lines[located.line] = `${line.slice(0, located.match.index)}${embed}${line.slice(located.match.index + located.match.length)}`;
	await plugin.app.vault.modify(sourceFile, lines.join("\n"));
}

function findImageMarkdownMatch(line: string, cursorCh: number): ImageMarkdownMatch | null {
	const matches = [
		...Array.from(line.matchAll(/!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)).map(match => ({path: match[1] ?? "", index: match.index ?? 0, length: match[0].length})),
		...Array.from(line.matchAll(/!\[[^\]]*]\(([^)#]+)(?:#[^)]+)?\)/g)).map(match => ({path: match[1] ?? "", index: match.index ?? 0, length: match[0].length})),
	];

	const underCursor = matches.find(match => cursorCh >= match.index && cursorCh <= match.index + match.length);
	return underCursor ?? matches[0] ?? null;
}

function findImageReferenceInMarkdown(plugin: TranslationPlugin, markdown: string, imageFile: TFile, sourcePath: string): {line: number; match: ImageMarkdownMatch} | null {
	const lines = markdown.split("\n");
	for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
		const line = lines[lineIndex] ?? "";
		const matches = [
			...Array.from(line.matchAll(/!\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g)).map(match => ({path: match[1] ?? "", index: match.index ?? 0, length: match[0].length})),
			...Array.from(line.matchAll(/!\[[^\]]*]\(([^)#]+)(?:#[^)]+)?\)/g)).map(match => ({path: match[1] ?? "", index: match.index ?? 0, length: match[0].length})),
		];
		const match = matches.find(item => resolveVaultImage(plugin, item.path, sourcePath)?.path === imageFile.path);
		if (match) {
			return {line: lineIndex, match};
		}
	}
	return null;
}

function createImageEmbed(plugin: TranslationPlugin, file: TFile, sourcePath: string): string {
	const linkText = plugin.app.metadataCache.fileToLinktext(file, sourcePath);
	return `![[${linkText}]]`;
}

function requireSourceFile(context: ImageReferenceContext): TFile {
	if (!context.sourceFile) {
		throw new Error("This image action requires a note reference. Use it from an image inside a Markdown note.");
	}
	return context.sourceFile;
}

function resolveVaultImage(plugin: TranslationPlugin, rawPath: string, sourcePath: string): TFile | null {
	const cleanedPath = cleanImagePath(rawPath);
	if (!cleanedPath) {
		return null;
	}

	const direct = plugin.app.metadataCache.getFirstLinkpathDest(cleanedPath, sourcePath);
	if (direct instanceof TFile && isSupportedImageFile(direct)) {
		return direct;
	}

	const lowerCleaned = cleanedPath.toLowerCase();
	return plugin.app.vault.getFiles().find(file => isSupportedImageFile(file) && (
		file.path.toLowerCase() === lowerCleaned
		|| file.name.toLowerCase() === lowerCleaned
		|| decodeURIComponent(lowerCleaned).endsWith(file.path.toLowerCase())
		|| decodeURIComponent(lowerCleaned).endsWith(file.name.toLowerCase())
	)) ?? null;
}

function cleanImagePath(value: string): string {
	return value
		.replace(/^app:\/\/[^/]+\//, "")
		.replace(/^file:\/\//, "")
		.split("?")[0] ?? ""
		.trim()
		.replace(/^<|>$/g, "");
}
