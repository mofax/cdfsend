<script>
	// @ts-check
	import AsyncButton from "./AsyncButton.svelte";
	/** @type {{emails:import("../types.js").Email[],hasMore:boolean,onmore:()=>Promise<unknown>,onopen:(id:string)=>void,oncompose:()=>void,canManage:boolean}} */
	let { emails, hasMore, onmore, onopen, oncompose, canManage } = $props();
</script>

<div class="section-heading">
	<div>
		<h1>Emails</h1>
	</div>
	{#if canManage}<button class="primary" onclick={oncompose}>＋ Send test email</button>{/if}
</div>
<section class="panel">
	<div class="panel-heading">
		<h3>Sending history</h3>
		<span class="subtle-tag">Cloudflare acceptance · not delivery</span>
	</div>
	{#if emails.length}
		<div class="table-wrap">
			<table>
				<thead
					><tr><th>Subject / recipient</th><th>From</th><th>Status</th><th>Created</th><th></th></tr
					></thead
				><tbody>
					{#each emails as email (email.id)}<tr
							><td
								><button class="text-link subject" onclick={() => onopen(email.id)}
									>{email.subject || "(No subject)"}</button
								><span class="table-secondary">{email.to.join(", ")}</span></td
							><td>{email.from}</td><td
								><span class="status {email.cdfsend.status}"
									>{email.cdfsend.status === "sent" ? "Accepted" : email.cdfsend.status}</span
								></td
							><td class="muted nowrap">{new Date(email.created_at).toLocaleString()}</td><td
								><button
									class="text-link"
									aria-label={`View ${email.subject}`}
									onclick={() => onopen(email.id)}>↗</button
								></td
							></tr
						>{/each}
				</tbody>
			</table>
		</div>
	{:else}<div class="empty">
			<span class="empty-symbol">↗</span>
			<h3>No emails yet.</h3>
			<p>Send your first email with the Resend SDK or a test send.</p>
		</div>{/if}
	{#if hasMore}<div class="panel-footer">
			<AsyncButton onclick={onmore}>Load more emails</AsyncButton>
		</div>{/if}
</section>
