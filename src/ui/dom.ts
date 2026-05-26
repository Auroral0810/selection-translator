export function isHTMLElement(target: EventTarget | null): target is HTMLElement {
	return target instanceof Node && target.instanceOf(HTMLElement);
}

export function isHTMLImageElement(target: Element | null): target is HTMLImageElement {
	return target instanceof Node && target.instanceOf(HTMLImageElement);
}
