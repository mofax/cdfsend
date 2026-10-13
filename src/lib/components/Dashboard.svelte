<script>
	// @ts-check
	import { untrack } from "svelte";
	import { navigate, route } from "../router.js";
	import { session, signOut } from "../session.svelte.js";
	import { errorMessage } from "../api.js";
	import { closeEmailDialogs } from "../email-dialogs.svelte.js";
	import SessionGate from "./SessionGate.svelte";
	import PageLayout from "./PageLayout.svelte";
	import RouteView from "./RouteView.svelte";
	import InvitationBanner from "./InvitationBanner.svelte";
	import EmailDialogs from "./EmailDialogs.svelte";

	/** @type {{children:import("svelte").Snippet}} */
	let { children: routeContent } = $props();
	const orgId = $derived(session.orgId);
	const generation = $derived(session.generation);
	let navigationError = $state("");
	const page = $derived.by(() => {
		if (route.pathname === "/") return "overview";
		return route.pathname.split("/").at(-1) ?? "";
	});

	$effect(() => {
		void route.pathname;
		void orgId;
		void generation;
		untrack(() => {
			navigationError = "";
			closeEmailDialogs();
		});
	});

	/** @param {string} id */
	async function selectOrganization(id) {
		try {
			await navigate("/", { search: { org: id } });
		} catch (cause) {
			navigationError = errorMessage(cause);
		}
	}
</script>

<SessionGate>
	{#snippet children(current)}
		<PageLayout
			{current}
			{orgId}
			organization={session.organization}
			{page}
			onselectorg={selectOrganization}
			onsignout={signOut}>
			{#if navigationError}<p class="error" role="alert">{navigationError}</p>{/if}
			<InvitationBanner />
			<EmailDialogs />
			<RouteView>{@render routeContent()}</RouteView>
		</PageLayout>
	{/snippet}
</SessionGate>
