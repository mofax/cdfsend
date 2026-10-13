<script>
	// @ts-check
	import { register } from "../lib/api.js";
	import { session, refreshSession } from "../lib/session.svelte.js";
	import { createMutation } from "../lib/mutation.svelte.js";
	import MutationFeedback from "../lib/components/MutationFeedback.svelte";
	import RemoveDialog from "../lib/components/RemoveDialog.svelte";
	let credentials = $derived.by(() => session.current?.credentials ?? []);
	let label = $state("");
	let removing = $state("");

	const addPasskeyMutation = createMutation({
		/** @param {string} input */
		request: (input) => register({ purpose: "add" }, input),
		onSuccess: async (_result, input) => {
			if (label === input) label = "";
			await refreshSession();
		},
	});
</script>

<div class="section-heading">
	<div>
		<h1>Security</h1>
	</div>
</div>
<form
	class="panel inline-form"
	onsubmit={(event) => {
		event.preventDefault();
		addPasskeyMutation.submit(label);
	}}>
	<label>Passkey label<input required bind:value={label} placeholder="Backup security key" /></label
	><button class="primary" disabled={addPasskeyMutation.blocked}>＋ Add passkey</button>
	<MutationFeedback mutation={addPasskeyMutation} />
</form>
<section class="panel">
	<div class="panel-heading"><h3>Registered passkeys</h3></div>
	<div class="domain-list">
		{#each credentials as credential}<div class="resource-row">
				<span class="resource-icon">⌘</span>
				<div class="resource-description">
					<h3>{credential.label}</h3>
					<p class="muted">Added {new Date(credential.created_at).toLocaleDateString()}</p>
				</div>
				<button
					class="danger-quiet"
					disabled={credentials.length < 2}
					onclick={() => (removing = credential.id)}>Remove</button>
			</div>{/each}
	</div>
</section>
<div class="callout">
	Sessions expire after 12 hours. Sensitive changes require a passkey verification within the last
	five minutes. Account recovery is handled by the instance owner.
</div>
{#if removing}{#key removing}
		<RemoveDialog
			title="Remove this passkey?"
			label="Remove passkey"
			path={`/api/account/credentials/${encodeURIComponent(removing)}`}
			onclose={() => (removing = "")}>
			<p>Other sessions will be signed out. Keep a backup passkey you can access.</p>
		</RemoveDialog>
	{/key}{/if}
