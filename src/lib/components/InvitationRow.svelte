<script>
	// @ts-check
	import { requestJson } from "../api.js";
	import { createMutation } from "../mutation.svelte.js";
	import { refreshSession } from "../session.svelte.js";
	import MutationFeedback from "./MutationFeedback.svelte";
	/** @type {{invitation:import("../types.js").Invitation,orgId:string}} */
	let { invitation, orgId } = $props();
	const revokeInvitationMutation = createMutation({
		/** @param {{orgId:string,id:string}} input */
		request: (input) => requestJson(`/api/orgs/${input.orgId}/invitations/${input.id}`, "DELETE"),
		onSuccess: refreshSession,
	});
</script>

<div class="resource-row">
	<div class="resource-description">
		<strong>{invitation.handle}</strong>
		<p class="muted">
			{invitation.role} · Expires {new Date(invitation.expires_at).toLocaleString()}
		</p>
		<MutationFeedback mutation={revokeInvitationMutation} />
	</div>
	<button
		class="danger-quiet"
		disabled={revokeInvitationMutation.blocked || revokeInvitationMutation.succeeded}
		onclick={() => revokeInvitationMutation.submit({ orgId, id: invitation.id })}>Revoke</button>
</div>
