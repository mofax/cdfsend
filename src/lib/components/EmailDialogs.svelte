<script>
	// @ts-check
	import { untrack } from "svelte";
	import { route } from "../router.js";
	import { session, handleSessionFailure } from "../session.svelte.js";
	import { emailDialogs, closeEmailDialogs } from "../email-dialogs.svelte.js";
	import { errorMessage } from "../api.js";
	import Dialog from "./Dialog.svelte";
	import EmailPreview from "./EmailPreview.svelte";
	import EmailComposer from "./EmailComposer.svelte";
	const title = $derived.by(() => {
		if (emailDialogs.composing) return "Send a test email";
		return "Opening email";
	});
	const noticeContext = $derived(`${session.generation}:${session.orgId}:${route.pathname}`);
	let notice = $state("");
	$effect(() => {
		void noticeContext;
		untrack(() => {
			notice = "";
		});
	});
</script>

{#if notice}<div class="success banner" role="status">
		{notice}<button aria-label="Dismiss notification" onclick={() => (notice = "")}>×</button>
	</div>{/if}

{#if emailDialogs.emailId || emailDialogs.composing}
	{#key `${session.orgId}:${emailDialogs.emailId}:${emailDialogs.composing}`}
		<svelte:boundary onerror={handleSessionFailure}>
			{#snippet pending()}
				<Dialog {title} onclose={closeEmailDialogs}><p role="status">Loading…</p></Dialog>
			{/snippet}
			{#snippet failed(cause, reset)}
				<Dialog {title} onclose={closeEmailDialogs}>
					<p class="error" role="alert">{errorMessage(cause)}</p>
					<button onclick={reset}>Try again</button>
				</Dialog>
			{/snippet}
			{#if emailDialogs.emailId}
				<EmailPreview orgId={session.orgId} id={emailDialogs.emailId} onclose={closeEmailDialogs} />
			{:else}
				<EmailComposer
					orgId={session.orgId}
					onsent={(id) => (notice = `Cloudflare accepted your email. ID: ${id}`)} />
			{/if}
		</svelte:boundary>
	{/key}
{/if}
