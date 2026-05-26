import {TFile} from "obsidian";
import type TranslationPlugin from "../main";
import type {DocumentTranslationLinkSettingEntry} from "../settings/types";
import {sha256Hex} from "../translation/hash";
import {getTFileByPath} from "../vault/files";

export interface ParsedTranslatedFile {
	legacyMetadata: DocumentTranslationLinkSettingEntry | null;
	body: string;
}

const LEGACY_SYNC_MARKER_PREFIX = "<!-- selection-translator-sync:";
const LEGACY_SYNC_MARKER_SUFFIX = "-->";

export class TranslatedFileSyncStore {
	constructor(private readonly plugin: TranslationPlugin) {}

	async findLinkedTranslatedFile(sourceFile: TFile): Promise<TFile | null> {
		const linkedFile = this.findLinkedFileFromSettings(sourceFile);
		if (linkedFile) {
			return linkedFile;
		}

		for (const candidate of this.getCandidateTranslatedFiles(sourceFile)) {
			const parsed = await this.readTranslatedFile(candidate);
			if (parsed.legacyMetadata
				&& parsed.legacyMetadata.sourcePath === sourceFile.path
				&& parsed.legacyMetadata.targetLanguage === this.plugin.settings.targetLanguage) {
				await this.upsertLink({
					...parsed.legacyMetadata,
					translatedPath: candidate.path,
				});
				return candidate;
			}
		}

		return null;
	}

	async readTranslatedFile(file: TFile): Promise<ParsedTranslatedFile> {
		return this.parse(await this.plugin.app.vault.read(file), file.path);
	}

	parse(markdown: string, translatedPath: string): ParsedTranslatedFile {
		const trimmedStart = markdown.trimStart();
		if (!trimmedStart.startsWith(LEGACY_SYNC_MARKER_PREFIX)) {
			return {legacyMetadata: null, body: markdown};
		}

		const leadingWhitespaceLength = markdown.length - trimmedStart.length;
		const markerEnd = markdown.indexOf(LEGACY_SYNC_MARKER_SUFFIX, leadingWhitespaceLength);
		if (markerEnd < 0) {
			return {legacyMetadata: null, body: markdown};
		}

		const markerText = markdown.slice(leadingWhitespaceLength + LEGACY_SYNC_MARKER_PREFIX.length, markerEnd).trim();
		const bodyStart = markerEnd + LEGACY_SYNC_MARKER_SUFFIX.length;
		const body = markdown.slice(bodyStart).replace(/^\r?\n/, "");

		try {
			const parsed = JSON.parse(markerText) as Partial<DocumentTranslationLinkSettingEntry>;
			if (!isValidLinkEntry(parsed)) {
				return {legacyMetadata: null, body: markdown};
			}
			return {
				legacyMetadata: {
					...parsed,
					translatedPath,
				},
				body,
			};
		} catch {
			return {legacyMetadata: null, body: markdown};
		}
	}

	async recordGeneratedFile(sourceMarkdown: string, translatedBody: string, sourcePath: string, translatedPath: string): Promise<void> {
		await this.upsertLink({
			sourcePath,
			translatedPath,
			targetLanguage: this.plugin.settings.targetLanguage,
			provider: this.plugin.settings.currentProvider,
			promptUseCase: "translated-file",
			sourceHash: await sha256Hex(sourceMarkdown),
			generatedBodyHash: await sha256Hex(translatedBody),
			updatedAt: new Date().toISOString(),
		});
	}

	findLinkForSource(sourcePath: string, targetLanguage = this.plugin.settings.targetLanguage): DocumentTranslationLinkSettingEntry | null {
		return this.plugin.settings.documentTranslationLinks.find(item => (
			item.sourcePath === sourcePath
			&& item.targetLanguage === targetLanguage
		)) ?? null;
	}

	findLinkByTranslatedPath(translatedPath: string): DocumentTranslationLinkSettingEntry | null {
		return this.plugin.settings.documentTranslationLinks.find(item => item.translatedPath === translatedPath) ?? null;
	}

	private findLinkedFileFromSettings(sourceFile: TFile): TFile | null {
		const link = this.findLinkForSource(sourceFile.path);
		if (!link) {
			return null;
		}

		const file = getTFileByPath(this.plugin.app.vault, link.translatedPath);
		if (file) {
			return file;
		}

		void this.removeLink(link.sourcePath, link.translatedPath, link.targetLanguage);
		return null;
	}

	private async upsertLink(link: DocumentTranslationLinkSettingEntry): Promise<void> {
		const links = this.plugin.settings.documentTranslationLinks
			.filter(item => !(item.sourcePath === link.sourcePath && item.targetLanguage === link.targetLanguage));
		links.push(link);
		this.plugin.settings.documentTranslationLinks = links;
		await this.plugin.saveSettings();
	}

	private async removeLink(sourcePath: string, translatedPath: string, targetLanguage: string): Promise<void> {
		this.plugin.settings.documentTranslationLinks = this.plugin.settings.documentTranslationLinks
			.filter(item => !(item.sourcePath === sourcePath
				&& item.translatedPath === translatedPath
				&& item.targetLanguage === targetLanguage));
		await this.plugin.saveSettings();
	}

	private getCandidateTranslatedFiles(sourceFile: TFile): TFile[] {
		const basePath = sourceFile.path.slice(0, -sourceFile.extension.length - 1);
		return this.plugin.app.vault.getMarkdownFiles()
			.filter(file => file.path.startsWith(`${basePath}.translated.`));
	}
}

function isValidLinkEntry(value: Partial<DocumentTranslationLinkSettingEntry>): value is DocumentTranslationLinkSettingEntry {
	return typeof value.sourcePath === "string"
		&& typeof value.targetLanguage === "string"
		&& typeof value.provider === "string"
		&& value.promptUseCase === "translated-file"
		&& typeof value.sourceHash === "string"
		&& typeof value.generatedBodyHash === "string"
		&& typeof value.updatedAt === "string";
}
