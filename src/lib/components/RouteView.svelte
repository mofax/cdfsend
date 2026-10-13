<script>
	// @ts-check
	import { route } from "../router.js";
	import { session, handleSessionFailure } from "../session.svelte.js";
	import { errorMessage } from "../api.js";
	import PageLoading from "./PageLoading.svelte";

	/** @type {{children:import("svelte").Snippet}} */
	let { children } = $props();
	const organizationPages = ["/", "/app/emails", "/app/domains", "/app/keys", "/app/members"];
</script>

{#if route.pathname === "/app/instance" && !session.current?.user.is_operator}
	<div class="empty panel"><h1>Instance access required</h1></div>
{:else if !session.orgId && organizationPages.includes(route.pathname)}
	<div class="empty panel">
		<h1>No organization memberships</h1>
		<p>Accept an organization invitation to get started.</p>
	</div>
{:else}
	{#key `${route.pathname}:${session.orgId}`}
		<svelte:boundary onerror={handleSessionFailure}>
			{#snippet pending()}<p role="status">Loading page…</p>{/snippet}
			{#snippet failed(cause, reset)}
				<div class="error banner" role="alert">
					{errorMessage(cause)}<button onclick={reset}>Try again</button>
				</div>
			{/snippet}
			<PageLoading />
			{@render children()}
		</svelte:boundary>
	{/key}
{/if}
