<script>
	// @ts-check
	import { dialog } from "../dialog.js";
	/** @type {{title:string,busy?:boolean,closeLabel?:string,onclose:()=>void,children:import("svelte").Snippet}} */
	let { title, busy = false, closeLabel = "Close dialog", onclose, children } = $props();
	const titleId = crypto.randomUUID();
</script>

<div class="overlay">
	<div
		class="dialog small"
		role="dialog"
		aria-modal="true"
		aria-labelledby={titleId}
		tabindex="-1"
		use:dialog={() => {
			if (!busy) onclose();
		}}>
		<div class="section-heading">
			<div><h2 id={titleId}>{title}</h2></div>
			<button aria-label={closeLabel} disabled={busy} onclick={onclose}>×</button>
		</div>
		{@render children()}
	</div>
</div>
