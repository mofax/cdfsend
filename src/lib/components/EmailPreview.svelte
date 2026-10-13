<script>
	// @ts-check
	import { requestJson } from "../api.js";
	import EmailDetail from "./EmailDetail.svelte";
	/** @type {{orgId:string,id:string,onclose:()=>void}} */
	let { orgId, id, onclose } = $props();
	let email = $derived(
		/** @type {import("../types.js").Email} */ (
			await requestJson(`/api/orgs/${orgId}/emails/${id}`)
		),
	);
</script>

<EmailDetail {email} {onclose} />
