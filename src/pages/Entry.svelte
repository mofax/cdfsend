<script>
	import { requestJson, register, authenticate, errorMessage } from "../lib/api.js";
	/** @type {{onready:()=>Promise<void>, status:{bootstrapped:boolean}, invitation:{token:string,purpose:string,handle:string,organization:string|null,existing:boolean}|null}} */
	let { onready, status, invitation } = $props();
	let handle = $state("");
	$effect(() => {
		if (invitation) handle = invitation.handle;
	});
	let busy = $state(false);
	let error = $state("");
	const setup = $derived.by(() => !status.bootstrapped && !invitation);
	const heading = $derived.by(() => {
		if (setup) return "Create instance owner";
		return "Sign in";
	});
	const submitLabel = $derived.by(() => {
		if (busy) return "Waiting for your passkey…";
		if (setup) return "Create instance owner ↗";
		if (invitation?.purpose === "recover") return "Restore with a passkey ↗";
		if (invitation && !invitation.existing) return "Join with a passkey ↗";
		return "Continue with a passkey ↗";
	});

	async function submit() {
		busy = true;
		error = "";

		try {
			if (setup) {
				await register({ purpose: "bootstrap", handle });
			} else if (invitation && (!invitation.existing || invitation.purpose === "recover")) {
				await register({ purpose: invitation.purpose, token: invitation.token });
			} else {
				await authenticate(handle);

				if (invitation) {
					await requestJson("/api/invitations/accept", "POST", { token: invitation.token });
				}
			}

			await onready();
		} catch (cause) {
			error = errorMessage(cause);
		} finally {
			busy = false;
		}
	}
</script>

<main class="entry">
	<section class="entry-form">
		<div class="entry-card">
			<div class="entry-brand"><span class="brand-mark">↗</span> cdfsend</div>
			<h2>{heading}</h2>
			{#if invitation}<div class="callout">
					{invitation.purpose === "recover"
						? "Restore your account with a new passkey."
						: `You're invited to ${invitation.organization ?? "cdfsend"}.`}
				</div>{/if}
			<form
				onsubmit={(event) => {
					event.preventDefault();
					submit();
				}}>
				<label
					>Account handle<input
						required
						autocomplete="username webauthn"
						bind:value={handle}
						disabled={Boolean(invitation)}
						placeholder="you@example.com" /></label>
				{#if error}<p class="error" role="alert">{error}</p>{/if}
				<button class="primary wide" disabled={busy}>{submitLabel}</button>
			</form>
		</div>
	</section>
</main>
