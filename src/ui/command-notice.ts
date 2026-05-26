import {Notice} from "obsidian";
import {t} from "../i18n";
import type TranslationPlugin from "../main";
import {formatTranslationError} from "../translation/errors";
import {PROVIDER_LABELS} from "../translation/provider-config";

const RUNNING_NOTICE_DURATION_MS = 30000;
const SUCCESS_NOTICE_DURATION_MS = 5000;
const FAILURE_NOTICE_DURATION_MS = 8000;

interface CommandNoticeOptions {
	plugin: TranslationPlugin;
	title: string;
	message: string;
}

interface CommandNoticeFailureDetails {
	commandName: string;
	text?: string;
}

export interface CommandNotice {
	success(message: string): void;
	fail(error: unknown, details: CommandNoticeFailureDetails): void;
	hide(): void;
}

export function startCommandNotice(options: CommandNoticeOptions): CommandNotice {
	const notice = new Notice(renderStatus(options.title, getStatusLabel(options.plugin, "running"), options.message), RUNNING_NOTICE_DURATION_MS);
	let hideTimer: number | null = null;

	const clearHideTimer = (): void => {
		if (hideTimer === null) {
			return;
		}
		window.clearTimeout(hideTimer);
		hideTimer = null;
	};
	const scheduleHide = (durationMs: number): void => {
		clearHideTimer();
		hideTimer = window.setTimeout(() => notice.hide(), durationMs);
	};

	scheduleHide(RUNNING_NOTICE_DURATION_MS);

	return {
		success(message: string): void {
			notice.setMessage(renderStatus(options.title, getStatusLabel(options.plugin, "success"), message, "success"));
			scheduleHide(SUCCESS_NOTICE_DURATION_MS);
		},
		fail(error: unknown, details: CommandNoticeFailureDetails): void {
			const errorText = formatCommandError(options.plugin, error, details);
			notice.setMessage(renderFailure(options.plugin, options.title, errorText));
			scheduleHide(FAILURE_NOTICE_DURATION_MS);
		},
		hide(): void {
			clearHideTimer();
			notice.hide();
		},
	};
}

function renderStatus(title: string, status: string, message: string, tone: "success" | "neutral" = "neutral"): DocumentFragment {
	const fragment = createFragment();
	const titleEl = createDiv();
	titleEl.className = "selection-translator-command-notice-title";
	titleEl.textContent = `${status} ${title}`;
	titleEl.toggleClass("is-success", tone === "success");
	fragment.appendChild(titleEl);

	const detailEl = createDiv();
	detailEl.className = "selection-translator-command-notice-detail";
	detailEl.textContent = message;
	fragment.appendChild(detailEl);
	return fragment;
}

function renderFailure(plugin: TranslationPlugin, title: string, errorText: string): DocumentFragment {
	const fragment = createFragment();
	const titleEl = createDiv();
	titleEl.className = "selection-translator-command-notice-title is-failed";
	titleEl.textContent = `${getStatusLabel(plugin, "failure")} ${title}`;
	fragment.appendChild(titleEl);

	const detailEl = createDiv();
	detailEl.className = "selection-translator-command-notice-detail";
	detailEl.textContent = errorText;
	fragment.appendChild(detailEl);

	const buttonEl = createEl("button");
	buttonEl.type = "button";
	buttonEl.className = "selection-translator-command-notice-copy";
	buttonEl.textContent = t(plugin, "command.copyError");
	buttonEl.addEventListener("click", event => {
		event.preventDefault();
		event.stopPropagation();
		void copyErrorText(plugin, errorText);
	});
	fragment.appendChild(buttonEl);
	return fragment;
}

async function copyErrorText(plugin: TranslationPlugin, errorText: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(errorText);
		new Notice(t(plugin, "notice.errorDetailsCopied"));
	} catch (copyError) {
		console.error("Failed to copy command error", copyError);
		new Notice(t(plugin, "notice.errorDetailsCopyFailed"));
	}
}

function formatCommandError(plugin: TranslationPlugin, error: unknown, details: CommandNoticeFailureDetails): string {
	const formatted = formatTranslationError(error);
	const rawMessage = error instanceof Error ? error.message : String(error);
	const lines = [
		`Command: ${details.commandName}`,
		`Provider: ${PROVIDER_LABELS[plugin.settings.currentProvider]}`,
		`Source language: ${plugin.settings.sourceLanguage}`,
		`Target language: ${plugin.settings.targetLanguage}`,
		`Error: ${formatted}`,
	];

	if (rawMessage && rawMessage !== formatted) {
		lines.push(`Raw message: ${rawMessage}`);
	}
	if (details.text) {
		lines.push(`Text length: ${details.text.length}`);
		lines.push(`Text preview: ${details.text.slice(0, 160)}`);
	}

	return lines.join("\n");
}

function getStatusLabel(plugin: TranslationPlugin, status: "running" | "success" | "failure"): string {
	return status === "running"
		? t(plugin, "common.status.running")
		: status === "success"
			? t(plugin, "common.status.done")
			: t(plugin, "common.status.failed");
}
