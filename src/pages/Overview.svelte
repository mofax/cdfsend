<script>
	// @ts-check
	import EmailHistory from "../lib/components/EmailHistory.svelte";
	import { requestJson } from "../lib/api.js";
	import { session, refreshSession } from "../lib/session.svelte.js";
	import AsyncButton from "../lib/components/AsyncButton.svelte";
	import { openEmail, openComposer } from "../lib/email-dialogs.svelte.js";
	import { navigate } from "../lib/router.js";
	let result = $derived(
		/** @type {import("../lib/types.js").Page<import("../lib/types.js").Email>} */ (
			await requestJson(`/api/orgs/${session.organization?.id}/emails?limit=20`)
		),
	);
	let accepted = $derived(result.data.filter((email) => email.cdfsend.status === "sent").length);
	let failed = $derived(result.data.filter((email) => email.cdfsend.status === "failed").length);
</script>

<div class="section-heading">
	<div>
		<h1>Overview</h1>
	</div>
	<AsyncButton onclick={refreshSession}>↻ Refresh</AsyncButton>
</div>
<div class="stats-grid">
	<section class="panel stat">
		<span class="muted">Recent emails</span><strong>{result.data.length}</strong><small
			>Latest 20 retained attempts</small>
	</section>
	<section class="panel stat">
		<span class="muted">Accepted</span><strong>{accepted}<span class="stat-accent">↗</span></strong
		><small>Among recent attempts</small>
	</section>
	<section class="panel stat">
		<span class="muted">Failed</span><strong>{failed}</strong><small>Among recent attempts</small>
	</section>
</div>
<EmailHistory
	emails={result.data}
	hasMore={result.has_more}
	canManage={session.canManage}
	onmore={() => navigate("/app/emails", { search: { org: session.orgId } })}
	onopen={openEmail}
	oncompose={openComposer} />
