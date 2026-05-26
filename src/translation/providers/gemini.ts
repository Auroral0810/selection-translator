import {TranslationError, requireSetting} from "../errors";
import {requestJson} from "../http";
import type {ProviderModelInfo, TranslationProviderAdapter} from "../types";
import {createUserPrompt, getProviderConfig, getSystemPrompt} from "./shared";

interface GeminiResponse {
	candidates?: Array<{
		content?: {
			parts?: Array<{
				text?: string;
			}>;
		};
	}>;
}

interface GeminiModelsResponse {
	models?: Array<{
		name?: string;
		displayName?: string;
		description?: string;
		supportedGenerationMethods?: string[];
	}>;
}

export function createGeminiAdapter(): TranslationProviderAdapter {
	return {
		id: "gemini",
		label: "Gemini",
		kind: "llm",
		async translate(request) {
			const config = getProviderConfig(request);
			const apiKey = requireSetting(config.apiKey, "Gemini API key");
			const baseUrl = requireSetting(config.baseUrl, "Gemini base URL").replace(/\/+$/, "");
			const model = requireSetting(config.model, "Gemini model");
			const result = await requestJson<GeminiResponse>({
				url: `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`,
				method: "POST",
				timeoutMs: request.settings.requestTimeout,
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({
					systemInstruction: {parts: [{text: getSystemPrompt(request)}]},
					contents: [{role: "user", parts: [{text: createUserPrompt(request)}]}],
					generationConfig: {temperature: config.temperature},
				}),
			});
			const text = result.candidates?.[0]?.content?.parts?.map(part => part.text ?? "").join("").trim() ?? "";
			if (!text) {
				throw new TranslationError("Gemini returned an empty translation.");
			}
			return {text, provider: "gemini", sourceLanguage: request.sourceLanguage, targetLanguage: request.targetLanguage, raw: result};
		},
		testConnection(config) {
			requireSetting(config.apiKey, "Gemini API key");
			requireSetting(config.baseUrl, "Gemini base URL");
			requireSetting(config.model, "Gemini model");
		},
		async listModels(config, settings) {
			const apiKey = requireSetting(config.apiKey, "Gemini API key");
			const baseUrl = requireSetting(config.baseUrl, "Gemini base URL").replace(/\/+$/, "");
			const result = await requestJson<GeminiModelsResponse>({
				url: `${baseUrl}/models?key=${encodeURIComponent(apiKey)}&pageSize=1000`,
				method: "GET",
				timeoutMs: settings.requestTimeout,
			});
			return normalizeGeminiModels(result);
		},
	};
}

function normalizeGeminiModels(result: GeminiModelsResponse): ProviderModelInfo[] {
	return (result.models ?? [])
		.filter(model => !model.supportedGenerationMethods || model.supportedGenerationMethods.includes("generateContent"))
		.map(model => ({
			id: String(model.name ?? "").replace(/^models\//, "").trim(),
			name: model.displayName,
			description: model.description,
		}))
		.filter(model => model.id.length > 0)
		.sort((a, b) => a.id.localeCompare(b.id));
}
