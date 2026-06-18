import {MarkdownView, TFile, WorkspaceLeaf} from "obsidian";
import type TranslationPlugin from "../main";
import {getTFileByPath} from "../vault/files";
import {TranslatedFileSyncService} from "./translated-file-sync";
import {TranslatedFileSyncStore} from "./translated-file-sync-store";

export interface DocumentTranslationService {
	openSideBySide(sourceFile: TFile, targetLanguage?: string): Promise<TFile>;
	toggleSideBySide(sourceFile: TFile, targetLanguage?: string): Promise<"opened" | "closed">;
	translateFile(sourceFile: TFile, targetLanguage?: string): Promise<TFile>;
	refresh(sourceFile: TFile, targetLanguage?: string): Promise<void>;
	isActive(sourcePath: string, targetLanguage?: string): boolean;
	isAnyActive(sourcePath: string): boolean;
	getSourceFileForPath(path: string): TFile | null;
	getTargetLanguageForPath(path: string): string | null;
	closeSideBySide(sourcePath: string, targetLanguage?: string): void;
	stop(sourcePath: string, targetLanguage?: string): void;
	stopAll(): void;
	findLinkedTranslatedFile(sourceFile: TFile, targetLanguage?: string): Promise<TFile | null>;
	isTranslationCurrent(sourceFile: TFile, targetLanguage?: string): Promise<boolean>;
	register(): void;
}

export class DefaultDocumentTranslationService implements DocumentTranslationService {
	private readonly syncStore: TranslatedFileSyncStore;
	private readonly syncService: TranslatedFileSyncService;

	constructor(private readonly plugin: TranslationPlugin) {
		this.syncStore = new TranslatedFileSyncStore(plugin);
		this.syncService = new TranslatedFileSyncService(plugin, this.syncStore);
	}

	register(): void {
		this.syncService.register();
		void this.syncStore.removeMissingLinks();
		this.plugin.app.workspace.onLayoutReady(() => {
			void this.restoreOpenSideBySideSessions();
		});
	}

	async openSideBySide(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): Promise<TFile> {
		this.plugin.immersiveManager.disableFile(sourceFile.path);
		const translatedFile = await this.translateFile(sourceFile, targetLanguage);
		await this.ensureSourceLeaf(sourceFile);
		const translatedLeaf = this.findOpenLeaf(translatedFile.path) ?? this.plugin.app.workspace.getLeaf("split", "vertical");
		await translatedLeaf.openFile(translatedFile, {
			active: false,
			state: {mode: "preview"},
		});
		return translatedFile;
	}

	async toggleSideBySide(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): Promise<"opened" | "closed"> {
		if (this.syncService.isActive(sourceFile.path, targetLanguage)) {
			this.closeSideBySide(sourceFile.path, targetLanguage);
			return "closed";
		}

		await this.openSideBySide(sourceFile, targetLanguage);
		return "opened";
	}

	async translateFile(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): Promise<TFile> {
		return this.syncService.createOrRefreshTranslatedFile(sourceFile, targetLanguage);
	}

	async refresh(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): Promise<void> {
		await this.syncService.ensureSession(sourceFile, targetLanguage);
		await this.syncService.refreshExisting(sourceFile, targetLanguage);
	}

	isActive(sourcePath: string, targetLanguage = this.plugin.settings.targetLanguage): boolean {
		if (this.syncService.isActive(sourcePath, targetLanguage)) {
			return true;
		}
		const link = this.syncStore.findLinkByTranslatedPath(sourcePath);
		return !!link && this.syncService.isActive(link.sourcePath, link.targetLanguage);
	}

	isAnyActive(sourcePath: string): boolean {
		if (this.syncService.isAnyActive(sourcePath)) {
			return true;
		}
		const link = this.syncStore.findLinkByTranslatedPath(sourcePath);
		return !!link && this.syncService.isAnyActive(link.sourcePath);
	}

	getSourceFileForPath(path: string): TFile | null {
		const link = this.syncStore.findLinkByTranslatedPath(path);
		return link ? getTFileByPath(this.plugin.app.vault, link.sourcePath) : null;
	}

	getTargetLanguageForPath(path: string): string | null {
		return this.syncStore.findLinkByTranslatedPath(path)?.targetLanguage ?? null;
	}

	closeSideBySide(sourcePath: string, targetLanguage = this.plugin.settings.targetLanguage): void {
		const translatedPath = this.syncService.getTranslatedPath(sourcePath, targetLanguage) ?? this.syncStore.findLinkForSource(sourcePath, targetLanguage)?.translatedPath ?? null;
		this.syncService.stop(sourcePath, targetLanguage);
		if (!translatedPath) {
			return;
		}

		const translatedLeaf = this.findOpenLeaf(translatedPath);
		translatedLeaf?.detach();
	}

	stop(sourcePath: string, targetLanguage = this.plugin.settings.targetLanguage): void {
		this.syncService.stop(sourcePath, targetLanguage);
	}

	stopAll(): void {
		this.syncService.stopAll();
	}

	findLinkedTranslatedFile(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): Promise<TFile | null> {
		return this.syncStore.findLinkedTranslatedFile(sourceFile, targetLanguage);
	}

	isTranslationCurrent(sourceFile: TFile, targetLanguage = this.plugin.settings.targetLanguage): Promise<boolean> {
		return this.syncStore.isLinkedTranslationCurrent(sourceFile, targetLanguage);
	}

	private async restoreOpenSideBySideSessions(): Promise<void> {
		const openMarkdown = this.getOpenMarkdownFiles();
		const openByPath = new Map(openMarkdown.map(item => [item.file.path, item]));

		for (const source of openMarkdown) {
			for (const link of this.syncStore.findLinksForSource(source.file.path)) {
				const translated = openByPath.get(link.translatedPath);
				if (!translated) {
					continue;
				}

				this.syncService.start(source.file, translated.file, link.targetLanguage);
				await this.syncService.refreshExisting(source.file, link.targetLanguage);
			}
		}
	}

	private getOpenMarkdownFiles(): Array<{file: TFile; leaf: WorkspaceLeaf}> {
		return this.plugin.app.workspace.getLeavesOfType("markdown")
			.flatMap(leaf => {
				const view = leaf.view;
				if (!(view instanceof MarkdownView) || !view.file) {
					return [];
				}
				return [{file: view.file, leaf}];
			});
	}

	private findOpenLeaf(path: string): WorkspaceLeaf | null {
		for (const leaf of this.plugin.app.workspace.getLeavesOfType("markdown")) {
			const view = leaf.view;
			if (view instanceof MarkdownView && view.file?.path === path) {
				return leaf;
			}
		}
		return null;
	}

	private async ensureSourceLeaf(sourceFile: TFile): Promise<WorkspaceLeaf | null> {
		const sourceLeaf = this.findOpenLeaf(sourceFile.path) ?? this.plugin.app.workspace.getLeaf(false);
		if (!sourceLeaf) {
			return null;
		}

		const view = sourceLeaf.view;
		if (!(view instanceof MarkdownView) || view.file?.path !== sourceFile.path) {
			await sourceLeaf.openFile(sourceFile, {
				active: false,
				state: {mode: "preview"},
			});
		}
		return sourceLeaf;
	}
}
