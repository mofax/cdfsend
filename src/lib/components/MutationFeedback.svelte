<script>
	// @ts-check
	/** @type {{mutation:{pending:boolean,error:string,refreshError:string,needsVerification:boolean,verifyAndRetry:()=>Promise<void>,cancelVerification:()=>void}}} */
	let { mutation } = $props();
</script>

{#if mutation.error || mutation.refreshError || mutation.needsVerification}
	<div class="mutation-feedback">
		{#if mutation.error}<p class="error" role="alert">{mutation.error}</p>{/if}
		{#if mutation.refreshError}<p class="error" role="alert">
				The change succeeded, but refreshing failed: {mutation.refreshError} Use Refresh or reload to
				update the page.
			</p>{/if}
		{#if mutation.needsVerification}
			<div class="callout">
				<p>This change needs a recent passkey verification.</p>
				<div class="actions">
					<button type="button" disabled={mutation.pending} onclick={mutation.cancelVerification}
						>Cancel verification</button>
					<button
						type="button"
						class="primary"
						disabled={mutation.pending}
						onclick={mutation.verifyAndRetry}>Verify and continue</button>
				</div>
			</div>
		{/if}
	</div>
{/if}
