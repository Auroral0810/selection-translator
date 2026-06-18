import {App, Modal} from "obsidian";
import type TranslationPlugin from "../main";
import type {BooleanKey, NumberKey} from "./types";

export interface CacheSettingsHost {
	plugin: TranslationPlugin;
	subheading?(el: HTMLElement, title: string): void;
	t?(key: string, vars?: Record<string, string | number>): string;
	toggle(el: HTMLElement, name: string, desc: string, key: BooleanKey): void;
	number(el: HTMLElement, name: string, desc: string, key: NumberKey, min: number, max: number, step?: number): void;
	button(el: HTMLElement, name: string, desc: string, label: string, callback: (button: HTMLButtonElement) => void | Promise<void>): void;
}

export function displayCacheSettings(host: CacheSettingsHost, el: HTMLElement): void {
	const translate = (key: string, vars?: Record<string, string | number>) => host.t?.(key, vars) ?? key;
	host.subheading?.(el, translate("settings.cache.heading"));
	host.toggle(el, translate("settings.cache.enable.name"), translate("settings.cache.enable.desc"), "enableCache");
	host.number(el, translate("settings.cache.limit.name"), translate("settings.cache.limit.desc"), "cacheLimit", 1, 10000);
	host.toggle(el, translate("settings.cache.autoClean.name"), translate("settings.cache.autoClean.desc"), "autoCleanCache");
	host.number(el, translate("settings.cache.maxAge.name"), translate("settings.cache.maxAge.desc"), "cacheMaxAgeDays", 0, 3650);
	host.button(el, translate("settings.cache.cleanExpired.name"), translate("settings.cache.cleanExpired.desc"), translate("common.refresh"), async () => {
		const taskId = startSettingsTask(host.plugin, translate("settings.cache.cleanExpired.name"));
		host.plugin.taskLogManager.append(taskId, `${translate("task.cacheRetentionDays", {days: host.plugin.settings.cacheMaxAgeDays})}\n`);
		host.plugin.taskLogManager.append(taskId, `${translate("task.beforeCount", {count: host.plugin.settings.translationCache.length})}\n`);
		const removed = host.plugin.translationCache.cleanExpired();
		await host.plugin.saveSettings();
		host.plugin.taskLogManager.append(taskId, `${translate("task.removedCount", {count: removed})}\n`);
		host.plugin.taskLogManager.append(taskId, `${translate("task.afterCount", {count: host.plugin.settings.translationCache.length})}\n`);
		host.plugin.taskLogManager.complete(taskId, translate("task.expiredCacheRemoved", {count: removed}));
	});
	host.button(el, translate("settings.cache.clear.name"), translate("settings.cache.clear.desc"), translate("common.reset"), async (button) => {
		const before = host.plugin.settings.translationCache.length;

		// Show confirmation dialog for destructive action
		const confirmed = await showConfirmDialog(
			host.plugin.app,
			translate("settings.cache.clear.confirmTitle"),
			translate("settings.cache.clear.confirmMessage", {count: before}),
			translate
		);

		if (!confirmed) {
			return;
		}

		button.disabled = true;
		try {
			const taskId = startSettingsTask(host.plugin, translate("settings.cache.clear.name"));
			host.plugin.taskLogManager.append(taskId, `${translate("task.beforeCount", {count: before})}\n`);
			host.plugin.translationCache.clear();
			await host.plugin.saveSettings();
			host.plugin.taskLogManager.append(taskId, `${translate("task.cacheClearedDetail")}\n`);
			host.plugin.taskLogManager.complete(taskId, translate("task.cacheCleared", {count: before}));
		} finally {
			button.disabled = false;
		}
	});
}

function startSettingsTask(plugin: TranslationPlugin, title: string): string {
	return plugin.taskLogManager.startTask(title);
}

async function showConfirmDialog(app: App, title: string, message: string, translate: (key: string, vars?: Record<string, string | number>) => string): Promise<boolean> {
	return new Promise((resolve) => {
		const modal = new ConfirmModal(app, title, message, translate, (result) => {
			resolve(result);
		});
		modal.open();
	});
}

class ConfirmModal extends Modal {
	constructor(
		app: App,
		private title: string,
		private message: string,
		private translate: (key: string, vars?: Record<string, string | number>) => string,
		private onResult: (result: boolean) => void
	) {
		super(app);
	}

	onOpen() {
		const {contentEl} = this;
		contentEl.empty();

		contentEl.createEl("h2", {text: this.title});
		contentEl.createEl("p", {text: this.message});

		const buttonContainer = contentEl.createDiv({
			cls: "modal-button-container",
		});

		buttonContainer.createEl("button", {
			text: this.translate("common.cancel"),
			cls: "mod-cancel",
		}).addEventListener("click", () => {
			this.onResult(false);
			this.close();
		});

		buttonContainer.createEl("button", {
			text: this.translate("common.confirm"),
			cls: "mod-warning",
		}).addEventListener("click", () => {
			this.onResult(true);
			this.close();
		});
	}

	onClose() {
		const {contentEl} = this;
		contentEl.empty();
	}
}
