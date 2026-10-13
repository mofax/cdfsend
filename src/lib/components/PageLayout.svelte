<script>
	// @ts-check
	import AsyncButton from "./AsyncButton.svelte";
	import { routePath } from "../router.js";
	/** @type {{current:import("../types.js").Me,orgId:string,organization:import("../../../worker/types.js").Organization|undefined,page:string,onselectorg:(id:string)=>void,onsignout:()=>Promise<void>,children:import("svelte").Snippet}} */
	let { current, orgId, organization, page, onselectorg, onsignout, children } = $props();
	// Keep navigation feedback independent of pending page data.
	const navigationOrgId = $derived($state.eager(orgId));
	const navigationOrganization = $derived($state.eager(organization));
	const navigation = /** @type {const} */ ([
		{ id: "overview", path: "/", label: "Overview", icon: "▦" },
		{ id: "emails", path: "/app/emails", label: "Emails", icon: "↗" },
		{ id: "domains", path: "/app/domains", label: "Domains", icon: "◎" },
		{ id: "keys", path: "/app/keys", label: "API keys", icon: "⌘" },
		{ id: "members", path: "/app/members", label: "Members", icon: "♧" },
	]);
</script>

<div class="app-shell">
	<aside class="sidebar">
		<a
			class="wordmark"
			href={routePath("/", { search: { org: navigationOrgId } })}
			aria-label="cdfsend home"><span class="brand-mark">↗</span>cdfsend</a>
		<label class="org-select"
			>ORGANIZATION<select
				aria-label="Organization"
				value={navigationOrgId}
				disabled={!current.organizations.length}
				onchange={(event) => onselectorg(event.currentTarget.value)}
				>{#if !current.organizations.length}<option value="">No memberships yet</option
					>{/if}{#each current.organizations as organization}<option value={organization.id}
						>{organization.name}</option
					>{/each}</select
			></label>
		<nav aria-label="Main navigation">
			{#each navigation as item}<a
					class:active={page === item.id}
					href={routePath(item.path, { search: { org: navigationOrgId } })}
					aria-current={page === item.id ? "page" : undefined}
					aria-disabled={!navigationOrgId}
					onclick={(event) => {
						if (!navigationOrgId) event.preventDefault();
					}}
					><span>{item.icon}</span>{item.label}{#if page === item.id}<i></i>{/if}</a
				>{/each}
			<div class="nav-divider"></div>
			<a
				class:active={page === "guide"}
				href={routePath("/app/guide", { search: { org: navigationOrgId } })}
				><span>⌁</span>Quick start</a>
			<a
				class:active={page === "security"}
				href={routePath("/app/security", { search: { org: navigationOrgId } })}
				><span>◇</span>Security</a>
			{#if current.user.is_operator}<a
					class:active={page === "instance"}
					href={routePath("/app/instance", { search: { org: navigationOrgId } })}
					><span>⚙</span>Instance</a
				>{/if}
		</nav>
		<div class="sidebar-bottom">
			<div class="account">
				<span class="avatar">{current.user.handle.slice(0, 1).toUpperCase()}</span>
				<div>
					<strong>{current.user.handle}</strong><small
						>{navigationOrganization?.role ?? "Instance owner"}</small>
				</div>
				<AsyncButton ariaLabel="Sign out" title="Sign out" onclick={onsignout}>↪</AsyncButton>
			</div>
		</div>
	</aside>
	<div class="workspace">
		<header class="topbar">
			<span
				><span class="muted">Workspace</span><span class="breadcrumb">/</span
				>{navigationOrganization?.name ?? "cdfsend"}</span>
		</header>
		<main class="content">{@render children()}</main>
	</div>
</div>
