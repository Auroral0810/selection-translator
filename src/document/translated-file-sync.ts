import {Editor, MarkdownFileInfo, MarkdownView, Notice, TFile} from "obsidian";
import {t} from "../i18n";
import type TranslationPlugin from "../main";
import {formatTranslationError} from "../translation/errors";
import {
	MarkdownTranslationBlock,
	parseMarkdownTranslationBlocks,
	renderTranslatedMarkdown,
	restoreProtectedTokens,
} from "../markdown/markdown-ast";
import {TranslatedFileSyncStore} from "./translated-file-sync-store";
import {getTFileByPath} from "../vault/files";

interface TranslatedFileSession {
	sourcePath: string;
	translatedPath: string;
	targetLanguage: string;
	generation: number;
	pendingTimer: number | null;
	translations: Map<string, string>;
	refreshing: boolean;
	queuedRefresh: boolean;
}

const REFRESH_DEBOUNCE_MS = 1500;

export class TranslatedFileSyncService {
	private readonly sessions = new Map<string, TranslatedFileSession>();
	private readonly writingPaths = new Set<string>();
	private readonly compositionPendingPaths = new Set<string>();
	private isComposing = false;

	constructor(
		private readonly plugin: TranslationPlugin,
		private readonly syncStore: TranslatedFileSyncStore,
	) {}

	register(): void {
		this.plugin.registerDomEvent(this.plugin.app.workspace.containerEl, "compositionstart", () => {
			this.isComposing = true;
		});

		this.plugin.registerDomEvent(this.plugin.app.workspace.containerEl, "compositionend", () => {
			this.isComposing = false;
			const activeFile = this.plugin.app.workspace.getActiveFile();
			if (activeFile?.extension === "md") {
				this.compositionPendingPaths.add(activeFile.path);
			}
			this.flushCompositionPendingRefreshes();
		});

		this.plugin.registerEvent(this.plugin.app.workspace.on("editor-change", (_editor: Editor, info: MarkdownView | MarkdownFileInfo) => {
			const file = info.file;
			if (file) {
				this.scheduleRefreshAfterInput(file.path);
			}
		}));

		this.plugin.registerEvent(this.plugin.app.vault.on("modify", file => {
			if (file instanceof TFile && file.extension === "md" && !this.writingPaths.has(file.path)) {
				this.scheduleRefreshAfterInput(file.path);
			}
		}));
	}

	async createOrRefreshTranslatedFile(sourceFile: TFile): Promise<TFile> {
		const translatedFile = await this.getOrCreateTranslatedFile(sourceFile);
		this.start(sourceFile, translatedFile);
		await this.refresh(sourceFile);
		return translatedFile;
	}

	start(sourceFile: TFile, translatedFile: TFile): void {
		const existing = this.sessions.get(sourceFile.path);
		if (existing) {
			this.clearSessionTimer(existing);
			existing.translatedPath = translatedFile.path;
			existing.targetLanguage = this.plugin.settings.targetLanguage;
			return;
		}

		this.sessions.set(sourceFile.path, {
			sourcePath: sourceFile.path,
			translatedPath: translatedFile.path,
			targetLanguage: this.plugin.settings.targetLanguage,
			generation: 0,
			pendingTimer: null,
			translations: new Map(),
			refreshing: false,
			queuedRefresh: false,
		});
	}

	isActive(sourcePath: string): boolean {
		return this.sessions.has(sourcePath);
	}

	getTranslatedPath(sourcePath: string): string | null {
		return this.sessions.get(sourcePath)?.translatedPath ?? null;
	}

	stop(sourcePath: string): void {
		const session = this.sessions.get(sourcePath);
		if (!session) {
			return;
		}
		this.clearSessionTimer(session);
		this.sessions.delete(sourcePath);
	}

	stopAll(): void {
		for (const session of this.sessions.values()) {
			this.clearSessionTimer(session);
		}
		this.sessions.clear();
		this.writingPaths.clear();
	}

	async refresh(sourceFile: TFile): Promise<void> {
		const session = this.sessions.get(sourceFile.path);
		if (!session) {
			return;
		}

		if (session.refreshing) {
			session.queuedRefresh = true;
			return;
		}

		session.refreshing = true;
		session.queuedRefresh = false;
		const generation = ++session.generation;

		try {
			const sourceMarkdown = await this.plugin.app.vault.read(sourceFile);
			const blocks = parseMarkdownTranslationBlocks(sourceMarkdown);
			if (blocks.length === 0) {
				throw new Error("No translatable Markdown blocks found.");
			}

			const replacements = await Promise.all(blocks.map(async block => ({
				block,
				translatedText: await this.translateBlock(block, session),
			})));

			if (session.generation !== generation) {
				return;
			}

			const translatedBody = renderTranslatedMarkdown(sourceMarkdown, replacements);
			const didWrite = await this.writeTranslatedFile(session, sourceMarkdown, translatedBody);
			if (didWrite) {
				new Notice(t(this.plugin, "document.updated"), 5000);
			}
		} catch (error) {
			console.error("Failed to refresh translated file", error);
			new Notice(t(this.plugin, "document.updateFailed", {error: formatTranslationError(error)}), 8000);
		} finally {
			session.refreshing = false;
			if (session.queuedRefresh) {
				this.scheduleRefresh(session.sourcePath, 0);
			}
		}
	}

	private async translateBlock(block: MarkdownTranslationBlock, session: TranslatedFileSession): Promise<string> {
		const key = this.makeSessionTranslationKey(block);
		const existing = session.translations.get(key);
		if (existing !== undefined) {
			return existing;
		}

		try {
			const request = {
				text: block.translationText,
				sourceLanguage: this.plugin.settings.sourceLanguage,
				targetLanguage: this.plugin.settings.targetLanguage,
				settings: this.plugin.settings,
				promptContext: {
					fileTitle: this.getSourceFileTitle(session.sourcePath),
					heading: block.headingPath.join(" > "),
				},
			};
			const requestWithPrompt = {
				...request,
				builtPrompt: this.plugin.promptService.buildForUseCase(request, "translated-file"),
			};
			const result = await this.plugin.translateService.translateWithCache(requestWithPrompt, {
				cacheScope: "translated-file",
			});
			const translatedText = restoreProtectedTokens(result.text, block.protectedTokens);
			session.translations.set(key, translatedText);
			return translatedText;
		} catch (error) {
			console.error("Failed to translate Markdown block", error);
			const fallback = `[Translation failed: ${formatTranslationError(error)}]`;
			session.translations.set(key, fallback);
			return fallback;
		}
	}

	private scheduleRefresh(sourcePath: string, delay = REFRESH_DEBOUNCE_MS): void {
		const session = this.sessions.get(sourcePath);
		if (!session) {
			return;
		}

		this.clearSessionTimer(session);
		session.pendingTimer = window.setTimeout(() => {
			session.pendingTimer = null;
			const sourceFile = getTFileByPath(this.plugin.app.vault, sourcePath);
			if (sourceFile) {
				void this.refresh(sourceFile);
			} else {
				this.stop(sourcePath);
			}
		}, delay);
	}

	private scheduleRefreshAfterInput(sourcePath: string): void {
		if (this.isComposing) {
			this.compositionPendingPaths.add(sourcePath);
			return;
		}

		this.scheduleRefresh(sourcePath);
	}

	private flushCompositionPendingRefreshes(): void {
		const paths = [...this.compositionPendingPaths];
		this.compositionPendingPaths.clear();
		for (const sourcePath of paths) {
			this.scheduleRefresh(sourcePath);
		}
	}

	private async getOrCreateTranslatedFile(sourceFile: TFile): Promise<TFile> {
		const existingSession = this.sessions.get(sourceFile.path);
		if (existingSession && existingSession.targetLanguage !== this.plugin.settings.targetLanguage) {
			this.stop(sourceFile.path);
		}

		const currentSession = this.sessions.get(sourceFile.path);
		const existingSessionFile = currentSession ? getTFileByPath(this.plugin.app.vault, currentSession.translatedPath) : null;
		if (existingSessionFile) {
			return existingSessionFile;
		}

		const linkedFile = await this.syncStore.findLinkedTranslatedFile(sourceFile);
		if (linkedFile) {
			return linkedFile;
		}

		const defaultPath = this.getDefaultTranslatedPath(sourceFile);
		const defaultFile = getTFileByPath(this.plugin.app.vault, defaultPath);
		if (defaultFile) {
			return defaultFile;
		}

		const path = this.getAvailableTranslatedPath(sourceFile);
		return this.plugin.app.vault.create(path, "");
	}

	private getDefaultTranslatedPath(sourceFile: TFile): string {
		const basePath = sourceFile.path.slice(0, -sourceFile.extension.length - 1);
		return `${basePath}.translated.${this.plugin.settings.targetLanguage}.md`;
	}

	private getAvailableTranslatedPath(sourceFile: TFile): string {
		const basePath = sourceFile.path.slice(0, -sourceFile.extension.length - 1);
		const suffix = `.translated.${this.plugin.settings.targetLanguage}`;
		let path = this.getDefaultTranslatedPath(sourceFile);
		let counter = 2;

		while (getTFileByPath(this.plugin.app.vault, path)) {
			path = `${basePath}${suffix}.${counter}.md`;
			counter++;
		}

		return path;
	}

	private async writeTranslatedFile(
		session: TranslatedFileSession,
		sourceMarkdown: string,
		translatedBody: string,
	): Promise<boolean> {
		const translatedFile = getTFileByPath(this.plugin.app.vault, session.translatedPath);
		if (!translatedFile) {
			this.stop(session.sourcePath);
			throw new Error("Translated file no longer exists.");
		}

		this.writingPaths.add(translatedFile.path);
		try {
			await this.plugin.app.vault.modify(translatedFile, translatedBody);
			await this.syncStore.recordGeneratedFile(sourceMarkdown, translatedBody, session.sourcePath, translatedFile.path);
			return true;
		} finally {
			window.setTimeout(() => this.writingPaths.delete(translatedFile.path), 250);
		}
	}

	private clearSessionTimer(session: TranslatedFileSession): void {
		if (session.pendingTimer !== null) {
			window.clearTimeout(session.pendingTimer);
			session.pendingTimer = null;
		}
	}

	private getSourceFileTitle(sourcePath: string): string {
		const file = getTFileByPath(this.plugin.app.vault, sourcePath);
		return file?.basename ?? sourcePath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
	}

	private makeSessionTranslationKey(block: MarkdownTranslationBlock): string {
		const config = this.plugin.settings.currentProviderConfig;
		return [
			this.plugin.settings.currentProvider,
			this.plugin.settings.sourceLanguage,
			this.plugin.settings.targetLanguage,
			config.baseUrl,
			config.model,
			config.temperature,
			block.id,
		].join("\u001f");
	}
}
