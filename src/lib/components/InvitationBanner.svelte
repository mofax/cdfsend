<script>
	// @ts-check
	import { session, refreshSession } from "../session.svelte.js";
	import { requestJson, register } from "../api.js";
	import { navigate } from "../router.js";
	import { createMutation } from "../mutation.svelte.js";
	import MutationFeedback from "./MutationFeedback.svelte";
	const acceptInvitationMutation = createMutation({
		/** @param {import("../types.js").InvitationLink} input */
		request: async (input) => {
			if (input.purpose === "recover") {
				await register({ purpose: "recover", token: input.token });
			} else await requestJson("/api/invitations/accept", "POST", { token: input.token });
		},
		onSuccess: async (_result, input, isCurrent) => {
			if (session.invitation?.token === input.token) session.invitation = null;
			await refreshSession();
			if (isCurrent()) await navigate("/", { search: { org: session.orgId } });
		},
	});
</script>

{#if session.invitation}<div class="callout">
		<h3>Invitation to {session.invitation.organization ?? "cdfsend"}</h3>
		<p>For account {session.invitation.handle}.</p>
		<div class="actions">
			<button
				class="primary"
				disabled={acceptInvitationMutation.blocked || acceptInvitationMutation.succeeded}
				onclick={() => session.invitation && acceptInvitationMutation.submit(session.invitation)}>
				{session.invitation.purpose === "recover" ? "Restore account" : "Accept invitation"}
			</button>
			<button
				disabled={acceptInvitationMutation.pending}
				onclick={() => (session.invitation = null)}>Dismiss</button>
		</div>
	</div>{/if}

<MutationFeedback mutation={acceptInvitationMutation} />
