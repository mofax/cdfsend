<script>
	// @ts-check
	import { requestJson } from "../api.js";
	import { createMutation } from "../mutation.svelte.js";
	import { refreshSession } from "../session.svelte.js";
	import Dialog from "./Dialog.svelte";
	import MutationFeedback from "./MutationFeedback.svelte";
	/** @type {{path:string,title:string,label:string,onclose:()=>void,children:import("svelte").Snippet}} */
	let { path, title, label, onclose, children } = $props();
	const removeResourceMutation = createMutation({
		/** @param {string} target */
		request: (target) => requestJson(target, "DELETE"),
		onSuccess: async (_result, _input, isCurrent) => {
			await refreshSession();
			if (isCurrent()) onclose();
		},
	});
</script>

<Dialog {title} busy={removeResourceMutation.pending} {onclose}>
	{@render children()}
	<MutationFeedback mutation={removeResourceMutation} />
	<div class="actions">
		<button disabled={removeResourceMutation.pending} onclick={onclose}>Cancel</button>
		<button
			class="danger"
			disabled={removeResourceMutation.blocked || removeResourceMutation.succeeded}
			onclick={() => removeResourceMutation.submit(path)}>{label}</button>
	</div>
</Dialog>
