import type {TranslationPluginSettings} from "../settings";
import type {ImmersiveStyle} from "./types";

export function normalizeImmersiveStyle(value: string): ImmersiveStyle {
	if (value === "weakened" || value === "border" || value === "background" || value === "custom") {
		return value;
	}

	return "blockquote";
}

export function applyImmersiveStyle(element: HTMLElement, settings: TranslationPluginSettings): void {
	const style = normalizeImmersiveStyle(settings.immersiveStyle);
	element.addClass("selection-translator-immersive");
	element.addClass(`selection-translator-immersive-${style}`);

	if (style === "custom" && settings.immersiveCustomCss.trim()) {
		element.setAttr("style", settings.immersiveCustomCss.trim());
	}
}
