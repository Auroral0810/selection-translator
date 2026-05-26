import {TranslationError, requireSetting} from "../errors";
import {requestJson} from "../http";
import type {ProviderModelInfo, TranslationProviderAdapter} from "../types";
import {ChatCompletionResponse, createUserPrompt, getProviderConfig, getSystemPrompt} from "./shared";

interface OllamaTagsResponse {
	models?: Array<{
		name?: string;
		model?: string;
		details?: {
			parameter_size?: string;
			quantization_level?: string;
		};
	}>;
}

export function createOllamaAdapter(): TranslationProviderAdapter {
	return {
		id: "ollama",
		label: "Ollama",
		kind: "llm",
		async translate(request) {
			const config = getProviderConfig(request);
			const baseUrl = requireSetting(config.baseUrl, "Ollama base URL").replace(/\/+$/, "");
			const model = requireSetting(config.model, "Ollama model");
			const result = await requestJson<ChatCompletionResponse>({
				url: `${baseUrl}/v1/chat/completions`,
				method: "POST",
				timeoutMs: request.settings.requestTimeout,
				headers: {"Content-Type": "application/json"},
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
				throw new TranslationError("Ollama returned an empty translation.");
			}
			return {text, provider: "ollama", sourceLanguage: request.sourceLanguage, targetLanguage: request.targetLanguage, raw: result};
		},
		testConnection(config) {
			requireSetting(config.baseUrl, "Ollama base URL");
			requireSetting(config.model, "Ollama model");
		},
		async listModels(config, settings) {
			const baseUrl = requireSetting(config.baseUrl, "Ollama base URL").replace(/\/+$/, "");
			const result = await requestJson<OllamaTagsResponse>({
				url: `${baseUrl}/api/tags`,
				method: "GET",
				timeoutMs: settings.requestTimeout,
			});
			return normalizeOllamaModels(result);
		},
	};
}

function normalizeOllamaModels(result: OllamaTagsResponse): ProviderModelInfo[] {
	return (result.models ?? [])
		.map(model => {
			const details = [model.details?.parameter_size, model.details?.quantization_level].filter(Boolean).join(" · ");
			return {
				id: String(model.name ?? model.model ?? "").trim(),
				name: model.model,
				description: details || undefined,
			};
		})
		.filter(model => model.id.length > 0)
		.sort((a, b) => a.id.localeCompare(b.id));
}
