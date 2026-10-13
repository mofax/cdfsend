<script>
	// @ts-check
	import { onMount } from "svelte";
	import { session, initializeSession, completeSignIn } from "../session.svelte.js";
	import Entry from "../../pages/Entry.svelte";

	/** @type {{children:import("svelte").Snippet<[import("../types.js").Me]>}} */
	let { children } = $props();

	onMount(() => {
		void initializeSession();
		const changed = () => void initializeSession();
		window.addEventListener("hashchange", changed);
		return () => window.removeEventListener("hashchange", changed);
	});
</script>

{#if !session.ready}
	<main class="loading">
		<span class="brand-mark">↗</span>
		<p>Opening cdfsend…</p>
	</main>
{:else if !session.current}
	{#if session.error}<div class="global-error" role="alert">{session.error}</div>{/if}
	<Entry status={session.status} invitation={session.invitation} onready={completeSignIn} />
{:else}
	{@render children(session.current)}
{/if}
