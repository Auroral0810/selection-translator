import {sha256Hex} from "../hash";
import {normalizeLanguageForProvider} from "../languages";
import {requestJson} from "../http";
import {requireSetting, TranslationError} from "../errors";
import type {TranslationProviderAdapter, TranslationProviderConfig} from "../types";
import {getProviderConfig} from "./shared";

interface GoogleCloudTranslateResponse {
	data?: {
		translations?: Array<{
			translatedText?: string;
			detectedSourceLanguage?: string;
		}>;
	};
}

interface AzureTranslatorResponseItem {
	detectedLanguage?: {
		language?: string;
		score?: number;
	};
	translations?: Array<{
		text?: string;
		to?: string;
	}>;
}

interface AwsTranslateResponse {
	TranslatedText?: string;
	SourceLanguageCode?: string;
	TargetLanguageCode?: string;
}

export function createGoogleCloudTranslateAdapter(): TranslationProviderAdapter {
	return {
		id: "google-cloud-translate",
		label: "Google Cloud Translation",
		kind: "pure-translation",
		async translate(request) {
			const config = getProviderConfig(request);
			const apiKey = requireSetting(config.apiKey, "Google Cloud Translation API key");
			const body = new URLSearchParams({
				q: request.text,
				target: normalizeLanguageForProvider(request.targetLanguage, "google-cloud-translate"),
				format: "text",
			});
			const source = normalizeLanguageForProvider(request.sourceLanguage, "google-cloud-translate");
			if (source !== "auto") {
				body.set("source", source);
			}
			const result = await requestJson<GoogleCloudTranslateResponse>({
				url: `${getGoogleCloudBaseUrl(config)}?key=${encodeURIComponent(apiKey)}`,
				method: "POST",
				timeoutMs: request.settings.requestTimeout,
				headers: {"Content-Type": "application/x-www-form-urlencoded"},
				body: body.toString(),
			});
			const first = result.data?.translations?.[0];
			const text = decodeHtmlEntities(first?.translatedText?.trim() ?? "");
			if (!text) {
				throw new TranslationError("Google Cloud Translation returned an empty translation.");
			}
			return {text, provider: "google-cloud-translate", sourceLanguage: first?.detectedSourceLanguage ?? request.sourceLanguage, targetLanguage: request.targetLanguage, raw: result};
		},
		testConnection(config) {
			requireSetting(config.apiKey, "Google Cloud Translation API key");
		},
	};
}

export function createAzureTranslatorAdapter(): TranslationProviderAdapter {
	return {
		id: "azure-translator",
		label: "Azure Translator",
		kind: "pure-translation",
		async translate(request) {
			const config = getProviderConfig(request);
			const apiKey = requireSetting(config.apiKey, "Azure Translator API key");
			const region = requireSetting(config.region, "Azure Translator region");
			const params = new URLSearchParams({
				"api-version": "3.0",
				to: normalizeLanguageForProvider(request.targetLanguage, "azure-translator"),
			});
			const source = normalizeLanguageForProvider(request.sourceLanguage, "azure-translator");
			if (source !== "auto") {
				params.set("from", source);
			}
			const result = await requestJson<AzureTranslatorResponseItem[]>({
				url: `${getAzureBaseUrl(config)}/translate?${params.toString()}`,
				method: "POST",
				timeoutMs: request.settings.requestTimeout,
				headers: {
					"Ocp-Apim-Subscription-Key": apiKey,
					"Ocp-Apim-Subscription-Region": region,
					"Content-Type": "application/json",
				},
				body: JSON.stringify([{Text: request.text}]),
			});
			const first = result[0];
			const text = first?.translations?.[0]?.text?.trim() ?? "";
			if (!text) {
				throw new TranslationError("Azure Translator returned an empty translation.");
			}
			return {text, provider: "azure-translator", sourceLanguage: first?.detectedLanguage?.language ?? request.sourceLanguage, targetLanguage: request.targetLanguage, raw: result};
		},
		testConnection(config) {
			requireSetting(config.apiKey, "Azure Translator API key");
			requireSetting(config.region, "Azure Translator region");
		},
	};
}

export function createAwsTranslateAdapter(): TranslationProviderAdapter {
	return {
		id: "aws-translate",
		label: "AWS Translate",
		kind: "pure-translation",
		async translate(request) {
			const config = getProviderConfig(request);
			const accessKeyId = requireSetting(config.accessKeyId, "AWS access key ID");
			const secretAccessKey = requireSetting(config.appSecret, "AWS secret access key");
			const region = requireSetting(config.region, "AWS region");
			const body = JSON.stringify({
				Text: request.text,
				SourceLanguageCode: normalizeLanguageForProvider(request.sourceLanguage, "aws-translate"),
				TargetLanguageCode: normalizeLanguageForProvider(request.targetLanguage, "aws-translate"),
			});
			const endpoint = getAwsEndpoint(config, region);
			const headers = await signAwsTranslateRequest({accessKeyId, secretAccessKey, region, endpoint, body});
			const result = await requestJson<AwsTranslateResponse>({
				url: endpoint,
				method: "POST",
				timeoutMs: request.settings.requestTimeout,
				headers,
				body,
			});
			const text = result.TranslatedText?.trim() ?? "";
			if (!text) {
				throw new TranslationError("AWS Translate returned an empty translation.");
			}
			return {text, provider: "aws-translate", sourceLanguage: result.SourceLanguageCode ?? request.sourceLanguage, targetLanguage: request.targetLanguage, raw: result};
		},
		testConnection(config) {
			requireSetting(config.accessKeyId, "AWS access key ID");
			requireSetting(config.appSecret, "AWS secret access key");
			requireSetting(config.region, "AWS region");
		},
	};
}

function getGoogleCloudBaseUrl(config: TranslationProviderConfig): string {
	return (config.baseUrl || "https://translation.googleapis.com/language/translate/v2").replace(/\/+$/, "");
}

function getAzureBaseUrl(config: TranslationProviderConfig): string {
	return (config.baseUrl || "https://api.cognitive.microsofttranslator.com").replace(/\/+$/, "");
}

function getAwsEndpoint(config: TranslationProviderConfig, region: string): string {
	const baseUrl = config.baseUrl || "https://translate.{region}.amazonaws.com";
	return baseUrl.replace("{region}", region).replace(/\/+$/, "");
}

function decodeHtmlEntities(text: string): string {
	return text
		.replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
		.replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
		.replace(/&quot;/g, "\"")
		.replace(/&#39;/g, "'")
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&amp;/g, "&");
}

async function signAwsTranslateRequest(options: {accessKeyId: string; secretAccessKey: string; region: string; endpoint: string; body: string}): Promise<Record<string, string>> {
	const service = "translate";
	const host = new URL(options.endpoint).host;
	const now = new Date();
	const amzDate = toAmzDate(now);
	const dateStamp = amzDate.slice(0, 8);
	const payloadHash = await sha256Hex(options.body);
	const canonicalHeaders = [
		`content-type:application/x-amz-json-1.1`,
		`host:${host}`,
		`x-amz-date:${amzDate}`,
		`x-amz-target:AWSShineFrontendService_20170701.TranslateText`,
	].join("\n") + "\n";
	const signedHeaders = "content-type;host;x-amz-date;x-amz-target";
	const canonicalRequest = [
		"POST",
		"/",
		"",
		canonicalHeaders,
		signedHeaders,
		payloadHash,
	].join("\n");
	const credentialScope = `${dateStamp}/${options.region}/${service}/aws4_request`;
	const stringToSign = [
		"AWS4-HMAC-SHA256",
		amzDate,
		credentialScope,
		await sha256Hex(canonicalRequest),
	].join("\n");
	const signingKey = await getAwsSigningKey(options.secretAccessKey, dateStamp, options.region, service);
	const signature = bytesToHex(await hmacSha256(signingKey, stringToSign));

	return {
		"Authorization": `AWS4-HMAC-SHA256 Credential=${options.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
		"Content-Type": "application/x-amz-json-1.1",
		"Host": host,
		"X-Amz-Date": amzDate,
		"X-Amz-Target": "AWSShineFrontendService_20170701.TranslateText",
	};
}

async function getAwsSigningKey(secretAccessKey: string, dateStamp: string, region: string, service: string): Promise<Uint8Array> {
	const dateKey = await hmacSha256(new TextEncoder().encode(`AWS4${secretAccessKey}`), dateStamp);
	const dateRegionKey = await hmacSha256(dateKey, region);
	const dateRegionServiceKey = await hmacSha256(dateRegionKey, service);
	return hmacSha256(dateRegionServiceKey, "aws4_request");
}

async function hmacSha256(key: Uint8Array, data: string): Promise<Uint8Array> {
	const cryptoKey = await crypto.subtle.importKey("raw", key, {name: "HMAC", hash: "SHA-256"}, false, ["sign"]);
	const signature = await crypto.subtle.sign("HMAC", cryptoKey, new TextEncoder().encode(data));
	return new Uint8Array(signature);
}

function toAmzDate(date: Date): string {
	return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function bytesToHex(bytes: Uint8Array): string {
	return Array.from(bytes).map(byte => byte.toString(16).padStart(2, "0")).join("");
}
