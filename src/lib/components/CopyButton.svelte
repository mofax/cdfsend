<script>
	// @ts-check
	import AsyncButton from "./AsyncButton.svelte";
	/** @type {{value:string}} */
	let { value } = $props();
</script>

<AsyncButton onclick={() => navigator.clipboard.writeText(value)}>Copy</AsyncButton>
