import type TranslationPlugin from "../main";
import {requireSetting, TranslationError} from "../translation/errors";

interface ImageEditResponse {
	data?: Array<{
		b64_json?: string;
		url?: string;
	}>;
	error?: {
		message?: string;
	};
}

export interface TranslateImageOptions {
	imageData: ArrayBuffer;
	fileName: string;
	targetLanguage: string;
	prompt: string;
	outputFormat: string;
}

export async function translateImageWithOpenAI(plugin: TranslationPlugin, options: TranslateImageOptions): Promise<ArrayBuffer> {
	const apiKey = requireSetting(plugin.settings.imageApiKey, "OpenAI image API key");
	const baseUrl = requireSetting(plugin.settings.imageBaseUrl, "OpenAI image base URL").replace(/\/+$/, "");
	const model = normalizeImageModel(requireSetting(plugin.settings.imageModel, "OpenAI image model"));
	const prompt = `${options.prompt.trim()}\n\nTarget language: ${options.targetLanguage}.`;

	const formData = new FormData();
	formData.append("model", model);
	formData.append("prompt", prompt);
	formData.append("image", new Blob([options.imageData], {type: getMimeType(options.fileName)}), options.fileName);
	formData.append("n", "1");
	formData.append("size", "auto");
	formData.append("output_format", normalizeOutputFormat(options.outputFormat));

	const response = await fetchWithTimeout(`${baseUrl}/images/edits`, {
		method: "POST",
		headers: {
			"Authorization": `Bearer ${apiKey}`,
		},
		body: formData,
	}, plugin.settings.requestTimeout);

	const json = await response.json() as ImageEditResponse;
	if (!response.ok) {
		throw new TranslationError(json.error?.message || `OpenAI image request failed with HTTP ${response.status}.`);
	}

	const base64 = json.data?.[0]?.b64_json;
	if (!base64) {
		throw new TranslationError("OpenAI image response did not include image data.");
	}

	return base64ToArrayBuffer(base64);
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
	const controller = new AbortController();
	const timeoutId = window.setTimeout(() => controller.abort(), timeoutMs);
	try {
		// FormData image uploads need the browser multipart encoder; Obsidian requestUrl does not provide one.
		return await window.fetch(url, {...init, signal: controller.signal});
	} catch (error) {
		if (error instanceof DOMException && error.name === "AbortError") {
			throw new TranslationError(`Image request timed out after ${timeoutMs} ms.`);
		}
		throw error;
	} finally {
		window.clearTimeout(timeoutId);
	}
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
	const binary = atob(base64);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index++) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes.buffer;
}

function normalizeOutputFormat(value: string): string {
	const normalized = value.trim().toLowerCase();
	return normalized === "jpeg" || normalized === "webp" ? normalized : "png";
}

function normalizeImageModel(value: string): string {
	return value === "gpt-image-2" ? "gpt-image-2" : "gpt-image-1.5";
}

function getMimeType(fileName: string): string {
	const extension = fileName.split(".").pop()?.toLowerCase();
	if (extension === "jpg" || extension === "jpeg") return "image/jpeg";
	if (extension === "webp") return "image/webp";
	return "image/png";
}
