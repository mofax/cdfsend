// @ts-check
/** Keep focus inside an open dialog and restore the invoking control on close. @param {HTMLElement} node @param {()=>void} close */
export function dialog(node, close) {
	const previousFocus = document.activeElement;
	const overlay = node.parentElement;
	const adjacentElements = overlay?.parentElement?.children ?? [];
	const siblings = Array.from(adjacentElements).filter(
		(element) => element !== overlay && element instanceof HTMLElement,
	);
	const inertStates = siblings.map((element) => ({
		element: /** @type {HTMLElement} */ (element),
		inert: /** @type {HTMLElement} */ (element).inert,
	}));
	for (const state of inertStates) state.element.inert = true;

	function controls() {
		return Array.from(
			node.querySelectorAll(
				"button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex='0']",
			),
		).filter((element) => element instanceof HTMLElement);
	}

	queueMicrotask(() => {
		const first = /** @type {HTMLElement|undefined} */ (controls()[0]);
		(first ?? node).focus();
	});

	/** @param {KeyboardEvent} event */
	function keydown(event) {
		if (event.key === "Escape") {
			event.preventDefault();
			close();
			return;
		}

		if (event.key !== "Tab") return;
		const available = controls();
		const first = /** @type {HTMLElement|undefined} */ (available[0]);
		const last = /** @type {HTMLElement|undefined} */ (available.at(-1));

		if (!first || !last) {
			event.preventDefault();
			return;
		}

		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		}

		if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	node.addEventListener("keydown", keydown);
	return {
		destroy() {
			node.removeEventListener("keydown", keydown);
			for (const state of inertStates) state.element.inert = state.inert;
			if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
		},
	};
}
