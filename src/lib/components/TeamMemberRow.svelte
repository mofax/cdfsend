<script>
	// @ts-check
	import { requestJson } from "../api.js";
	import { createMutation } from "../mutation.svelte.js";
	import { refreshSession } from "../session.svelte.js";
	import MutationFeedback from "./MutationFeedback.svelte";
	/** @type {{member:import("../types.js").Member,orgId:string,canManage:boolean,isOwner:boolean,onremove:(id:string)=>void}} */
	let { member, orgId, canManage, isOwner, onremove } = $props();
	const changeMemberRoleMutation = createMutation({
		/** @param {{orgId:string,userId:string,role:string}} input */
		request: (input) =>
			requestJson(`/api/orgs/${input.orgId}/members`, "PATCH", {
				userId: input.userId,
				role: input.role,
			}),
		onSuccess: refreshSession,
	});
</script>

<tr>
	<td><strong>{member.handle}</strong></td>
	<td>
		{#if canManage && (member.role !== "owner" || isOwner)}
			<select
				aria-label={`Role for ${member.handle}`}
				value={member.role}
				disabled={changeMemberRoleMutation.blocked}
				onchange={(event) => {
					const nextRole = event.currentTarget.value;
					event.currentTarget.value = member.role;
					changeMemberRoleMutation.submit({ orgId, userId: member.id, role: nextRole });
				}}>
				<option value="member">Member</option><option value="admin">Admin</option>
				{#if isOwner}<option value="owner">Owner</option>{/if}
			</select>
			<MutationFeedback mutation={changeMemberRoleMutation} />
		{:else}<span class="subtle-tag">{member.role}</span>{/if}
	</td>
	<td
		>{#if canManage && (member.role !== "owner" || isOwner)}
			<button class="danger-quiet" onclick={() => onremove(member.id)}>Remove</button>
		{/if}</td>
</tr>
