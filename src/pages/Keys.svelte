<script>
	// @ts-check
	import { requestJson } from "../lib/api.js";
	import { session, refreshSession } from "../lib/session.svelte.js";
	import { createMutation } from "../lib/mutation.svelte.js";
	import MutationFeedback from "../lib/components/MutationFeedback.svelte";
	import RemoveDialog from "../lib/components/RemoveDialog.svelte";
	import AsyncButton from "../lib/components/AsyncButton.svelte";
	import CopyButton from "../lib/components/CopyButton.svelte";
	let orgId = $derived(session.orgId);
	let canManage = $derived(session.canManage);
	let data = $derived(await loadKeyPage(session.organization));
	let keys = $derived(data.keys.data);
	let domains = $derived(data.domains.data);
	let hasMore = $derived(data.keys.has_more);

	/** @param {import("../../worker/types.js").Organization|undefined} organization */
	async function loadKeyPage(organization) {
		const [domains, keys] = await Promise.all([
			/** @type {Promise<import("../lib/types.js").Page<import("../lib/types.js").Domain>>} */ (
				requestJson(`/api/orgs/${organization?.id}/domains?limit=100`)
			),
			/** @type {Promise<import("../lib/types.js").Page<import("../lib/types.js").Key>>} */ (
				requestJson(`/api/orgs/${organization?.id}/keys?limit=20`)
			),
		]);
		return { domains, keys };
	}

	async function loadMoreKeys() {
		const previous = data;
		const after = previous.keys.data.at(-1)?.id ?? "";
		const cursor = encodeURIComponent(after);
		const next = /** @type {typeof data.keys} */ (
			await requestJson(`/api/orgs/${session.organization?.id}/keys?limit=20&after=${cursor}`)
		);

		if (data === previous) {
			data = {
				domains: previous.domains,
				keys: { data: previous.keys.data.concat(next.data), has_more: next.has_more },
			};
		}
	}

	let name = $state("");
	let permission = $state("sending_access");
	let domainId = $state("");
	let token = $state("");
	let removing = $state("");

	const createKeyMutation = createMutation({
		/** @param {{orgId:string,name:string,permission:string,domainId:string}} input */
		request: (input) => {
			/** @type {{name:string,permission:string,domain_id?:string}} */
			const body = { name: input.name, permission: input.permission };
			if (input.permission === "sending_access" && input.domainId) body.domain_id = input.domainId;
			return /** @type {Promise<{token:string}>} */ (
				requestJson(`/api/orgs/${input.orgId}/keys`, "POST", body)
			);
		},
		onSuccess: async (result, input) => {
			token = result.token;
			if (name === input.name) name = "";
			await refreshSession();
		},
	});
</script>

<div class="section-heading">
	<div>
		<h1>API keys</h1>
	</div>
</div>
{#if canManage}<form
		class="panel create-key"
		onsubmit={(event) => {
			event.preventDefault();
			createKeyMutation.submit({ orgId, name, permission, domainId });
		}}>
		<label>Key name<input required bind:value={name} placeholder="Production app" /></label><label
			>Permission<select bind:value={permission}
				><option value="sending_access">Sending only</option><option value="full_access"
					>Full organization access</option
				></select
			></label
		><label
			>Sender domain<select bind:value={domainId} disabled={permission === "full_access"}
				><option value="">All organization domains</option>{#each domains as domain}<option
						value={domain.id}>{domain.name}</option
					>{/each}</select
			></label
		><button class="primary" disabled={createKeyMutation.blocked}>＋ Create key</button>
		<MutationFeedback mutation={createKeyMutation} />
	</form>{/if}
{#if token}<section class="callout secret-panel">
		<div class="section-heading">
			<div>
				<h3>Save your API key</h3>
				<p>This token is shown once. Keep it on your server.</p>
			</div>
			<button aria-label="Dismiss API key" onclick={() => (token = "")}>×</button>
		</div>
		<div class="copy-row">
			<input aria-label="New API key" readonly value={token} /><CopyButton value={token} />
		</div>
	</section>{/if}
<section class="panel">
	<div class="panel-heading">
		<h3>Active keys</h3>
	</div>
	{#if keys.length}<div class="table-wrap">
			<table>
				<thead
					><tr><th>Name</th><th>Token prefix</th><th>Permission</th><th>Created</th><th></th></tr
					></thead
				><tbody
					>{#each keys as key (key.id)}<tr
							><td
								><strong>{key.name}</strong><span class="table-secondary"
									>{domains.find((domain) => domain.id === key.domain_id)?.name ??
										"All domains"}</span
								></td
							><td><code>{key.prefix}…</code></td><td
								><span class="subtle-tag"
									>{key.permission === "sending_access" ? "Sending only" : "Full access"}</span
								></td
							><td class="muted">{new Date(key.created_at).toLocaleDateString()}</td><td
								>{#if canManage}<button class="danger-quiet" onclick={() => (removing = key.id)}
										>Revoke</button
									>{/if}</td
							></tr
						>{/each}</tbody>
			</table>
		</div>{:else}<div class="empty">
			<span class="empty-symbol">⌘</span>
			<h3>No API keys.</h3>
			<p>Create a sending key and use it with the official Resend SDK.</p>
		</div>{/if}
	{#if hasMore}<div class="panel-footer">
			<AsyncButton onclick={loadMoreKeys}>Load more keys</AsyncButton>
		</div>{/if}
</section>
{#if removing}{#key removing}
		<RemoveDialog
			title="Revoke this key?"
			label="Revoke API key"
			path={`/api/orgs/${orgId}/keys/${removing}`}
			onclose={() => (removing = "")}>
			<p>Apps using it will lose access immediately. Sends already in progress may finish.</p>
		</RemoveDialog>
	{/key}{/if}
