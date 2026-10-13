<script>
	import { dialog } from "../dialog.js";
	/** @type {{email:import("../types.js").Email,onclose:()=>void}} */
	let { email, onclose } = $props();
	let tab = $state("html");
	const preview = $derived(
		`<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>body{font:16px system-ui;padding:24px;color:oklch(0.25196 0 0)}img{max-width:100%}</style>${email.html ?? "<p>No HTML body.</p>"}`,
	);
</script>

<div class="overlay">
	<div
		class="dialog email-dialog"
		role="dialog"
		use:dialog={onclose}
		aria-modal="true"
		aria-labelledby="email-title"
		tabindex="-1">
		<div class="section-heading">
			<div>
				<h2 id="email-title">{email.subject || "(No subject)"}</h2>
			</div>
			<button class="icon-button" aria-label="Close email details" onclick={onclose}>×</button>
		</div>
		<div class="detail-grid">
			<span class="muted">From</span><span>{email.from}</span><span class="muted">To</span><span
				>{email.to.join(", ")}</span>
			{#if email.cc.length}<span class="muted">CC</span><span>{email.cc.join(", ")}</span>{/if}
			{#if email.bcc.length}<span class="muted">BCC</span><span>{email.bcc.join(", ")}</span>{/if}
			<span class="muted">Status</span><span class="status {email.cdfsend.status}"
				>{email.cdfsend.status === "sent" ? "Accepted by Cloudflare" : email.cdfsend.status}</span>
			<span class="muted">Created</span><span>{new Date(email.created_at).toLocaleString()}</span>
			<span class="muted">Email ID</span><code>{email.id}</code>
			{#if email.message_id}<span class="muted">Message ID</span><code>{email.message_id}</code
				>{/if}
		</div>
		{#if email.cdfsend.error}<p class="error">{email.cdfsend.error.message}</p>{/if}
		{#if email.attachments.length}<p class="muted">
				Attachments: {email.attachments.map((attachment) => attachment.filename).join(", ")}. File
				content is not retained.
			</p>{/if}
		<div class="segmented">
			<button class:active={tab === "html"} onclick={() => (tab = "html")}>HTML preview</button
			><button class:active={tab === "text"} onclick={() => (tab = "text")}>Plain text</button>
		</div>
		{#if tab === "html"}<iframe
				title="Sandboxed email preview"
				sandbox=""
				referrerpolicy="no-referrer"
				srcdoc={preview}></iframe
			>{:else}<pre class="text-preview">{email.text ?? "No plain-text body."}</pre>{/if}
		<p class="fineprint">
			External images, scripts, forms, and network requests are blocked in this preview.
		</p>
	</div>
</div>
