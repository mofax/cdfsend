// @ts-check
export const emailDialogs = $state({ emailId: "", composing: false });

/** @param {string} id */
export function openEmail(id) {
	emailDialogs.composing = false;
	emailDialogs.emailId = id;
}

export function openComposer() {
	emailDialogs.emailId = "";
	emailDialogs.composing = true;
}

export function closeEmailDialogs() {
	emailDialogs.emailId = "";
	emailDialogs.composing = false;
}
