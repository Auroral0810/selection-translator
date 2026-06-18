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
const SESSION_KEY_SEPARATOR = "\u001e";

export class TranslatedFileSyncService {
	private readonly sessions = new Map<string, TranslatedFileSession>();
	private readonly writingPaths = new Set<string>();
	private readonly pendingCreations = new Map<string, Promise<TFile>>();
	private readonly writingPromises = new Map<string, Promise<void>>();
	private readonly compositionPendingPaths = new Set<string>();
	private readonly manualEditWarnedPaths = new Set<string>();
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
			if (!(file instanceof TFile) || file.extension !== "md" || this.writingPaths.has(file.path)) {
				return;
			}
			if (this.syncStore.findLinkByTranslatedPath(file.path)) {
				this.warnManualTranslatedEdit(file.path);
				return;
			}
			this.scheduleRefreshAfterInput(file.path);
		}));

		this.plugin.registerEvent(this.plugin.app.vault.on("delete", file => {
			if (file instanceof TFile) {
				void this.handleFileDeleted(file.path);
			}
		}));

		this.plugin.registerEvent(this.plugin.app.vault.on("rename", (file, oldPath) => {
			if (file instanceof TFile) {
				void this.handleFileRenamed(file.path, oldPath);
			}
		}));
	}

	private async handleFileDeleted(deletedPath: string): Promise<void> {
		// Source deleted: drop every session/link bound to it.
		for (const session of this.getSessionsForSource(deletedPath)) {
			this.stop(session.sourcePath, session.targetLanguage);
		}
		await this.syncStore.removeLinksForSource(deletedPath);

		// Translated output deleted: stop the owning session and drop its link.
		const link = this.syncStore.findLinkByTranslatedPath(deletedPath);
		if (link) {
			this.stop(link.sourcePath, link.targetLanguage);
			await this.syncStore.removeLinkByTranslatedPath(deletedPath);
		}
		this.manualEditWarnedPaths.delete(deletedPath);
	}

	private async handleFileRenamed(newPath: string, oldPath: string): Promise<void> {
		// Source renamed/moved: re-key sessions and migrate links to the new path.
		const sourceSessions = this.getSessionsForSource(oldPath);
		if (sourceSessions.length > 0) {
			this.rekeySessionsForSource(oldPath, newPath);
			await this.syncStore.renameSourceInLinks(oldPath, newPath);
		} else if (this.syncStore.findLinksForSource(oldPath).length > 0) {
			await this.syncStore.renameSourceInLinks(oldPath, newPath);
		}

		// Translated output renamed/moved: update session pointer and link path.
		const link = this.syncStore.findLinkByTranslatedPath(oldPath);
		if (link) {
			for (const session of this.sessions.values()) {
				if (session.translatedPath === oldPath) {
					session.translatedPath = newPath;
				}
			}
			await this.syncStore.renameTranslatedInLinks(oldPath, newPath);
		}
		if (this.manualEditWarnedPaths.delete(oldPath)) {
			this.manualEditWarnedPaths.add(newPath);
		}
	}

	private rekeySessionsForSource(oldSourcePath: string, newSourcePath: string): void {
		for (const session of this.getSessionsForSource(oldSourcePath)) {
			this.sessions.delete(this.makeSessionKey(oldSourcePath, session.targetLanguage));
			session.sourcePath = newSourcePath;
			this.sessions.set(this.makeSessionKey(newSourcePath, session.targetLanguage), session);
		}
	}

	private warnManualTranslatedEdit(translatedPath: string): void {
		if (this.manualEditWarnedPaths.has(translatedPath)) {
			return;
		}
		this.manualEditWarnedPaths.add(translatedPath);
		new Notice(t(this.plugin, "document.translatedManualEdit"), 8000);
	}

	async createOrRefreshTranslatedFile(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): Promise<TFile> {
		const translatedFile = await this.getOrCreateTranslatedFile(sourceFile, targetLanguage);
		this.start(sourceFile, translatedFile, targetLanguage);
		if (await this.syncStore.isLinkedTranslationCurrent(sourceFile, targetLanguage)) {
			return translatedFile;
		}
		await this.refreshExisting(sourceFile, targetLanguage);
		return translatedFile;
	}

	async ensureSession(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): Promise<TFile> {
		const translatedFile = await this.getOrCreateTranslatedFile(sourceFile, targetLanguage);
		this.start(sourceFile, translatedFile, targetLanguage);
		return translatedFile;
	}

	start(sourceFile: TFile, translatedFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): void {
		const sessionKey = this.makeSessionKey(sourceFile.path, targetLanguage);
		const existing = this.sessions.get(sessionKey);
		if (existing) {
			this.clearSessionTimer(existing);
			existing.translatedPath = translatedFile.path;
			existing.targetLanguage = targetLanguage;
			return;
		}

		this.sessions.set(sessionKey, {
			sourcePath: sourceFile.path,
			translatedPath: translatedFile.path,
			targetLanguage,
			generation: 0,
			pendingTimer: null,
			translations: new Map(),
			refreshing: false,
			queuedRefresh: false,
		});
	}

	isActive(sourcePath: string, targetLanguage = this.plugin.settings.targetLanguage): boolean {
		return this.sessions.has(this.makeSessionKey(sourcePath, targetLanguage));
	}

	isAnyActive(sourcePath: string): boolean {
		return [...this.sessions.values()].some(session => session.sourcePath === sourcePath);
	}

	getTranslatedPath(sourcePath: string, targetLanguage = this.plugin.settings.targetLanguage): string | null {
		return this.sessions.get(this.makeSessionKey(sourcePath, targetLanguage))?.translatedPath ?? null;
	}

	stop(sourcePath: string, targetLanguage = this.plugin.settings.targetLanguage): void {
		const sessionKey = this.makeSessionKey(sourcePath, targetLanguage);
		const session = this.sessions.get(sessionKey);
		if (!session) {
			return;
		}
		this.clearSessionTimer(session);
		this.sessions.delete(sessionKey);
	}

	stopAll(): void {
		for (const session of this.sessions.values()) {
			this.clearSessionTimer(session);
		}
		this.sessions.clear();
		this.writingPaths.clear();
	}

	async refresh(sourceFile: TFile): Promise<void> {
		await this.ensureSession(sourceFile);
		await this.refreshExisting(sourceFile, this.plugin.settings.targetLanguage);
	}

	async refreshExisting(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): Promise<void> {
		const session = this.sessions.get(this.makeSessionKey(sourceFile.path, targetLanguage));
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
		const cacheStats = {hits: 0, misses: 0};

		// Progress notice that will be updated
		let progressNotice: Notice | null = null;

		try {
			const sourceMarkdown = await this.plugin.app.vault.read(sourceFile);
			const blocks = parseMarkdownTranslationBlocks(sourceMarkdown);
			if (blocks.length === 0) {
				// Don't throw error, just show friendly message
				new Notice(t(this.plugin, "document.noTranslatableContent"), 5000);
				return;
			}

			// Create progress notice
			progressNotice = new Notice(
				t(this.plugin, "document.translatingProgress", {
					current: "0",
					total: String(blocks.length)
				}),
				0 // Don't auto-hide
			);

			const results = await this.translateBlocksConcurrently(blocks, session, generation, progressNotice, cacheStats);

			// Hide progress notice
			if (progressNotice) {
				progressNotice.hide();
				progressNotice = null;
			}

			if (session.generation !== generation || session.queuedRefresh) {
				return;
			}

			const replacements = blocks.map((block, index) => ({
				block,
				translatedText: results[index]?.text ?? "",
			}));
			const failedCount = results.filter(result => !result.ok).length;

			const translatedBody = stripTranslationSyncAnchors(renderTranslatedMarkdown(sourceMarkdown, replacements));
			const didWrite = await this.writeTranslatedFile(session, sourceMarkdown, translatedBody);
			if (didWrite) {
				await this.plugin.translationCache.flush();
				this.logDocumentCacheStats(sourceFile.path, targetLanguage, cacheStats, blocks.length);
				if (failedCount > 0) {
					new Notice(`⚠️ ${t(this.plugin, "document.partialFailure", {count: String(failedCount)})}`, 10000);
				} else {
					new Notice(`✅ ${t(this.plugin, "document.updated")}`, 3000);
				}
			}
		} catch (error) {
			console.error("Failed to refresh translated file", error);
			new Notice(t(this.plugin, "document.updateFailed", {error: formatTranslationError(error)}), 8000);
		} finally {
			// Ensure progress notice is hidden even on error
			if (progressNotice) {
				progressNotice.hide();
			}
			session.refreshing = false;
			if (session.queuedRefresh) {
				this.scheduleRefresh(session.sourcePath, session.targetLanguage, 0);
			}
		}
	}

	private async translateBlock(
		block: MarkdownTranslationBlock,
		session: TranslatedFileSession,
		cacheStats: {hits: number; misses: number},
	): Promise<{text: string; ok: boolean}> {
		const key = this.makeSessionTranslationKey(block, session);
		const existing = session.translations.get(key);
		if (existing !== undefined) {
			return {text: existing, ok: true};
		}

		try {
			const request = {
				text: block.translationText,
				sourceLanguage: this.plugin.settings.sourceLanguage,
				targetLanguage: session.targetLanguage,
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
				ignorePromptInCacheKey: true,
				onCacheHit: () => {
					cacheStats.hits++;
				},
				onCacheMiss: () => {
					cacheStats.misses++;
				},
			});
			const translatedText = restoreProtectedTokens(result.text, block.protectedTokens);
			session.translations.set(key, translatedText);
			return {text: translatedText, ok: true};
		} catch (error) {
			// Do NOT cache the failure: leaving it out of session.translations means
			// the next refresh retries this block instead of permanently keeping a placeholder.
			console.error("Failed to translate Markdown block", error);
			const fallback = `[Translation failed: ${formatTranslationError(error)}]`;
			return {text: fallback, ok: false};
		}
	}

	private async translateBlocksConcurrently(
		blocks: MarkdownTranslationBlock[],
		session: TranslatedFileSession,
		generation: number,
		progressNotice: Notice | null,
		cacheStats: {hits: number; misses: number},
	): Promise<Array<{text: string; ok: boolean}>> {
		const results = blocks.map(() => ({text: "", ok: false}));
		const concurrency = Math.min(blocks.length, this.getDocumentTranslationConcurrency());
		let nextIndex = 0;
		let completedCount = 0;

		const updateProgress = () => {
			progressNotice?.setMessage(
				t(this.plugin, "document.translatingProgress", {
					current: String(completedCount),
					total: String(blocks.length)
				})
			);
		};

		const worker = async () => {
			while (session.generation === generation && !session.queuedRefresh) {
				const index = nextIndex;
				nextIndex++;
				if (index >= blocks.length) {
					return;
				}

				const block = blocks[index];
				if (!block) {
					return;
				}

				results[index] = await this.translateBlock(block, session, cacheStats);
				completedCount++;
				updateProgress();
			}
		};

		await Promise.all(Array.from({length: concurrency}, () => worker()));
		return results;
	}

	private scheduleRefresh(sourcePath: string, targetLanguage: string, delay = REFRESH_DEBOUNCE_MS): void {
		const sessionKey = this.makeSessionKey(sourcePath, targetLanguage);
		const session = this.sessions.get(sessionKey);
		if (!session) {
			return;
		}

		this.clearSessionTimer(session);
		session.pendingTimer = window.setTimeout(() => {
			const currentSession = this.sessions.get(sessionKey);
			if (!currentSession) {
				return;
			}
			currentSession.pendingTimer = null;
			const sourceFile = getTFileByPath(this.plugin.app.vault, sourcePath);
			if (sourceFile) {
				void this.refreshExisting(sourceFile, targetLanguage);
			} else {
				this.stop(sourcePath, targetLanguage);
			}
		}, delay);
	}

	private scheduleRefreshAfterInput(sourcePath: string): void {
		if (this.isComposing) {
			this.compositionPendingPaths.add(sourcePath);
			return;
		}

		for (const session of this.getSessionsForSource(sourcePath)) {
			this.scheduleRefresh(sourcePath, session.targetLanguage);
		}
	}

	private flushCompositionPendingRefreshes(): void {
		const paths = [...this.compositionPendingPaths];
		this.compositionPendingPaths.clear();
		for (const sourcePath of paths) {
			for (const session of this.getSessionsForSource(sourcePath)) {
				this.scheduleRefresh(sourcePath, session.targetLanguage);
			}
		}
	}

	private getOrCreateTranslatedFile(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): Promise<TFile> {
		const key = this.makeSessionKey(sourceFile.path, targetLanguage);
		const pending = this.pendingCreations.get(key);
		if (pending) {
			return pending;
		}
		const promise = this.resolveTranslatedFile(sourceFile, targetLanguage);
		this.pendingCreations.set(key, promise);
		void promise.finally(() => this.pendingCreations.delete(key));
		return promise;
	}

	private async resolveTranslatedFile(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): Promise<TFile> {
		const currentSession = this.sessions.get(this.makeSessionKey(sourceFile.path, targetLanguage));
		const existingSessionFile = currentSession ? getTFileByPath(this.plugin.app.vault, currentSession.translatedPath) : null;
		if (existingSessionFile) {
			return existingSessionFile;
		}
		if (currentSession) {
			this.stop(sourceFile.path, targetLanguage);
		}

		const linkedFile = await this.syncStore.findLinkedTranslatedFile(sourceFile, targetLanguage);
		if (linkedFile) {
			return linkedFile;
		}

		const defaultPath = this.getDefaultTranslatedPath(sourceFile, targetLanguage);
		const defaultFile = getTFileByPath(this.plugin.app.vault, defaultPath);
		if (defaultFile) {
			return defaultFile;
		}

		const path = this.getAvailableTranslatedPath(sourceFile, targetLanguage);
		return this.plugin.app.vault.create(path, "");
	}

	private getDefaultTranslatedPath(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): string {
		const basePath = sourceFile.path.slice(0, -sourceFile.extension.length - 1);
		return `${basePath}.translated.${targetLanguage}.md`;
	}

	private getAvailableTranslatedPath(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): string {
		const basePath = sourceFile.path.slice(0, -sourceFile.extension.length - 1);
		const suffix = `.translated.${targetLanguage}`;
		let path = this.getDefaultTranslatedPath(sourceFile, targetLanguage);
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
			// The output file was deleted out from under us. Tear down the session
			// quietly instead of throwing a scary "update failed" notice; the next
			// manual translate will recreate it cleanly.
			this.stop(session.sourcePath, session.targetLanguage);
			void this.syncStore.removeLinkForSource(session.sourcePath, session.targetLanguage);
			return false;
		}

		this.writingPaths.add(translatedFile.path);
		const writePromise = (async () => {
			try {
				await this.plugin.app.vault.modify(translatedFile, translatedBody);
				await this.syncStore.recordGeneratedFile(sourceMarkdown, translatedBody, session.sourcePath, translatedFile.path, session.targetLanguage);
				this.manualEditWarnedPaths.delete(translatedFile.path);
			} finally {
				this.writingPaths.delete(translatedFile.path);
				this.writingPromises.delete(translatedFile.path);
			}
		})();
		this.writingPromises.set(translatedFile.path, writePromise);
		await writePromise;
		return true;
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

	private makeSessionTranslationKey(block: MarkdownTranslationBlock, session: TranslatedFileSession): string {
		const config = this.plugin.settings.currentProviderConfig;
		return [
			this.plugin.settings.currentProvider,
			this.plugin.settings.sourceLanguage,
			session.targetLanguage,
			config.baseUrl,
			config.model,
			config.temperature,
			block.id,
			block.translationText, // Include actual text content to detect changes
		].join("\u001f");
	}

	private makeSessionKey(sourcePath: string, targetLanguage: string): string {
		return `${sourcePath}${SESSION_KEY_SEPARATOR}${targetLanguage}`;
	}

	private getDocumentTranslationConcurrency(): number {
		const concurrency = Math.floor(this.plugin.settings.immersiveQueueCapacity);
		return Number.isFinite(concurrency) ? Math.max(1, concurrency) : 1;
	}

	private getSessionsForSource(sourcePath: string): TranslatedFileSession[] {
		return [...this.sessions.values()].filter(session => session.sourcePath === sourcePath);
	}

	private logDocumentCacheStats(
		sourcePath: string,
		targetLanguage: string,
		cacheStats: {hits: number; misses: number},
		totalBlocks: number,
	): void {
		console.debug("[Selection Translator] Document translation cache", {
			sourcePath,
			targetLanguage,
			hits: cacheStats.hits,
			misses: cacheStats.misses,
			sessionHits: Math.max(0, totalBlocks - cacheStats.hits - cacheStats.misses),
			totalBlocks,
		});
	}
}

function stripTranslationSyncAnchors(markdown: string): string {
	return markdown
		.replace(/<!--\s*selection-translator-anchor:[\s\S]*?-->\s*/g, "")
		.trimEnd();
}
