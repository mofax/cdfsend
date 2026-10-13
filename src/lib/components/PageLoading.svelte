<script>
	// @ts-check
	const loading = $derived($effect.pending());
</script>

{#if loading}<p role="status">Updating page…</p>{/if}
