import {md5, sha256Hex} from "../hash";
import {normalizeLanguageForProvider} from "../languages";
import {requestJson} from "../http";
import {requireSetting, TranslationError} from "../errors";
import type {TranslationProviderAdapter} from "../types";
import {getProviderConfig} from "./shared";

interface BaiduResponse {
	from?: string;
	to?: string;
	trans_result?: Array<{
		dst?: string;
		src?: string;
	}>;
	error_code?: string;
	error_msg?: string;
}

interface YoudaoResponse {
	errorCode?: string;
	translation?: string[];
	l?: string;
}

export function createBaiduAdapter(): TranslationProviderAdapter {
	return {
		id: "baidu",
		label: "Baidu",
		kind: "pure-translation",
		async translate(request) {
			const config = getProviderConfig(request);
			const appId = requireSetting(config.appId, "Baidu app ID");
			const secret = requireSetting(config.appSecret, "Baidu app secret");
			const salt = String(Date.now());
			const from = normalizeLanguageForProvider(request.sourceLanguage, "baidu");
			const to = normalizeLanguageForProvider(request.targetLanguage, "baidu");
			const sign = md5(`${appId}${request.text}${salt}${secret}`);
			const params = new URLSearchParams({q: request.text, from, to, appid: appId, salt, sign});
			const result = await requestJson<BaiduResponse>({
				url: `https://fanyi-api.baidu.com/api/trans/vip/translate?${params.toString()}`,
				timeoutMs: request.settings.requestTimeout,
			});
			if (result.error_code) {
				throw new TranslationError(`Baidu error ${result.error_code}: ${result.error_msg ?? "Unknown error"}`);
			}
			const text = result.trans_result?.map(item => item.dst).filter(Boolean).join("\n").trim();
			if (!text) {
				throw new TranslationError("Baidu returned an empty translation.");
			}
			return {text, provider: "baidu", sourceLanguage: result.from ?? request.sourceLanguage, targetLanguage: request.targetLanguage, raw: result};
		},
		testConnection(config) {
			requireSetting(config.appId, "Baidu app ID");
			requireSetting(config.appSecret, "Baidu app secret");
		},
	};
}

export function createYoudaoAdapter(): TranslationProviderAdapter {
	return {
		id: "youdao",
		label: "Youdao",
		kind: "pure-translation",
		async translate(request) {
			const config = getProviderConfig(request);
			const appKey = requireSetting(config.appId, "Youdao app key");
			const appSecret = requireSetting(config.appSecret, "Youdao app secret");
			const salt = String(Date.now());
			const curtime = String(Math.floor(Date.now() / 1000));
			const sign = await sha256Hex(`${appKey}${truncateForSign(request.text)}${salt}${curtime}${appSecret}`);
			const body = new URLSearchParams({
				q: request.text,
				from: normalizeLanguageForProvider(request.sourceLanguage, "youdao"),
				to: normalizeLanguageForProvider(request.targetLanguage, "youdao"),
				appKey,
				salt,
				sign,
				signType: "v3",
				curtime,
			});
			const result = await requestJson<YoudaoResponse>({
				url: "https://openapi.youdao.com/api",
				method: "POST",
				timeoutMs: request.settings.requestTimeout,
				headers: {"Content-Type": "application/x-www-form-urlencoded"},
				body: body.toString(),
			});
			if (result.errorCode && result.errorCode !== "0") {
				throw new TranslationError(`Youdao error ${result.errorCode}.`);
			}
			const text = result.translation?.join("\n").trim();
			if (!text) {
				throw new TranslationError("Youdao returned an empty translation.");
			}
			return {text, provider: "youdao", sourceLanguage: result.l ?? request.sourceLanguage, targetLanguage: request.targetLanguage, raw: result};
		},
		testConnection(config) {
			requireSetting(config.appId, "Youdao app key");
			requireSetting(config.appSecret, "Youdao app secret");
		},
	};
}

function truncateForSign(text: string): string {
	if (text.length <= 20) {
		return text;
	}
	return `${text.slice(0, 10)}${text.length}${text.slice(-10)}`;
}
