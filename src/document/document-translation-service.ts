import {MarkdownView, TFile, WorkspaceLeaf} from "obsidian";
import type TranslationPlugin from "../main";
import {getTFileByPath} from "../vault/files";
import {TranslatedFileSyncService} from "./translated-file-sync";
import {TranslatedFileSyncStore} from "./translated-file-sync-store";

export interface DocumentTranslationService {
	openSideBySide(sourceFile: TFile): Promise<TFile>;
	toggleSideBySide(sourceFile: TFile): Promise<"opened" | "closed">;
	translateFile(sourceFile: TFile): Promise<TFile>;
	refresh(sourceFile: TFile): Promise<void>;
	isActive(sourcePath: string): boolean;
	getSourceFileForPath(path: string): TFile | null;
	closeSideBySide(sourcePath: string): void;
	stop(sourcePath: string): void;
	stopAll(): void;
	findLinkedTranslatedFile(sourceFile: TFile): Promise<TFile | null>;
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
		this.plugin.app.workspace.onLayoutReady(() => {
			void this.restoreOpenSideBySideSessions();
		});
	}

	async openSideBySide(sourceFile: TFile): Promise<TFile> {
		this.plugin.immersiveManager.disableFile(sourceFile.path);
		const translatedFile = await this.translateFile(sourceFile);
		const sourceLeaf = this.plugin.app.workspace.getLeaf(false);
		const translatedLeaf = this.findOpenLeaf(translatedFile.path) ?? this.plugin.app.workspace.getLeaf("split", "vertical");
		await translatedLeaf.openFile(translatedFile, {
			active: false,
			state: {mode: "preview"},
		});
		if (sourceLeaf && this.plugin.settings.enablePercentageScrollSync) {
			this.plugin.sideBySideSyncManager.enableForLeaves(sourceLeaf, translatedLeaf);
		}
		return translatedFile;
	}

	async toggleSideBySide(sourceFile: TFile): Promise<"opened" | "closed"> {
		if (this.syncService.isActive(sourceFile.path)) {
			this.closeSideBySide(sourceFile.path);
			return "closed";
		}

		await this.openSideBySide(sourceFile);
		return "opened";
	}

	async translateFile(sourceFile: TFile): Promise<TFile> {
		return this.syncService.createOrRefreshTranslatedFile(sourceFile);
	}

	async refresh(sourceFile: TFile): Promise<void> {
		await this.syncService.refresh(sourceFile);
	}

	isActive(sourcePath: string): boolean {
		if (this.syncService.isActive(sourcePath)) {
			return true;
		}
		const link = this.syncStore.findLinkByTranslatedPath(sourcePath);
		return !!link && this.syncService.isActive(link.sourcePath);
	}

	getSourceFileForPath(path: string): TFile | null {
		const link = this.syncStore.findLinkByTranslatedPath(path);
		return link ? getTFileByPath(this.plugin.app.vault, link.sourcePath) : null;
	}

	closeSideBySide(sourcePath: string): void {
		const translatedPath = this.syncService.getTranslatedPath(sourcePath) ?? this.syncStore.findLinkForSource(sourcePath)?.translatedPath ?? null;
		this.syncService.stop(sourcePath);
		this.plugin.sideBySideSyncManager.disable();
		if (!translatedPath) {
			return;
		}

		const translatedLeaf = this.findOpenLeaf(translatedPath);
		translatedLeaf?.detach();
	}

	stop(sourcePath: string): void {
		this.syncService.stop(sourcePath);
	}

	stopAll(): void {
		this.syncService.stopAll();
	}

	findLinkedTranslatedFile(sourceFile: TFile): Promise<TFile | null> {
		return this.syncStore.findLinkedTranslatedFile(sourceFile);
	}

	private async restoreOpenSideBySideSessions(): Promise<void> {
		const openMarkdown = this.getOpenMarkdownFiles();
		const openByPath = new Map(openMarkdown.map(item => [item.file.path, item]));
		let restoredScrollSync = false;

		for (const source of openMarkdown) {
			const link = this.syncStore.findLinkForSource(source.file.path);
			if (!link) {
				continue;
			}

			const translated = openByPath.get(link.translatedPath);
			if (!translated) {
				continue;
			}

			this.syncService.start(source.file, translated.file);
			if (this.plugin.settings.enablePercentageScrollSync && !restoredScrollSync) {
				this.plugin.sideBySideSyncManager.enableForLeaves(source.leaf, translated.leaf);
				restoredScrollSync = true;
			}
			await this.syncService.refresh(source.file);
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
}
