<script>
	// @ts-check
	import { untrack } from "svelte";
	import { requestJson } from "../api.js";
	import { createMutation } from "../mutation.svelte.js";
	import MutationFeedback from "./MutationFeedback.svelte";
	import { refreshSession } from "../session.svelte.js";
	import { closeEmailDialogs } from "../email-dialogs.svelte.js";
	import Dialog from "./Dialog.svelte";

	/** @type {{orgId:string,onsent:(id:string)=>void}} */
	let { orgId, onsent } = $props();
	let domains = $derived(
		/** @type {import("../types.js").Page<import("../types.js").Domain>} */ (
			await requestJson(`/api/orgs/${orgId}/domains?limit=100`)
		),
	);
	let from = $state(untrack(() => (domains.data[0] ? `hello@${domains.data[0].name}` : "")));
	let to = $state("");
	let subject = $state("Hello from cdfsend");
	let text = $state("cdfsend test email.");
	const sendKey = crypto.randomUUID();

	const sendEmailMutation = createMutation({
		/** @param {{orgId:string,from:string,to:string,subject:string,text:string}} input */
		request: (input) =>
			/** @type {Promise<{id:string}>} */ (
				requestJson(
					`/api/orgs/${input.orgId}/emails`,
					"POST",
					{ from: input.from, to: input.to, subject: input.subject, text: input.text },
					{ "Idempotency-Key": sendKey },
				)
			),
		onSuccess: async (result, _input, isCurrent) => {
			onsent(result.id);
			await refreshSession();
			if (isCurrent()) closeEmailDialogs();
		},
	});
</script>

<Dialog
	title="Send a test email"
	busy={sendEmailMutation.pending}
	closeLabel="Close composer"
	onclose={closeEmailDialogs}>
	<form
		onsubmit={(event) => {
			event.preventDefault();
			sendEmailMutation.submit({ orgId, from, to, subject, text });
		}}>
		<label>From<input required bind:value={from} placeholder="hello@example.com" /></label>
		<label>To<input type="email" required bind:value={to} placeholder="you@example.com" /></label>
		<label>Subject<input required bind:value={subject} /></label>
		<label>Plain-text message<textarea required rows="5" bind:value={text}></textarea></label>
		<MutationFeedback mutation={sendEmailMutation} />
		<button class="primary wide" disabled={sendEmailMutation.blocked || sendEmailMutation.succeeded}
			>{sendEmailMutation.pending ? "Sending…" : "Send email ↗"}</button>
	</form>
</Dialog>
