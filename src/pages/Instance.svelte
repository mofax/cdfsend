<script>
	// @ts-check
	import { requestJson } from "../lib/api.js";
	import { session, refreshSession } from "../lib/session.svelte.js";
	import { createMutation } from "../lib/mutation.svelte.js";
	import MutationFeedback from "../lib/components/MutationFeedback.svelte";
	import CopyButton from "../lib/components/CopyButton.svelte";
	import { navigate } from "../lib/router.js";
	let ownerHandle = $derived.by(() => session.current?.user.handle ?? "");
	let needsOrganization = $derived(!session.orgId);
	let { organizations, users } = $derived(await loadInstance(session.current));

	/** @param {import("../lib/types.js").Me|null} current */
	async function loadInstance(current) {
		if (!current?.user.is_operator) return { organizations: [], users: [] };
		const [organizations, users] = await Promise.all([
			/** @type {Promise<{id:string,name:string}[]>} */ (
				requestJson("/api/instance/organizations")
			),
			/** @type {Promise<{id:string,handle:string,is_operator:number}[]>} */ (
				requestJson("/api/instance/users")
			),
		]);
		return { organizations, users };
	}

	let name = $state("");
	let handle = $state("");
	$effect(() => {
		handle = ownerHandle;
	});
	let organizationLink = $state("");
	let recoveryLink = $state("");
	let recoveryUser = $state("");

	const createOrganizationMutation = createMutation({
		/** @param {{name:string,handle:string}} input */
		request: (input) =>
			/** @type {Promise<{id:string,invitation:{url:string}|null}>} */ (
				requestJson("/api/instance/organizations", "POST", input)
			),
		onSuccess: async (result, input, isCurrent) => {
			organizationLink = result.invitation?.url ?? "";
			if (name === input.name) name = "";
			await refreshSession();
			if (!isCurrent()) return;

			if (session.current?.organizations.some((organization) => organization.id === result.id)) {
				await navigate("/", { search: { org: result.id } });
			}
		},
	});
	const createRecoveryLinkMutation = createMutation({
		/** @param {string} userId */
		request: (userId) =>
			/** @type {Promise<{url:string}>} */ (
				requestJson("/api/instance/recovery", "POST", { userId })
			),
		onSuccess: (result) => {
			recoveryLink = result.url;
		},
	});
</script>

<div class="section-heading">
	<div>
		<h1>Your instance</h1>
	</div>
</div>
{#if needsOrganization}<p>
		Create an organization to use email, domains, and API keys. Your account will be its owner.
	</p>{/if}
<form
	class="panel inline-form"
	onsubmit={(event) => {
		event.preventDefault();
		createOrganizationMutation.submit({ name, handle });
	}}>
	<label>Organization name<input required bind:value={name} placeholder="Acme" /></label><label
		>Owner's account handle<input
			required
			bind:value={handle}
			placeholder="owner@example.com" /></label
	><button class="primary" disabled={createOrganizationMutation.blocked}
		>＋ Create organization</button>
	<MutationFeedback mutation={createOrganizationMutation} />
</form>
{#if organizationLink}<div class="callout">
		<h3>Invitation ready</h3>
		<p>Share privately. For your own account, open this link and accept the invitation.</p>
		<div class="copy-row">
			<input aria-label="Organization invitation link" readonly value={organizationLink} />
			<CopyButton value={organizationLink} />
			<a class="button" href={organizationLink}>Open invitation ↗</a>
			<button onclick={() => (organizationLink = "")}>Dismiss</button>
		</div>
	</div>{/if}
<section class="panel">
	<div class="panel-heading">
		<h3>Organizations</h3>
		<span class="subtle-tag">{organizations.length}</span>
	</div>
	{#if organizations.length}<div class="domain-list">
			{#each organizations as organization}<div class="resource-row">
					<span class="resource-icon">▦</span>
					<div class="resource-description">
						<h3>{organization.name}</h3>
						<code class="muted">{organization.id}</code>
					</div>
				</div>{/each}
		</div>{:else}<div class="empty">
			<h3>No organizations.</h3>
			<p>
				Create one above. Keep your handle to become its owner, or enter another account to invite
				them.
			</p>
		</div>{/if}
</section>
<section class="panel panel-padding">
	<h3>Account recovery</h3>
	<p class="muted">
		Issue a one-use recovery link for an account that lost its passkeys. Redemption replaces its
		passkeys and invalidates all sessions.
	</p>
	<form
		class="inline-form unboxed"
		onsubmit={(event) => {
			event.preventDefault();
			createRecoveryLinkMutation.submit(recoveryUser);
		}}>
		<label
			>Account<select required bind:value={recoveryUser}
				><option value="">Choose an account</option
				>{#each users.filter((user) => !user.is_operator) as user}<option value={user.id}
						>{user.handle}</option
					>{/each}</select
			></label
		><button disabled={createRecoveryLinkMutation.blocked}>Create recovery link</button>
		<MutationFeedback mutation={createRecoveryLinkMutation} />
	</form>
</section>

{#if recoveryLink}<div class="callout">
		<h3>Recovery invitation ready</h3>
		<div class="copy-row">
			<input aria-label="Instance invitation link" readonly value={recoveryLink} />
			<CopyButton value={recoveryLink} />
			<button onclick={() => (recoveryLink = "")}>Dismiss</button>
		</div>
	</div>{/if}
