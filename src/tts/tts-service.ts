import {requestUrl} from "obsidian";
import {t} from "../i18n";
import type TranslationPlugin from "../main";
import {TranslationError, requireSetting} from "../translation/errors";
import {withTimeout} from "../translation/http";

export type TtsProviderId = "web-speech" | "openai-tts" | "azure-speech";

export interface TtsConfig {
	apiKey: string;
	baseUrl: string;
	model: string;
	voice: string;
	region: string;
}

export interface TtsRequest {
	text: string;
	language: string;
	voice?: string;
	rate?: number;
	pitch?: number;
	volume?: number;
}

export interface TtsVoiceInfo {
	id: string;
	name: string;
	language?: string;
	provider: TtsProviderId;
}

export interface TtsService {
	speak(request: TtsRequest): Promise<void>;
	stop(): void;
	listVoices(): Promise<TtsVoiceInfo[]>;
	test(text?: string): Promise<void>;
}

const OPENAI_TTS_VOICES = ["alloy", "ash", "ballad", "coral", "echo", "fable", "nova", "onyx", "sage", "shimmer", "verse"];

export class DefaultTtsService implements TtsService {
	private audio: HTMLAudioElement | null = null;
	private audioUrl: string | null = null;

	constructor(private readonly plugin: TranslationPlugin) {}

	async speak(request: TtsRequest): Promise<void> {
		if (!this.plugin.settings.ttsEnabled) {
			throw new TranslationError("TTS is disabled.");
		}
		await this.speakWithCurrentProvider(request);
	}

	stop(): void {
		window.speechSynthesis?.cancel();
		if (this.audio) {
			this.audio.pause();
			this.audio.src = "";
			this.audio = null;
		}
		if (this.audioUrl) {
			URL.revokeObjectURL(this.audioUrl);
			this.audioUrl = null;
		}
	}

	async listVoices(): Promise<TtsVoiceInfo[]> {
		const provider = this.plugin.settings.ttsProvider;
		if (provider === "web-speech") {
			return this.listWebSpeechVoices();
		}
		if (provider === "openai-tts") {
			return OPENAI_TTS_VOICES.map(voice => ({id: voice, name: voice, provider}));
		}
		return this.listAzureVoices();
	}

	async test(text = t(this.plugin, "settings.tts.testDefaultText")): Promise<void> {
		await this.speakWithCurrentProvider({
			text,
			language: this.plugin.settings.targetLanguage,
			voice: this.plugin.settings.ttsVoice,
			rate: this.plugin.settings.ttsRate,
			pitch: this.plugin.settings.ttsPitch,
			volume: this.plugin.settings.ttsVolume,
		});
	}

	private async speakWithCurrentProvider(request: TtsRequest): Promise<void> {
		this.stop();
		const provider = this.plugin.settings.ttsProvider;
		if (provider === "web-speech") {
			await this.speakWithWebSpeech(request);
			return;
		}
		if (provider === "openai-tts") {
			await this.speakWithOpenAI(request);
			return;
		}
		await this.speakWithAzure(request);
	}

	private async speakWithWebSpeech(request: TtsRequest): Promise<void> {
		if (!("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
			throw new TranslationError("Web Speech is not available in this Obsidian environment.");
		}

		const utterance = new SpeechSynthesisUtterance(request.text);
		utterance.lang = normalizeTtsLanguage(request.language);
		utterance.rate = clamp(request.rate ?? this.plugin.settings.ttsRate, 0.1, 10);
		utterance.pitch = clamp(request.pitch ?? this.plugin.settings.ttsPitch, 0, 2);
		utterance.volume = clamp(request.volume ?? this.plugin.settings.ttsVolume, 0, 1);

		const voiceId = request.voice || this.plugin.settings.ttsVoice;
		const voices = await this.getWebSpeechVoiceObjects();
		const voice = voices.find(item => item.voiceURI === voiceId || item.name === voiceId);
		if (voice) {
			utterance.voice = voice;
		}

		await new Promise<void>((resolve, reject) => {
			utterance.onend = () => resolve();
			utterance.onerror = event => reject(new TranslationError(`Web Speech failed: ${event.error}`));
			window.speechSynthesis.speak(utterance);
		});
	}

	private async speakWithOpenAI(request: TtsRequest): Promise<void> {
		const config = this.plugin.settings.ttsConfig;
		const apiKey = getOpenAIApiKey(this.plugin);
		const baseUrl = (config.baseUrl || getOpenAIBaseUrl(this.plugin)).replace(/\/+$/, "");
		const model = requireSetting(config.model || "gpt-4o-mini-tts", "OpenAI TTS model");
		const voice = request.voice || this.plugin.settings.ttsVoice || config.voice || "alloy";
		const response = await withTimeout(requestUrl({
			url: `${baseUrl}/audio/speech`,
			method: "POST",
			headers: {
				"Authorization": `Bearer ${apiKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				model,
				voice,
				input: request.text,
				response_format: "mp3",
			}),
			throw: false,
		}), this.plugin.settings.requestTimeout);
		if (response.status < 200 || response.status >= 300) {
			throw new TranslationError(`OpenAI TTS failed with HTTP ${response.status}: ${response.text}`);
		}
		await this.playAudioBuffer(response.arrayBuffer, "audio/mpeg");
	}

	private async speakWithAzure(request: TtsRequest): Promise<void> {
		const config = this.plugin.settings.ttsConfig;
		const apiKey = requireSetting(config.apiKey, "Azure Speech API key");
		const region = requireSetting(config.region, "Azure Speech region");
		const voice = request.voice || this.plugin.settings.ttsVoice || config.voice || "zh-CN-XiaoxiaoNeural";
		const ssml = buildAzureSsml(request.text, voice, normalizeTtsLanguage(request.language), request.rate ?? this.plugin.settings.ttsRate, request.pitch ?? this.plugin.settings.ttsPitch);
		const response = await withTimeout(requestUrl({
			url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/v1`,
			method: "POST",
			headers: {
				"Ocp-Apim-Subscription-Key": apiKey,
				"Content-Type": "application/ssml+xml",
				"X-Microsoft-OutputFormat": "audio-24khz-48kbitrate-mono-mp3",
				"User-Agent": "selection-translator",
			},
			body: ssml,
			throw: false,
		}), this.plugin.settings.requestTimeout);
		if (response.status < 200 || response.status >= 300) {
			throw new TranslationError(`Azure Speech failed with HTTP ${response.status}: ${response.text}`);
		}
		await this.playAudioBuffer(response.arrayBuffer, "audio/mpeg");
	}

	private async listWebSpeechVoices(): Promise<TtsVoiceInfo[]> {
		const voices = await this.getWebSpeechVoiceObjects();
		return voices.map(voice => ({
			id: voice.voiceURI || voice.name,
			name: voice.name,
			language: voice.lang,
			provider: "web-speech",
		}));
	}

	private async getWebSpeechVoiceObjects(): Promise<SpeechSynthesisVoice[]> {
		if (!("speechSynthesis" in window)) {
			return [];
		}
		const voices = window.speechSynthesis.getVoices();
		if (voices.length > 0) {
			return voices;
		}
		return new Promise(resolve => {
			const timer = window.setTimeout(() => {
				window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
				resolve(window.speechSynthesis.getVoices());
			}, 1000);
			const handleVoicesChanged = () => {
				window.clearTimeout(timer);
				window.speechSynthesis.removeEventListener("voiceschanged", handleVoicesChanged);
				resolve(window.speechSynthesis.getVoices());
			};
			window.speechSynthesis.addEventListener("voiceschanged", handleVoicesChanged);
		});
	}

	private async listAzureVoices(): Promise<TtsVoiceInfo[]> {
		const config = this.plugin.settings.ttsConfig;
		const apiKey = requireSetting(config.apiKey, "Azure Speech API key");
		const region = requireSetting(config.region, "Azure Speech region");
		const response = await withTimeout(requestUrl({
			url: `https://${region}.tts.speech.microsoft.com/cognitiveservices/voices/list`,
			method: "GET",
			headers: {"Ocp-Apim-Subscription-Key": apiKey},
			throw: false,
		}), this.plugin.settings.requestTimeout);
		if (response.status < 200 || response.status >= 300) {
			throw new TranslationError(`Unable to list Azure Speech voices: HTTP ${response.status}`);
		}
		const voices = response.json as Array<{ShortName?: string; DisplayName?: string; Locale?: string}>;
		return voices
			.map(voice => ({
				id: String(voice.ShortName ?? "").trim(),
				name: String(voice.DisplayName ?? voice.ShortName ?? "").trim(),
				language: voice.Locale,
				provider: "azure-speech" as const,
			}))
			.filter(voice => voice.id.length > 0);
	}

	private async playAudioBuffer(buffer: ArrayBuffer, mimeType: string): Promise<void> {
		this.stop();
		this.audioUrl = URL.createObjectURL(new Blob([buffer], {type: mimeType}));
		this.audio = new Audio(this.audioUrl);
		this.audio.volume = clamp(this.plugin.settings.ttsVolume, 0, 1);
		await new Promise<void>((resolve, reject) => {
			if (!this.audio) {
				reject(new TranslationError("Audio player was closed."));
				return;
			}
			this.audio.onended = () => resolve();
			this.audio.onerror = () => reject(new TranslationError("Failed to play synthesized audio."));
			this.audio.play().catch(error => reject(error instanceof Error ? error : new TranslationError("Failed to play synthesized audio.", error)));
		});
	}
}

export function getDefaultTtsConfig(provider: TtsProviderId): TtsConfig {
	if (provider === "openai-tts") {
		return {apiKey: "", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini-tts", voice: "alloy", region: ""};
	}
	if (provider === "azure-speech") {
		return {apiKey: "", baseUrl: "", model: "", voice: "zh-CN-XiaoxiaoNeural", region: "eastus"};
	}
	return {apiKey: "", baseUrl: "", model: "", voice: "", region: ""};
}

function getOpenAIApiKey(plugin: TranslationPlugin): string {
	if (plugin.settings.ttsConfig.apiKey) {
		return plugin.settings.ttsConfig.apiKey;
	}
	if (plugin.settings.currentProvider === "openai" || plugin.settings.currentProvider === "openai-compatible") {
		return requireSetting(plugin.settings.currentProviderConfig.apiKey, "OpenAI API key");
	}
	return requireSetting("", "OpenAI TTS API key");
}

function getOpenAIBaseUrl(plugin: TranslationPlugin): string {
	if (plugin.settings.currentProvider === "openai" || plugin.settings.currentProvider === "openai-compatible") {
		return plugin.settings.currentProviderConfig.baseUrl || "https://api.openai.com/v1";
	}
	return "https://api.openai.com/v1";
}

function buildAzureSsml(text: string, voice: string, language: string, rate: number, pitch: number): string {
	const ratePercent = Math.round((clamp(rate, 0.5, 2) - 1) * 100);
	const pitchPercent = Math.round((clamp(pitch, 0, 2) - 1) * 50);
	return [
		`<speak version="1.0" xml:lang="${escapeXml(language)}">`,
		`<voice name="${escapeXml(voice)}">`,
		`<prosody rate="${ratePercent >= 0 ? "+" : ""}${ratePercent}%" pitch="${pitchPercent >= 0 ? "+" : ""}${pitchPercent}%">`,
		escapeXml(text),
		"</prosody>",
		"</voice>",
		"</speak>",
	].join("");
}

function normalizeTtsLanguage(language: string): string {
	return language === "auto" ? "zh-CN" : language;
}

function escapeXml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;")
		.replace(/'/g, "&apos;");
}

function clamp(value: number, min: number, max: number): number {
	return Math.min(max, Math.max(min, value));
}
