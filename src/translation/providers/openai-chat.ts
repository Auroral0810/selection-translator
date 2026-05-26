import {TranslationError, requireSetting} from "../errors";
import {requestJson} from "../http";
import type {ProviderModelInfo, TranslationProviderAdapter, TranslationProviderId} from "../types";
import {ChatCompletionResponse, createUserPrompt, getProviderConfig, getSystemPrompt} from "./shared";

interface OpenAIModelsResponse {
	data?: Array<{
		id?: string;
		name?: string;
		description?: string;
	}>;
}

export function createOpenAIChatAdapter(id: TranslationProviderId, label: string): TranslationProviderAdapter {
	return {
		id,
		label,
		kind: "llm",
		async translate(request) {
			const config = getProviderConfig(request);
			const apiKey = requireSetting(config.apiKey, `${label} API key`);
			const baseUrl = requireSetting(config.baseUrl, `${label} base URL`).replace(/\/+$/, "");
			const model = requireSetting(config.model, `${label} model`);

			const result = await requestJson<ChatCompletionResponse>({
				url: `${baseUrl}/chat/completions`,
				method: "POST",
				timeoutMs: request.settings.requestTimeout,
				headers: {
					"Authorization": `Bearer ${apiKey}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					model,
					temperature: config.temperature,
					messages: [
						{role: "system", content: getSystemPrompt(request)},
						{role: "user", content: createUserPrompt(request)},
					],
				}),
			});

			const text = result.choices?.[0]?.message?.content?.trim() ?? "";
			if (!text) {
				throw new TranslationError(`${label} returned an empty translation.`);
			}

			return {
				text,
				provider: id,
				sourceLanguage: request.sourceLanguage,
				targetLanguage: request.targetLanguage,
				raw: result,
			};
		},
		testConnection(config) {
			requireSetting(config.apiKey, `${label} API key`);
			requireSetting(config.baseUrl, `${label} base URL`);
			requireSetting(config.model, `${label} model`);
		},
		async listModels(config, settings) {
			const apiKey = requireSetting(config.apiKey, `${label} API key`);
			const baseUrl = requireSetting(config.baseUrl, `${label} base URL`).replace(/\/+$/, "");
			const result = await requestJson<OpenAIModelsResponse>({
				url: `${baseUrl}/models`,
				method: "GET",
				timeoutMs: settings.requestTimeout,
				headers: {
					"Authorization": `Bearer ${apiKey}`,
				},
			});
			return normalizeOpenAIModels(result);
		},
	};
}

function normalizeOpenAIModels(result: OpenAIModelsResponse): ProviderModelInfo[] {
	const models = (result.data ?? [])
		.map(item => ({
			id: String(item.id ?? "").replace(/^models\//, "").trim(),
			name: item.name,
			description: item.description,
		}))
		.filter(item => item.id.length > 0);
	return sortModelsById(dedupeModels(models));
}

function dedupeModels(models: ProviderModelInfo[]): ProviderModelInfo[] {
	const seen = new Set<string>();
	const result: ProviderModelInfo[] = [];
	for (const model of models) {
		if (seen.has(model.id)) {
			continue;
		}
		seen.add(model.id);
		result.push(model);
	}
	return result;
}

function sortModelsById(models: ProviderModelInfo[]): ProviderModelInfo[] {
	return [...models].sort((a, b) => a.id.localeCompare(b.id));
}
