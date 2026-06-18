import {MarkdownPostProcessorContext, MarkdownView, Notice, setIcon} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";
import type {TranslationPromptUseCase} from "../translation/prompts";
import {collectRenderedTranslationBlocks} from "./block-collector";
import {applyImmersiveStyle} from "./styles";
import {RenderedTranslationTarget, TranslationBlock} from "./types";
import {getTFileByPath} from "../vault/files";

export class ImmersiveTranslationManager {
	private static readonly MAX_CONSECUTIVE_FAILURES = 3;

	private readonly activePaths = new Set<string>();
	private consecutiveFailureCount = 0;
	private translationPaused = false;

	constructor(private readonly plugin: TranslationPlugin) {}

	register(): void {
		this.plugin.registerMarkdownPostProcessor((el, ctx) => {
			void this.processMarkdown(el, ctx);
		});
	}

	isActive(path: string): boolean {
		return this.activePaths.has(path);
	}

	isActiveForCurrentFile(): boolean {
		const file = this.plugin.app.workspace.getActiveFile();
		return !!file && this.isActive(file.path) && this.plugin.settings.enableImmersiveTranslation;
	}

	disableFile(path: string): void {
		if (!this.activePaths.delete(path)) {
			return;
		}
		this.rerenderActiveMarkdownViews();
	}

	toggleActiveFile(): void {
		const file = this.plugin.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") {
			new Notice(t(this.plugin, "immersive.openMarkdown"));
			return;
		}

		if (this.activePaths.has(file.path)) {
			this.disableFile(file.path);
			new Notice(t(this.plugin, "immersive.disabled"));
			return;
		}

		if (this.plugin.documentTranslationService.getSourceFileForPath(file.path)) {
			new Notice(t(this.plugin, "immersive.translatedFile"));
			return;
		}

		if (this.plugin.documentTranslationService.isAnyActive(file.path)) {
			new Notice(t(this.plugin, "immersive.sideBySideActive"));
			return;
		}

		this.consecutiveFailureCount = 0;
		this.translationPaused = false;
		this.activePaths.add(file.path);
		this.plugin.settings.enableImmersiveTranslation = true;
		void this.plugin.saveSettings();
		const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
		const mode = view?.getMode?.();
		new Notice(mode === "preview" ? t(this.plugin, "immersive.enabled") : t(this.plugin, "immersive.enabledSwitch"));
		this.rerenderActiveMarkdownViews();
	}

	stopAll(): void {
		this.activePaths.clear();
		this.rerenderActiveMarkdownViews();
	}

	async translateBlock(block: TranslationBlock, options: {bypassCache?: boolean; promptUseCase?: TranslationPromptUseCase} = {}): Promise<string> {
		const request = {
			text: block.sourceText,
			sourceLanguage: this.plugin.settings.sourceLanguage,
			targetLanguage: this.plugin.settings.targetLanguage,
			settings: this.plugin.settings,
			promptContext: {
				fileTitle: this.getFileTitle(block.filePath),
				heading: block.headingPath?.join(" > ") ?? "",
			},
		};
		const requestWithPrompt = {
			...request,
			builtPrompt: this.plugin.promptService.buildForUseCase(request, options.promptUseCase ?? "immersive"),
		};
		if (this.translationPaused && !options.bypassCache) {
			throw new Error(t(this.plugin, "immersive.paused"));
		}

		const result = await this.plugin.translateService.translateWithCache(requestWithPrompt, {
			bypassCache: options.bypassCache,
			cacheScope: options.promptUseCase === "translated-file" ? "translated-file" : "immersive",
		});
		this.consecutiveFailureCount = 0;
		this.translationPaused = false;
		return result.text;
	}

	private async processMarkdown(el: HTMLElement, ctx: MarkdownPostProcessorContext): Promise<void> {
		if (!this.activePaths.has(ctx.sourcePath) || !this.plugin.settings.enableImmersiveTranslation) {
			return;
		}

		const blocks = collectRenderedTranslationBlocks(el, ctx.sourcePath, this.plugin, ctx);
		if (blocks.length === 0) {
			return;
		}

		for (const target of blocks) {
			const {block, element} = target;
			if (element.dataset.selectionTranslatorImmersive === "true") {
				continue;
			}
			element.dataset.selectionTranslatorImmersive = "true";
			this.renderPending(target);

			try {
				const translatedText = await this.translateBlock(block);
				this.renderTranslation(target, translatedText);
			} catch (error) {
				console.error("Failed to render immersive translation", error);
				this.handleTranslationFailure();
				this.renderFailure(target);
			}
		}
	}

	private renderPending(target: RenderedTranslationTarget): void {
		const wrapperEl = this.getOrCreateWrapper(target);
		wrapperEl.empty();
		wrapperEl.className = this.getWrapperClassName(target);
		wrapperEl.addClass("selection-translator-immersive-loading");
		wrapperEl.setText(t(this.plugin, "quick.translating"));
	}

	private renderTranslation(target: RenderedTranslationTarget, translatedText: string): void {
		const {element: sourceElement} = target;
		const wrapperEl = this.getOrCreateWrapper(target);

		wrapperEl.empty();
		wrapperEl.className = this.getWrapperClassName(target);
		wrapperEl.removeClass("selection-translator-immersive-loading");
		applyImmersiveStyle(wrapperEl, this.plugin.settings);

		wrapperEl.createSpan({
			cls: "selection-translator-immersive-text",
			text: translatedText,
		});
		this.renderToolbar(target, wrapperEl, translatedText);

		if (this.plugin.settings.immersiveMode === "translation-only") {
			sourceElement.addClass("selection-translator-immersive-hidden-source");
		}
		if (this.plugin.settings.immersiveMode === "hover") {
			wrapperEl.addClass("selection-translator-immersive-hover");
			sourceElement.addClass("selection-translator-immersive-hover-source");
		}
	}

	private renderFailure(target: RenderedTranslationTarget, previousText?: string): void {
		if (previousText) {
			this.renderTranslation(target, previousText);
		}

		const wrapperEl = this.getOrCreateWrapper(target);
		if (!previousText) {
			wrapperEl.empty();
			wrapperEl.className = this.getWrapperClassName(target);
			applyImmersiveStyle(wrapperEl, this.plugin.settings);
		}
		wrapperEl.addClass("selection-translator-immersive-error");

		const statusEl = wrapperEl.createSpan({
			cls: "selection-translator-immersive-status",
			text: previousText ? t(this.plugin, "immersive.refreshFailed") : t(this.plugin, "immersive.failed"),
		});
		statusEl.setAttr("aria-live", "polite");
		if (!previousText) {
			this.renderToolbar(target, wrapperEl, "");
		}
	}

	private renderToolbar(target: RenderedTranslationTarget, wrapperEl: HTMLElement, translatedText: string): void {
		const toolbarEl = wrapperEl.createDiv({cls: "selection-translator-immersive-toolbar"});

		const copyButton = toolbarEl.createEl("button", {
			cls: "selection-translator-immersive-action",
			type: "button",
			attr: {title: t(this.plugin, "panel.copyTranslation"), "aria-label": t(this.plugin, "panel.copyTranslation")},
		});
		setIcon(copyButton, "copy");
		copyButton.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			void this.copyTranslation(translatedText);
		});

		const refreshButton = toolbarEl.createEl("button", {
			cls: "selection-translator-immersive-action",
			type: "button",
			attr: {title: t(this.plugin, "immersive.refresh"), "aria-label": t(this.plugin, "immersive.refresh")},
		});
		setIcon(refreshButton, "refresh-cw");
		refreshButton.addEventListener("click", event => {
			event.preventDefault();
			event.stopPropagation();
			void this.retryBlock(target, translatedText);
		});
	}

	private async copyTranslation(translatedText: string): Promise<void> {
		if (!translatedText.trim()) {
			new Notice(t(this.plugin, "immersive.copyEmpty"));
			return;
		}

		try {
			await navigator.clipboard.writeText(translatedText);
			new Notice(t(this.plugin, "immersive.copySuccess"));
		} catch {
			new Notice(t(this.plugin, "immersive.copyFailure"));
		}
	}

	private async retryBlock(target: RenderedTranslationTarget, previousText: string): Promise<void> {
		this.translationPaused = false;
		this.renderPending(target);

		try {
			const translatedText = await this.translateBlock(target.block, {bypassCache: true});
			this.renderTranslation(target, translatedText);
		} catch (error) {
			console.error("Failed to refresh immersive translation", error);
			this.handleTranslationFailure();
			this.renderFailure(target, previousText);
		}
	}

	private handleTranslationFailure(): void {
		this.consecutiveFailureCount++;
		if (this.consecutiveFailureCount < ImmersiveTranslationManager.MAX_CONSECUTIVE_FAILURES || this.translationPaused) {
			return;
		}

		this.translationPaused = true;
		new Notice(t(this.plugin, "immersive.paused"));
	}

	private getOrCreateWrapper(target: RenderedTranslationTarget): HTMLElement {
		const {element} = target;
		const existing = this.findExistingWrapper(target);
		if (existing) {
			return existing;
		}

		const wrapperEl = element.ownerDocument.createElement("div");
		if (target.placement === "inside") {
			const nestedList = Array.from(element.children).find(child => child.matches("ul, ol"));
			element.insertBefore(wrapperEl, nestedList ?? null);
		} else {
			element.parentElement?.insertBefore(wrapperEl, element.nextSibling);
		}

		return wrapperEl;
	}

	private findExistingWrapper(target: RenderedTranslationTarget): HTMLElement | null {
		const {element} = target;
		if (target.placement === "inside") {
			return Array.from(element.children).find(child => child.instanceOf(HTMLElement) && child.hasClass("selection-translator-immersive")) as HTMLElement | undefined ?? null;
		}

		return element.nextElementSibling?.instanceOf(HTMLElement) && element.nextElementSibling.hasClass("selection-translator-immersive")
			? element.nextElementSibling
			: null;
	}

	private getWrapperClassName(target: RenderedTranslationTarget): string {
		return target.compact
			? "selection-translator-immersive selection-translator-immersive-compact"
			: "selection-translator-immersive";
	}

	private getFileTitle(filePath?: string): string {
		if (!filePath) {
			return "";
		}
		const file = getTFileByPath(this.plugin.app.vault, filePath);
		return file?.basename ?? filePath.split("/").pop()?.replace(/\.md$/i, "") ?? "";
	}

	refreshActiveViews(): void {
		if (this.activePaths.size === 0) {
			return;
		}
		this.rerenderActiveMarkdownViews();
	}

	private rerenderActiveMarkdownViews(): void {
		this.plugin.app.workspace.iterateAllLeaves(leaf => {
			const view = leaf.view;
			if (view instanceof MarkdownView) {
				view.previewMode.rerender(true);
			}
		});
	}
}
