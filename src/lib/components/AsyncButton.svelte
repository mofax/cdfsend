<script>
	// @ts-check
	import { onDestroy } from "svelte";
	import { errorMessage, RequestFailure } from "../api.js";
	import { session, expireSession } from "../session.svelte.js";
	/** @type {{onclick:()=>Promise<unknown>,children:import("svelte").Snippet,ariaLabel?:string,title?:string}} */
	let { onclick, children, ariaLabel = undefined, title = undefined } = $props();
	let pending = $state(false);
	let error = $state("");
	let alive = true;
	onDestroy(() => {
		alive = false;
	});

	async function handleClick() {
		if (pending) return;
		const generation = session.generation;
		pending = true;
		error = "";

		try {
			await onclick();
		} catch (cause) {
			if (cause instanceof RequestFailure && cause.status === 401) expireSession(generation);
			if (alive) error = errorMessage(cause);
		} finally {
			if (alive) pending = false;
		}
	}
</script>

<button
	aria-label={ariaLabel}
	{title}
	type="button"
	disabled={pending}
	onclick={handleClick}
	aria-busy={pending}>{@render children()}</button>
{#if error}<p class="error" role="alert">{error}</p>{/if}
