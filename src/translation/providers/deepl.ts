import {normalizeLanguageForProvider} from "../languages";
import {requestJson} from "../http";
import {requireSetting, TranslationError} from "../errors";
import type {TranslationProviderAdapter} from "../types";
import {getProviderConfig} from "./shared";

interface DeepLResponse {
	translations?: Array<{
		text?: string;
		detected_source_language?: string;
	}>;
}

interface DeepLXResponse {
	data?: string;
}

const DEEPLX_API_KEY_PLACEHOLDER_RE = /\{\{apiKey\}\}/g;

export function createDeepLXAdapter(): TranslationProviderAdapter {
	return {
		id: "deeplx",
		label: "DeepLX",
		kind: "pure-translation",
		async translate(request) {
			const config = getProviderConfig(request);
			const url = buildDeepLXUrl(config.baseUrl || "https://api.deeplx.org", config.apiKey);
			const result = await requestJson<DeepLXResponse>({
				url,
				method: "POST",
				timeoutMs: request.settings.requestTimeout,
				headers: {"Content-Type": "application/json"},
				body: JSON.stringify({
					text: request.text,
					source_lang: normalizeLanguageForProvider(request.sourceLanguage, "deeplx"),
					target_lang: normalizeLanguageForProvider(request.targetLanguage, "deeplx"),
				}),
			});
			const text = result.data?.trim() ?? "";
			if (!text) {
				throw new TranslationError("DeepLX returned an empty translation.");
			}
			return {text, provider: "deeplx", sourceLanguage: request.sourceLanguage, targetLanguage: request.targetLanguage, raw: result};
		},
		testConnection(config) {
			requireSetting(config.baseUrl || "https://api.deeplx.org", "DeepLX base URL");
		},
	};
}

export function createDeepLAdapter(): TranslationProviderAdapter {
	return {
		id: "deepl",
		label: "DeepL",
		kind: "pure-translation",
		async translate(request) {
			const config = getProviderConfig(request);
			const apiKey = requireSetting(config.apiKey, "DeepL API key");
			const host = config.apiType === "pro" ? "https://api.deepl.com" : "https://api-free.deepl.com";
			const body = new URLSearchParams({
				text: request.text,
				target_lang: normalizeLanguageForProvider(request.targetLanguage, "deepl"),
			});
			const sourceLang = normalizeLanguageForProvider(request.sourceLanguage, "deepl");
			if (sourceLang) {
				body.set("source_lang", sourceLang);
			}
			const result = await requestJson<DeepLResponse>({
				url: `${host}/v2/translate`,
				method: "POST",
				timeoutMs: request.settings.requestTimeout,
				headers: {
					"Authorization": `DeepL-Auth-Key ${apiKey}`,
					"Content-Type": "application/x-www-form-urlencoded",
				},
				body: body.toString(),
			});
			const text = result.translations?.[0]?.text?.trim();
			if (!text) {
				throw new TranslationError("DeepL returned an empty translation.");
			}
			return {text, provider: "deepl", sourceLanguage: result.translations?.[0]?.detected_source_language ?? request.sourceLanguage, targetLanguage: request.targetLanguage, raw: result};
		},
		testConnection(config) {
			requireSetting(config.apiKey, "DeepL API key");
		},
	};
}

function buildDeepLXUrl(baseUrl: string, apiKey?: string): string {
	const cleanBaseUrl = baseUrl.replace(/\/+$/, "");
	if (cleanBaseUrl.includes("{{apiKey}}")) {
		if (!apiKey) {
			throw new TranslationError("DeepLX API key is required when base URL contains {{apiKey}}.");
		}
		return cleanBaseUrl.replace(DEEPLX_API_KEY_PLACEHOLDER_RE, apiKey);
	}
	if (cleanBaseUrl === "https://api.deeplx.org") {
		return apiKey ? `${cleanBaseUrl}/${apiKey}/translate` : `${cleanBaseUrl}/translate`;
	}
	if (!cleanBaseUrl.endsWith("/translate")) {
		return apiKey ? `${cleanBaseUrl}/${apiKey}/translate` : `${cleanBaseUrl}/translate`;
	}
	return cleanBaseUrl;
}
