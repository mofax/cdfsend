<script>
	// @ts-check
	import { requestJson } from "../lib/api.js";
	import { session, refreshSession } from "../lib/session.svelte.js";
	import { createMutation } from "../lib/mutation.svelte.js";
	import MutationFeedback from "../lib/components/MutationFeedback.svelte";
	import RemoveDialog from "../lib/components/RemoveDialog.svelte";
	import AsyncButton from "../lib/components/AsyncButton.svelte";
	let orgId = $derived(session.orgId);
	let canManage = $derived(session.canManage);
	let result = $derived(
		/** @type {import("../lib/types.js").Page<import("../lib/types.js").Domain>} */ (
			await requestJson(`/api/orgs/${session.organization?.id}/domains?limit=100`)
		),
	);
	let domains = $derived(result.data);
	let hasMore = $derived(result.has_more);

	async function loadMoreDomains() {
		const previous = result;
		const after = previous.data.at(-1)?.id ?? "";
		const cursor = encodeURIComponent(after);
		const next = /** @type {typeof result} */ (
			await requestJson(`/api/orgs/${session.organization?.id}/domains?limit=100&after=${cursor}`)
		);

		if (result === previous) {
			result = { data: previous.data.concat(next.data), has_more: next.has_more };
		}
	}

	let name = $state("");
	let removing = $state("");

	const createDomainMutation = createMutation({
		/** @param {{orgId:string,name:string}} input */
		request: (input) =>
			requestJson(`/api/orgs/${input.orgId}/domains`, "POST", { name: input.name }),
		onSuccess: async (_result, input) => {
			if (name === input.name) name = "";
			await refreshSession();
		},
	});
</script>

<div class="section-heading">
	<div>
		<h1>Domains</h1>
	</div>
</div>
{#if canManage}<form
		class="inline-form panel"
		onsubmit={(event) => {
			event.preventDefault();
			createDomainMutation.submit({ orgId, name });
		}}>
		<label>Domain name<input required bind:value={name} placeholder="example.com" /></label><button
			class="primary"
			disabled={createDomainMutation.blocked}>＋ Add domain</button>
		<MutationFeedback mutation={createDomainMutation} />
	</form>{/if}
<div class="callout">
	Domains are registered here, but sending is configured in your Cloudflare account. The same domain
	may be used by multiple organizations.
</div>
<section class="panel">
	<div class="panel-heading">
		<h3>Registered domains</h3>
		<span class="subtle-tag">{domains.length} loaded</span>
	</div>
	{#if domains.length}<div class="domain-list">
			{#each domains as domain (domain.id)}<div class="resource-row">
					<span class="resource-icon">◎</span>
					<div class="resource-description">
						<h3>{domain.name}</h3>
						<p class="muted">Registered {new Date(domain.created_at).toLocaleDateString()}</p>
					</div>
					<span class="subtle-tag">Cloudflare-managed</span>{#if canManage}<button
							class="danger-quiet"
							onclick={() => (removing = domain.id)}>Remove</button
						>{/if}
				</div>{/each}
		</div>{:else}<div class="empty">
			<span class="empty-symbol">◎</span>
			<h3>No domains registered.</h3>
			<p>Add a domain to start sending from it.</p>
		</div>{/if}
	{#if hasMore}<div class="panel-footer">
			<AsyncButton onclick={loadMoreDomains}>Load more domains</AsyncButton>
		</div>{/if}
</section>
{#if removing}{#key removing}
		<RemoveDialog
			title="Remove this domain?"
			label="Remove domain"
			path={`/api/orgs/${orgId}/domains/${removing}`}
			onclose={() => (removing = "")}>
			<p>
				Its domain-scoped API keys will be revoked. Email history and Cloudflare configuration are
				unchanged.
			</p>
		</RemoveDialog>
	{/key}{/if}
