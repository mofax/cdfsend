<script>
	// @ts-check
	import { requestJson } from "../lib/api.js";
	import { session, refreshSession } from "../lib/session.svelte.js";
	import { createMutation } from "../lib/mutation.svelte.js";
	import MutationFeedback from "../lib/components/MutationFeedback.svelte";
	import RemoveDialog from "../lib/components/RemoveDialog.svelte";
	import CopyButton from "../lib/components/CopyButton.svelte";
	import TeamMemberRow from "../lib/components/TeamMemberRow.svelte";
	import InvitationRow from "../lib/components/InvitationRow.svelte";
	let orgId = $derived(session.orgId);
	let canManage = $derived(session.canManage);
	let isOwner = $derived(session.isOwner);
	let [members, invitations] = $derived(
		await Promise.all([
			/** @type {Promise<import("../lib/types.js").Member[]>} */ (
				requestJson(`/api/orgs/${session.organization?.id}/members`)
			),
			canManage
				? /** @type {Promise<import("../lib/types.js").Invitation[]>} */ (
						requestJson(`/api/orgs/${session.organization?.id}/invitations`)
					)
				: Promise.resolve([]),
		]),
	);
	let handle = $state("");
	let role = $state("member");
	let link = $state("");
	let removing = $state("");

	const createInvitationMutation = createMutation({
		/** @param {{orgId:string,handle:string,role:string}} input */
		request: (input) =>
			/** @type {Promise<{url:string}>} */ (
				requestJson(`/api/orgs/${input.orgId}/invitations`, "POST", {
					handle: input.handle,
					role: input.role,
				})
			),
		onSuccess: async (result, input) => {
			link = result.url;
			if (handle === input.handle) handle = "";
			await refreshSession();
		},
	});
</script>

<div class="section-heading">
	<div>
		<h1>Members</h1>
	</div>
</div>
{#if canManage}<form
		class="panel inline-form"
		onsubmit={(event) => {
			event.preventDefault();
			createInvitationMutation.submit({ orgId, handle, role });
		}}>
		<label
			>Account handle<input
				required
				bind:value={handle}
				placeholder="teammate@example.com" /></label
		><label
			>Role<select bind:value={role}
				><option value="member">Member · read only</option><option value="admin">Admin</option
				>{#if isOwner}<option value="owner">Owner</option>{/if}</select
			></label
		><button class="primary" disabled={createInvitationMutation.blocked}
			>＋ Create invitation</button>
		<MutationFeedback mutation={createInvitationMutation} />
	</form>{/if}
{#if link}<div class="callout">
		<h3>Share this invitation privately</h3>
		<p>One use. Expires in 24 hours.</p>
		<div class="copy-row">
			<input aria-label="Invitation link" readonly value={link} /><CopyButton value={link} /><button
				onclick={() => (link = "")}>Dismiss</button>
		</div>
	</div>{/if}
<section class="panel">
	<div class="panel-heading"><h3>Organization members</h3></div>
	<div class="table-wrap">
		<table>
			<thead><tr><th>Account</th><th>Role</th><th></th></tr></thead><tbody
				>{#each members as member (member.id)}
					<TeamMemberRow
						{member}
						{orgId}
						{canManage}
						{isOwner}
						onremove={(id) => (removing = id)} />
				{/each}</tbody>
		</table>
	</div>
</section>
{#if canManage}<section class="panel">
		<div class="panel-heading"><h3>Pending invitations</h3></div>
		{#if invitations.length}<div class="domain-list">
				{#each invitations as invitation (invitation.id)}
					<InvitationRow {invitation} {orgId} />
				{/each}
			</div>{:else}<p class="panel-padding muted">No pending invitations.</p>{/if}
	</section>{/if}
{#if removing}{#key removing}
		<RemoveDialog
			title="Remove this member?"
			label="Remove member"
			path={`/api/orgs/${orgId}/members/${removing}`}
			onclose={() => (removing = "")}>
			<p>Their access to this organization ends immediately. Other organizations are unaffected.</p>
		</RemoveDialog>
	{/key}{/if}
