<script>
	// @ts-check
	import { requestJson } from "../lib/api.js";
	import EmailHistory from "../lib/components/EmailHistory.svelte";

	import { session } from "../lib/session.svelte.js";
	import { openEmail, openComposer } from "../lib/email-dialogs.svelte.js";
	let result = $derived(
		/** @type {import("../lib/types.js").Page<import("../lib/types.js").Email>} */ (
			await requestJson(`/api/orgs/${session.organization?.id}/emails?limit=20`)
		),
	);

	async function loadMoreEmails() {
		const previous = result;
		const after = previous.data.at(-1)?.id ?? "";
		const cursor = encodeURIComponent(after);
		const next = /** @type {typeof result} */ (
			await requestJson(`/api/orgs/${session.organization?.id}/emails?limit=20&after=${cursor}`)
		);

		if (result === previous) {
			result = { data: previous.data.concat(next.data), has_more: next.has_more };
		}
	}
</script>

<EmailHistory
	emails={result.data}
	hasMore={result.has_more}
	canManage={session.canManage}
	onmore={loadMoreEmails}
	onopen={openEmail}
	oncompose={openComposer} />
