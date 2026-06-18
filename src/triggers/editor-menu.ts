import {Editor, MarkdownFileInfo, MarkdownView, Menu} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";
import {translateCurrentFile} from "../actions/translate-current-file";
import {translateCurrentParagraph, translateCurrentParagraphAndInsertBelow} from "../actions/translate-current-paragraph";
import {translateSelection} from "../actions/translate-selection";
import {showQuickTranslationPanel} from "../ui/quick-translation-panel";

export function registerEditorMenu(plugin: TranslationPlugin) {
	plugin.registerEvent(plugin.app.workspace.on(
		"editor-menu",
		(menu: Menu, editor: Editor, _info: MarkdownView | MarkdownFileInfo) => {
			const selection = editor.getSelection().trim();

			if (selection) {
				menu.addItem(item => {
					item
						.setTitle(t(plugin, "command.translateSelection"))
						.setIcon("languages")
						.onClick(() => {
							void translateSelection(plugin, editor);
						});
				});
			}

			menu.addItem(item => {
				item
					.setTitle(t(plugin, "command.translateCurrentParagraph"))
					.setIcon("languages")
					.onClick(() => {
						void translateCurrentParagraph(plugin, editor);
					});
			});

			menu.addItem(item => {
				item
					.setTitle(t(plugin, "command.translateParagraphInsertBelow"))
					.setIcon("message-square-plus")
					.onClick(() => {
						void translateCurrentParagraphAndInsertBelow(plugin, editor);
					});
			});

			menu.addSeparator();

			menu.addItem(item => {
				item
					.setTitle(t(plugin, "menu.quickPanel"))
					.setIcon("search")
					.onClick(() => {
						showQuickTranslationPanel(plugin, {initialText: selection});
					});
			});

			menu.addItem(item => {
				item
					.setTitle(t(plugin, "command.translateCurrentFile"))
					.setIcon("file-text")
					.onClick(() => {
						void translateCurrentFile(plugin);
					});
			});
		},
	));
}
