import type TranslationPlugin from "../main";
import {TranslationError} from "./errors";
import {isFatalQueueError} from "./request-queue-service";
import {getCurrentProviderConfig} from "./provider-config";
import type {PromptService} from "./prompt-service";
import {getAdapter} from "./providers";
import type {ProviderModelInfo, TranslateRequest, TranslateResult} from "./types";
import type {TranslateWithCacheOptions} from "./cache";

export interface TranslateService {
	/** Raw provider call. It does not use the translation cache or request queue. */
	translate(request: TranslateRequest): Promise<TranslateResult>;
	translateWithCache(request: TranslateRequest, options?: TranslateWithCacheOptions): Promise<TranslateResult>;
	testProvider(): Promise<void>;
	listModels(): Promise<ProviderModelInfo[]>;
}

export class DefaultTranslateService implements TranslateService {
	constructor(
		private readonly plugin: TranslationPlugin,
		private readonly promptService: PromptService,
	) {}

	async translate(request: TranslateRequest): Promise<TranslateResult> {
		return this.translateText(this.withProviderConfig(this.withBuiltPrompt(request)));
	}

	async translateWithCache(request: TranslateRequest, options: TranslateWithCacheOptions = {}): Promise<TranslateResult> {
		const preparedRequest = this.withProviderConfig(this.withBuiltPrompt(request));
		this.updateQueueOptions(preparedRequest);
		if (!this.plugin.settings.enableCache) {
			return this.plugin.requestQueueService.enqueue(
				this.makeQueueKey(preparedRequest, "uncached"),
				() => this.translateOnceWithMetrics(preparedRequest),
				this.getQueueTaskOptions(preparedRequest),
			);
		}

		const key = await this.plugin.translationCache.makeKey(preparedRequest, options);
		if (options.bypassCache) {
			this.plugin.translationCache.delete(key);
		} else {
			const cached = this.plugin.translationCache.get(key);
			if (cached !== null) {
				this.plugin.translationMetrics.recordCacheHit();
				options.onCacheHit?.();
				return {
					text: cached,
					provider: preparedRequest.settings.currentProvider,
					sourceLanguage: preparedRequest.sourceLanguage,
					targetLanguage: preparedRequest.targetLanguage,
				};
			}
		}

		// Use cache key as queue key to prevent duplicate translations of the same text
		// This ensures that multiple simultaneous requests for the same text will be deduplicated
		const queueKey = options.bypassCache ? `${key}:refresh:${Date.now()}` : key;
		return this.plugin.requestQueueService.enqueue(queueKey, async () => {
			// Double-check cache inside queue in case another request completed while waiting
			if (!options.bypassCache) {
				const cachedInsideQueue = this.plugin.translationCache.get(key);
				if (cachedInsideQueue !== null) {
					this.plugin.translationMetrics.recordCacheHit();
					options.onCacheHit?.();
					return {
						text: cachedInsideQueue,
						provider: preparedRequest.settings.currentProvider,
						sourceLanguage: preparedRequest.sourceLanguage,
						targetLanguage: preparedRequest.targetLanguage,
					};
				}
			}

			this.plugin.translationMetrics.recordCacheMiss();
			options.onCacheMiss?.();
			const result = await this.translateOnceWithMetrics(preparedRequest);
			this.plugin.translationCache.put(key, result.text);
			return result;
		}, this.getQueueTaskOptions(preparedRequest));
	}

	async testProvider(): Promise<void> {
		const provider = this.plugin.settings.currentProvider;
		await getAdapter(provider).testConnection(getCurrentProviderConfig(this.plugin.settings), this.plugin.settings);
	}

	async listModels(): Promise<ProviderModelInfo[]> {
		const provider = this.plugin.settings.currentProvider;
		const adapter = getAdapter(provider);
		if (!adapter.listModels) {
			throw new TranslationError(`${adapter.label} does not support model listing.`);
		}
		return adapter.listModels(getCurrentProviderConfig(this.plugin.settings), this.plugin.settings);
	}

	private async translateText(request: TranslateRequest): Promise<TranslateResult> {
		const attempts = Math.max(1, request.settings.maxRetries + 1);
		const provider = request.settings.currentProvider;
		const adapter = getAdapter(provider);
		let lastError: unknown;
		for (let attempt = 0; attempt < attempts; attempt++) {
			try {
				return await adapter.translate(request);
			} catch (error) {
				if (isFatalQueueError(error)) {
					throw error;
				}
				lastError = error;
			}
		}
		throw lastError;
	}

	private async translateOnce(request: TranslateRequest): Promise<TranslateResult> {
		const provider = request.settings.currentProvider;
		return getAdapter(provider).translate(request);
	}

	private async translateOnceWithMetrics(request: TranslateRequest): Promise<TranslateResult> {
		this.plugin.translationMetrics.recordRequestStart();
		try {
			const result = await this.translateOnce(request);
			this.plugin.translationMetrics.recordSuccess(result);
			return result;
		} catch (error) {
			this.plugin.translationMetrics.recordFailure();
			throw error;
		}
	}

	private updateQueueOptions(request: TranslateRequest): void {
		this.plugin.requestQueueService.updateOptions({
			rate: request.settings.immersiveQueueRate,
			capacity: request.settings.immersiveQueueCapacity,
			timeoutMs: request.settings.requestTimeout,
			maxRetries: request.settings.maxRetries,
			baseRetryDelayMs: 1000,
		});
	}

	private getQueueTaskOptions(request: TranslateRequest) {
		return {
			timeoutMs: request.settings.requestTimeout,
			maxRetries: request.settings.maxRetries,
		};
	}

	private makeQueueKey(request: TranslateRequest, scope: string): string {
		const providerConfig = request.providerConfig ?? getCurrentProviderConfig(request.settings);
		return [
			scope,
			request.settings.currentProvider,
			providerConfig.baseUrl,
			providerConfig.model,
			request.sourceLanguage,
			request.targetLanguage,
			request.text.trim(),
			request.builtPrompt?.systemPrompt ?? "",
			request.builtPrompt?.userPrompt ?? "",
		].join("\u001f");
	}

	private withProviderConfig(request: TranslateRequest): TranslateRequest {
		if (request.providerConfig) {
			return request;
		}
		return {
			...request,
			providerConfig: getCurrentProviderConfig(request.settings),
		};
	}

	private withBuiltPrompt(request: TranslateRequest): TranslateRequest {
		if (request.builtPrompt) {
			return request;
		}
		return {
			...request,
			builtPrompt: this.promptService.build(request),
		};
	}
}
