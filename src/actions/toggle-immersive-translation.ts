import TranslationPlugin from "../main";

export function toggleImmersiveTranslation(plugin: TranslationPlugin): void {
	plugin.immersiveManager.toggleActiveFile();
}
