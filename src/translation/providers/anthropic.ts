import {TranslationError, requireSetting} from "../errors";
import {requestJson} from "../http";
import type {ProviderModelInfo, TranslationProviderAdapter} from "../types";
import {createUserPrompt, getProviderConfig, getSystemPrompt} from "./shared";

interface AnthropicResponse {
	content?: Array<{
		type?: string;
		text?: string;
	}>;
}

interface AnthropicModelsResponse {
	data?: Array<{
		id?: string;
		display_name?: string;
	}>;
}

export function createAnthropicAdapter(): TranslationProviderAdapter {
	return {
		id: "anthropic",
		label: "Claude",
		kind: "llm",
		async translate(request) {
			const config = getProviderConfig(request);
			const apiKey = requireSetting(config.apiKey, "Claude API key");
			const baseUrl = requireSetting(config.baseUrl, "Claude base URL").replace(/\/+$/, "");
			const model = requireSetting(config.model, "Claude model");
			const result = await requestJson<AnthropicResponse>({
				url: `${baseUrl}/messages`,
				method: "POST",
				timeoutMs: request.settings.requestTimeout,
				headers: {
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model,
					max_tokens: 4096,
					temperature: config.temperature,
					system: getSystemPrompt(request),
					messages: [{role: "user", content: createUserPrompt(request)}],
				}),
			});
			const text = result.content?.map(item => item.text ?? "").join("").trim() ?? "";
			if (!text) {
				throw new TranslationError("Claude returned an empty translation.");
			}
			return {text, provider: "anthropic", sourceLanguage: request.sourceLanguage, targetLanguage: request.targetLanguage, raw: result};
		},
		testConnection(config) {
			requireSetting(config.apiKey, "Claude API key");
			requireSetting(config.baseUrl, "Claude base URL");
			requireSetting(config.model, "Claude model");
		},
		async listModels(config, settings) {
			const apiKey = requireSetting(config.apiKey, "Claude API key");
			const baseUrl = requireSetting(config.baseUrl, "Claude base URL").replace(/\/+$/, "");
			const result = await requestJson<AnthropicModelsResponse>({
				url: `${baseUrl}/models`,
				method: "GET",
				timeoutMs: settings.requestTimeout,
				headers: {
					"x-api-key": apiKey,
					"anthropic-version": "2023-06-01",
				},
			});
			return normalizeAnthropicModels(result);
		},
	};
}

function normalizeAnthropicModels(result: AnthropicModelsResponse): ProviderModelInfo[] {
	return (result.data ?? [])
		.map(model => ({
			id: String(model.id ?? "").trim(),
			name: model.display_name,
		}))
		.filter(model => model.id.length > 0)
		.sort((a, b) => a.id.localeCompare(b.id));
}
