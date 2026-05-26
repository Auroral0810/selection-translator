import {Setting} from "obsidian";
import {PROVIDER_KINDS, PROVIDER_LABELS} from "../translation/provider-config";
import {getLanguageLabel} from "./defaults";
import type {TranslationSettingTab} from "./tab";

interface Segment {
	label: string;
	value: number;
	className: string;
}

export function displayDashboardSettings(tab: TranslationSettingTab, el: HTMLElement): void {
	const provider = tab.plugin.settings.currentProvider;
	const config = tab.plugin.settings.currentProviderConfig;
	const queue = tab.plugin.requestQueueService.getStats();
	const metrics = tab.plugin.translationMetrics.getSnapshot();
	const cache = tab.plugin.translationCache.getStats();
	const cacheTotal = metrics.cacheHits + metrics.cacheMisses;
	const cacheHitRate = cacheTotal > 0 ? metrics.cacheHits / cacheTotal : 0;
	const requestTotal = metrics.successes + metrics.failures;
	const queueTotal = queue.pending + queue.active + queue.duplicates;

	tab.heading(el, tab.t("settings.tabs.dashboard"));

	const statusGrid = el.createDiv({cls: "selection-translator-dashboard-grid"});
	renderStatCard(statusGrid, tab.t("settings.dashboard.provider"), `${PROVIDER_LABELS[provider]} / ${getKindLabel(tab, PROVIDER_KINDS[provider])}`, getProviderDetail(tab, config));
	renderStatCard(statusGrid, tab.t("settings.dashboard.targetLanguage"), getLanguageLabel(tab.plugin.settings.targetLanguage, tab.plugin.settings.pluginLanguage), tab.plugin.settings.targetLanguage);
	renderStatCard(statusGrid, tab.t("settings.dashboard.queue"), `Pending ${queue.pending} / Active ${queue.active}`, `Duplicates ${queue.duplicates}`);
	renderStatCard(statusGrid, tab.t("settings.dashboard.cacheSize"), String(cache.entries), "Local plugin settings");

	const charts = el.createDiv({cls: "selection-translator-dashboard-charts"});
	renderRingChart(charts, tab.t("settings.dashboard.cache"), cacheHitRate, cacheTotal > 0 ? `${Math.round(cacheHitRate * 100)}%` : "-", `Hits ${metrics.cacheHits} / Misses ${metrics.cacheMisses}`);
	renderStackedChart(charts, tab.t("settings.dashboard.requests"), [
		{label: "Success", value: metrics.successes, className: "is-success"},
		{label: "Failure", value: metrics.failures, className: "is-error"},
	], requestTotal, `Total requests ${metrics.requests}`);
	renderStackedChart(charts, tab.t("settings.dashboard.queue"), [
		{label: "Pending", value: queue.pending, className: "is-pending"},
		{label: "Active", value: queue.active, className: "is-active"},
		{label: "Duplicates", value: queue.duplicates, className: "is-duplicate"},
	], queueTotal, "Real translation request queue");
	renderTokenChart(charts, tab, metrics.tokenSupported
		? [
			{label: "Input", value: metrics.inputTokens, className: "is-input"},
			{label: "Output", value: metrics.outputTokens, className: "is-output"},
		]
		: [], metrics.totalTokens, metrics.tokenSupported ? `Total ${metrics.totalTokens}` : tab.t("settings.dashboard.noUsage"));

	new Setting(el)
		.setName(tab.t("settings.dashboard.actions.name"))
		.setDesc(tab.t("settings.dashboard.actions.desc"))
		.addButton(button => button
			.setButtonText(tab.t("settings.dashboard.refresh"))
			.onClick(() => tab.display()))
		.addButton(button => button
			.setButtonText(tab.t("settings.dashboard.reset"))
			.onClick(() => {
				tab.plugin.translationMetrics.reset();
				tab.display();
			}));
}

function renderStatCard(container: HTMLElement, title: string, value: string, detail: string): void {
	const card = container.createDiv({cls: "selection-translator-dashboard-card"});
	card.createDiv({cls: "selection-translator-dashboard-card-title", text: title});
	card.createDiv({cls: "selection-translator-dashboard-card-value", text: value || "-"});
	card.createDiv({cls: "selection-translator-dashboard-card-detail", text: detail || "-"});
}

function renderRingChart(container: HTMLElement, title: string, ratio: number, value: string, detail: string): void {
	const card = container.createDiv({cls: "selection-translator-dashboard-chart"});
	card.createDiv({cls: "selection-translator-dashboard-chart-title", text: title});
	const ring = card.createDiv({cls: "selection-translator-dashboard-ring"});
	ring.style.setProperty("--selection-translator-chart-percent", `${Math.max(0, Math.min(1, ratio)) * 100}%`);
	ring.createDiv({cls: "selection-translator-dashboard-ring-value", text: value});
	card.createDiv({cls: "selection-translator-dashboard-chart-detail", text: detail});
}

function renderStackedChart(container: HTMLElement, title: string, segments: Segment[], total: number, detail: string): void {
	const card = container.createDiv({cls: "selection-translator-dashboard-chart"});
	card.createDiv({cls: "selection-translator-dashboard-chart-title", text: title});
	const bar = card.createDiv({cls: "selection-translator-dashboard-stacked"});
	for (const segment of segments) {
		const width = total > 0 ? Math.max(4, (segment.value / total) * 100) : 0;
		const segmentEl = bar.createDiv({cls: `selection-translator-dashboard-segment ${segment.className}`});
		segmentEl.style.setProperty("--selection-translator-segment-width", `${width}%`);
		segmentEl.setAttr("aria-label", `${segment.label}: ${segment.value}`);
	}
	renderLegend(card, segments);
	card.createDiv({cls: "selection-translator-dashboard-chart-detail", text: detail});
}

function renderTokenChart(container: HTMLElement, tab: TranslationSettingTab, segments: Segment[], total: number, detail: string): void {
	const card = container.createDiv({cls: "selection-translator-dashboard-chart"});
	card.createDiv({cls: "selection-translator-dashboard-chart-title", text: tab.t("settings.dashboard.tokens")});
	if (segments.length === 0 || total <= 0) {
		card.createDiv({cls: "selection-translator-dashboard-empty", text: detail});
		return;
	}
	const bar = card.createDiv({cls: "selection-translator-dashboard-stacked"});
	for (const segment of segments) {
		const width = Math.max(4, (segment.value / total) * 100);
		const segmentEl = bar.createDiv({cls: `selection-translator-dashboard-segment ${segment.className}`});
		segmentEl.style.setProperty("--selection-translator-segment-width", `${width}%`);
		segmentEl.setAttr("aria-label", `${segment.label}: ${segment.value}`);
	}
	renderLegend(card, segments);
	card.createDiv({cls: "selection-translator-dashboard-chart-detail", text: detail});
}

function renderLegend(container: HTMLElement, segments: Segment[]): void {
	const legend = container.createDiv({cls: "selection-translator-dashboard-legend"});
	for (const segment of segments) {
		const item = legend.createDiv({cls: "selection-translator-dashboard-legend-item"});
		item.createSpan({cls: `selection-translator-dashboard-legend-swatch ${segment.className}`});
		item.createSpan({text: `${segment.label} ${segment.value}`});
	}
}

function getProviderDetail(tab: TranslationSettingTab, config: {baseUrl: string; model: string}): string {
	return config.model || config.baseUrl || tab.t("settings.api.modelSummaryMissing");
}

function getKindLabel(tab: TranslationSettingTab, kind: string): string {
	return kind === "llm" ? tab.t("kind.llm") : tab.t("kind.pure");
}
