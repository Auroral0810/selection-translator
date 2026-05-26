import type TranslationPlugin from "../main";
import {PROVIDER_KINDS} from "./provider-config";
import {sha256Hex} from "./hash";
import {TranslateRequest} from "./types";

export interface TranslationCacheEntry {
	key: string;
	text: string;
	createdAt: number;
}

export interface TranslationCacheStats {
	entries: number;
}

export interface TranslateWithCacheOptions {
	bypassCache?: boolean;
	cacheScope?: string;
}

export class TranslationCache {
	private readonly entries = new Map<string, TranslationCacheEntry>();
	private saveTimer: number | null = null;

	constructor(private readonly plugin: TranslationPlugin) {
		for (const entry of plugin.settings.translationCache ?? []) {
			this.entries.set(entry.key, entry);
		}
		this.trim();
	}

	async makeKey(request: TranslateRequest, options: {cacheScope?: string} = {}): Promise<string> {
		const settings = request.settings;
		const providerConfig = request.providerConfig ?? settings.currentProviderConfig;
		const prompt = PROVIDER_KINDS[settings.currentProvider] === "llm" ? request.builtPrompt ?? null : null;
		const providerFingerprint = settings.cacheByProvider ? await this.makeProviderFingerprint(settings.currentProvider, providerConfig) : "";
		const parts = [
			settings.reuseSameTextCache ? "shared" : options.cacheScope ?? "general",
			request.text.trim(),
			request.sourceLanguage,
			settings.cacheByTargetLanguage ? request.targetLanguage : "",
			providerFingerprint,
			prompt ? [prompt.systemPrompt, prompt.userPrompt].join("\n---prompt---\n") : "",
		];
		return sha256Hex(parts.join("\n---selection-translator-cache---\n"));
	}

	get(key: string): string | null {
		return this.entries.get(key)?.text ?? null;
	}

	getStats(): TranslationCacheStats {
		return {
			entries: this.entries.size,
		};
	}

	put(key: string, text: string): void {
		if (!this.plugin.settings.enableCache) {
			return;
		}

		this.entries.set(key, {key, text, createdAt: Date.now()});
		this.trim();
		this.scheduleSave();
	}

	delete(key: string): void {
		if (!this.entries.delete(key)) {
			return;
		}

		this.scheduleSave();
	}

	clear(): void {
		this.entries.clear();
		this.plugin.settings.translationCache = [];
		this.scheduleSave();
	}

	cleanExpired(): number {
		const maxAgeDays = Number(this.plugin.settings.cacheMaxAgeDays);
		if (!this.plugin.settings.autoCleanCache || !Number.isFinite(maxAgeDays) || maxAgeDays <= 0) {
			return 0;
		}

		const threshold = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
		let removed = 0;
		for (const entry of Array.from(this.entries.values())) {
			if (entry.createdAt < threshold) {
				this.entries.delete(entry.key);
				removed++;
			}
		}
		if (removed > 0) {
			this.plugin.settings.translationCache = Array.from(this.entries.values());
			this.scheduleSave();
		}
		return removed;
	}

	close(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
			this.saveTimer = null;
		}
		this.plugin.settings.translationCache = Array.from(this.entries.values());
		void this.plugin.saveSettings();
	}

	private trim(): void {
		const limit = Math.max(1, this.plugin.settings.cacheLimit);
		if (this.entries.size <= limit) {
			return;
		}

		const sorted = Array.from(this.entries.values()).sort((a, b) => a.createdAt - b.createdAt);
		for (const entry of sorted.slice(0, this.entries.size - limit)) {
			this.entries.delete(entry.key);
		}
	}

	private scheduleSave(): void {
		if (this.saveTimer !== null) {
			window.clearTimeout(this.saveTimer);
		}

		this.saveTimer = window.setTimeout(() => {
			this.saveTimer = null;
			this.plugin.settings.translationCache = Array.from(this.entries.values());
			void this.plugin.saveSettings();
		}, 700);
	}

	private async makeProviderFingerprint(provider: string, config: TranslateRequest["providerConfig"]): Promise<string> {
		if (!config) {
			return provider;
		}

		const sensitiveHash = await sha256Hex([
			config.apiKey,
			config.appId,
			config.appSecret,
			config.accessKeyId,
		].join("\n---secret---\n"));

		return [
			provider,
			config.baseUrl,
			config.model,
			String(config.temperature),
			config.region,
			config.apiType,
			sensitiveHash,
		].join("\n---provider---\n");
	}
}
