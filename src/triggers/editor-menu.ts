import {Editor, MarkdownFileInfo, MarkdownView, Menu} from "obsidian";
import {t} from "../i18n";
import TranslationPlugin from "../main";
import {translateCurrentParagraph, translateCurrentParagraphAndInsertBelow} from "../actions/translate-current-paragraph";
import {translateSelection} from "../actions/translate-selection";

export function registerEditorMenu(plugin: TranslationPlugin) {
	plugin.registerEvent(plugin.app.workspace.on(
		"editor-menu",
		(menu: Menu, editor: Editor, _info: MarkdownView | MarkdownFileInfo) => {
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

			if (editor.getSelection().trim()) {
				menu.addSeparator();
				menu.addItem(item => {
					item
						.setTitle(t(plugin, "command.translateSelection"))
						.setIcon("languages")
						.onClick(() => {
							void translateSelection(plugin, editor);
						});
				});
			}
		},
	));
}
