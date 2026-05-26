import {Menu, Notice} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";
import {openSideBySideTranslation} from "../actions/open-side-by-side-translation";
import {toggleImmersiveTranslation} from "../actions/toggle-immersive-translation";
import {translateCurrentFile} from "../actions/translate-current-file";
import {getActiveMarkdownView, translateSelection} from "../actions/translate-selection";
import {showQuickTranslationPanel} from "../ui/quick-translation-panel";

export function registerTranslationRibbon(plugin: TranslationPlugin) {
	const ribbonEl = plugin.addRibbonIcon("languages", t(plugin, "menu.translationTools"), (event: MouseEvent) => {
		updateRibbonState(plugin, ribbonEl);
		const menu = new Menu();
		const activeFile = plugin.app.workspace.getActiveFile();
		const immersiveActive = plugin.immersiveManager.isActiveForCurrentFile();
		const sideBySideActive = activeFile ? plugin.documentTranslationService.isActive(activeFile.path) : false;
		const scrollSyncActive = plugin.sideBySideSyncManager.isEnabled();

		menu.addItem(item => item
			.setTitle(t(plugin, "command.translateSelection"))
			.setIcon("languages")
			.onClick(() => {
				const markdownView = getActiveMarkdownView(plugin);

				if (!markdownView) {
					new Notice(t(plugin, "notice.openMarkdownSelection"));
					return;
				}

				void translateSelection(plugin, markdownView.editor);
			}));

		menu.addItem(item => item
			.setTitle(t(plugin, "menu.quickPanel"))
			.setIcon("search")
			.onClick(() => {
				const markdownView = getActiveMarkdownView(plugin);
				showQuickTranslationPanel(plugin, {
					initialText: markdownView?.editor.getSelection().trim() ?? "",
				});
			}));

		menu.addItem(item => item
			.setTitle(t(plugin, "command.translateCurrentFile"))
			.setIcon("file-text")
			.onClick(() => {
				void translateCurrentFile(plugin);
			}));

		menu.addSeparator();

		menu.addItem(item => item
			.setTitle(immersiveActive ? t(plugin, "menu.disableImmersive") : t(plugin, "menu.immersive"))
			.setIcon(immersiveActive ? "check" : "scan-text")
			.onClick(() => {
				toggleImmersiveTranslation(plugin);
				updateRibbonState(plugin, ribbonEl);
			}));

		menu.addItem(item => item
			.setTitle(sideBySideActive ? t(plugin, "menu.refreshSideBySide") : t(plugin, "menu.sideBySide"))
			.setIcon(sideBySideActive ? "check" : "book-open-text")
			.onClick(() => {
				void openSideBySideTranslation(plugin);
				window.setTimeout(() => updateRibbonState(plugin, ribbonEl), 250);
			}));

		menu.addItem(item => item
			.setTitle(scrollSyncActive ? t(plugin, "menu.stopScrollSync") : t(plugin, "menu.syncScroll"))
			.setIcon(scrollSyncActive ? "check" : "move-vertical")
			.onClick(() => {
				plugin.sideBySideSyncManager.toggleForVisibleMarkdownLeaves();
				window.setTimeout(() => updateRibbonState(plugin, ribbonEl), 250);
			}));

		menu.showAtMouseEvent(event);
	});

	const update = () => updateRibbonState(plugin, ribbonEl);
	plugin.registerEvent(plugin.app.workspace.on("active-leaf-change", update));
	plugin.registerEvent(plugin.app.workspace.on("file-open", update));
	plugin.registerEvent(plugin.app.workspace.on("layout-change", update));
	plugin.app.workspace.onLayoutReady(update);
	update();
}

function updateRibbonState(plugin: TranslationPlugin, ribbonEl: HTMLElement): void {
	const file = plugin.app.workspace.getActiveFile();
	const hasActiveMode = plugin.immersiveManager.isActiveForCurrentFile()
		|| (file ? plugin.documentTranslationService.isActive(file.path) : false)
		|| plugin.sideBySideSyncManager.isEnabled();
	ribbonEl.toggleClass("selection-translator-ribbon-active", hasActiveMode);
}
