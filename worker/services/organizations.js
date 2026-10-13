// @ts-check
import { z } from "zod";
import { organization, invite, membership, id } from "../../shared/schema.js";
import { fail, parse } from "../lib/http.js";
import { statement, write, audit, commit } from "../storage/db.js";
import { requireManagement, requireRecent, requireSession } from "../security/access.js";
import { hash, randomToken } from "../security/crypto.js";
import { invitationForToken } from "./auth.js";
import { requireOrigin } from "../security/origin.js";

/** @param {Request} request @param {import("../types.js").AppBindings} env */
export async function requireOperator(request, env) {
	const current = await requireSession(request, env);
	if (!current.user.is_operator) fail(403, "restricted_api_key", "Instance owner access required");
	requireRecent(current.session);
	return current;
}

/** @param {Request} request @param {import("../types.js").Transaction} tx @param {string|null} orgId @param {string} accountHandle @param {"owner"|"admin"|"member"} assignedRole @param {string} [purpose] @param {string|null} [userId] */
async function queueInvitation(
	request,
	tx,
	orgId,
	accountHandle,
	assignedRole,
	purpose = "invite",
	userId = null,
) {
	const site = requireOrigin(request);
	const token = randomToken();
	const id = crypto.randomUUID();
	const tokenHash = await hash(token);
	const expiresAt = Date.now() + 24 * 3600_000;
	write(
		tx,
		"INSERT INTO invitations(id,token_hash,handle,org_id,role,purpose,user_id,expires_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)",
		id,
		tokenHash,
		accountHandle,
		orgId,
		assignedRole,
		purpose,
		userId,
		expiresAt,
		Date.now(),
	);
	return {
		id,
		url: `${site.origin}/#${purpose}=${token}`,
		expires_at: new Date(expiresAt).toISOString(),
	};
}

/** @param {Request} request @param {import("../types.js").Transaction} tx @param {unknown} raw */
export async function createOrganization(request, tx, raw) {
	const operator = await requireOperator(request, tx.env);
	const input = parse(organization, raw);
	const orgId = crypto.randomUUID();
	write(
		tx,
		"INSERT INTO organizations(id,name,created_at) VALUES(?,?,?)",
		orgId,
		input.name,
		Date.now(),
	);
	let invitation = null;
	if (input.handle === operator.user.handle) {
		write(
			tx,
			"INSERT INTO memberships(org_id,user_id,role) VALUES(?,?,'owner')",
			orgId,
			operator.user.id,
		);
	} else invitation = await queueInvitation(request, tx, orgId, input.handle, "owner");
	write(
		tx,
		"INSERT INTO audit(org_id,actor_id,action,target_id,created_at) VALUES(?,?,'organization.create',?,?)",
		orgId,
		operator.user.id,
		orgId,
		Date.now(),
	);
	await commit(tx);
	return { id: orgId, invitation };
}

/** @param {import("../types.js").Actor} actor */
function requireDashboardAdmin(actor) {
	requireManagement(actor);
	if (!actor.userId) fail(403, "restricted_api_key", "Dashboard session required");
	requireRecent(actor);
}

/** @param {Request} request @param {import("../types.js").Transaction} tx @param {import("../types.js").Actor} actor @param {unknown} raw */
export async function inviteMember(request, tx, actor, raw) {
	requireDashboardAdmin(actor);
	const input = parse(invite, raw);

	if (input.role === "owner" && actor.role !== "owner") {
		fail(403, "restricted_api_key", "Only owners can invite owners");
	}

	const member = await statement(
		tx.env,
		"SELECT m.user_id FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=? AND u.handle=?",
		actor.orgId,
		input.handle,
	).first();
	if (member) fail(409, "conflict", "Account already belongs to this organization");
	const invitation = await queueInvitation(request, tx, actor.orgId, input.handle, input.role);
	audit(tx, actor, "member.invite", invitation.id);
	return invitation;
}

/** @param {Request} request @param {import("../types.js").Transaction} tx @param {unknown} raw */
export async function acceptInvitation(request, tx, raw) {
	const input = parse(z.object({ token: z.string().min(16).max(256) }).strict(), raw);
	const current = await requireSession(request, tx.env);
	requireRecent(current.session);
	const invitation = await invitationForToken(tx.env, input.token);

	if (invitation.purpose !== "invite" || invitation.handle !== current.user.handle) {
		fail(403, "restricted_api_key", "Invitation belongs to another account");
	}

	write(
		tx,
		"INSERT INTO memberships(org_id,user_id,role) VALUES(?,?,?) ON CONFLICT(org_id,user_id) DO NOTHING",
		invitation.org_id,
		current.user.id,
		invitation.role,
	);
	write(tx, "DELETE FROM invitations WHERE id=?", invitation.id);
	await commit(tx);
	return { ok: true };
}

/** @param {Request} request @param {import("../types.js").Transaction} tx @param {unknown} raw */
export async function recoveryInvitation(request, tx, raw) {
	const current = await requireOperator(request, tx.env);
	const input = parse(z.object({ userId: id }).strict(), raw);
	const user = /** @type {import("../types.js").User|null} */ (
		await statement(tx.env, "SELECT * FROM users WHERE id=?", input.userId).first()
	);
	if (!user) fail(404, "not_found", "Account not found");

	if (user.is_operator) {
		fail(403, "restricted_api_key", "Enroll a backup passkey for the instance owner");
	}

	write(tx, "DELETE FROM invitations WHERE purpose='recover' AND user_id=?", user.id);
	const invitation = await queueInvitation(
		request,
		tx,
		null,
		user.handle,
		"member",
		"recover",
		user.id,
	);
	write(
		tx,
		"INSERT INTO audit(actor_id,action,target_id,created_at) VALUES(?,'account.recovery',?,?)",
		current.user.id,
		user.id,
		Date.now(),
	);
	await commit(tx);
	return invitation;
}

/** @param {import("../types.js").AppBindings} env @param {import("../types.js").Actor} actor */
export async function members(env, actor) {
	const result = await statement(
		env,
		"SELECT u.id,u.handle,m.role FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.org_id=? ORDER BY u.handle",
		actor.orgId,
	).all();
	return result.results;
}

/** @param {import("../types.js").AppBindings} env @param {import("../types.js").Actor} actor @param {string} userId */
async function memberRole(env, actor, userId) {
	const row = /** @type {{role: string}|null} */ (
		await statement(
			env,
			"SELECT role FROM memberships WHERE org_id=? AND user_id=?",
			actor.orgId,
			userId,
		).first()
	);
	if (!row) fail(404, "not_found", "Member not found");
	return row.role;
}

/** @param {import("../types.js").AppBindings} env @param {import("../types.js").Actor} actor @param {string} previousRole @param {string|null} nextRole */
async function guardOwner(env, actor, previousRole, nextRole) {
	const changesOwner = previousRole === "owner" || nextRole === "owner";

	if (changesOwner && actor.role !== "owner") {
		fail(403, "restricted_api_key", "Only owners can change owners");
	}

	if (previousRole !== "owner" || nextRole === "owner") return;
	const owners = await statement(
		env,
		"SELECT COUNT(*) AS count FROM memberships WHERE org_id=? AND role='owner'",
		actor.orgId,
	).first("count");
	if (Number(owners) < 2) fail(409, "conflict", "Organization must keep an owner");
}

/** @param {import("../types.js").Transaction} tx @param {import("../types.js").Actor} actor @param {unknown} raw */
export async function changeMember(tx, actor, raw) {
	requireDashboardAdmin(actor);
	const input = parse(membership, raw);
	const previousRole = await memberRole(tx.env, actor, input.userId);
	await guardOwner(tx.env, actor, previousRole, input.role);
	write(
		tx,
		"UPDATE memberships SET role=? WHERE org_id=? AND user_id=?",
		input.role,
		actor.orgId,
		input.userId,
	);
	audit(tx, actor, "member.role", input.userId);
	return { ok: true };
}

/** @param {import("../types.js").Transaction} tx @param {import("../types.js").Actor} actor @param {string} userId */
export async function removeMember(tx, actor, userId) {
	requireDashboardAdmin(actor);
	parse(id, userId);
	const previousRole = await memberRole(tx.env, actor, userId);
	await guardOwner(tx.env, actor, previousRole, null);
	write(tx, "DELETE FROM memberships WHERE org_id=? AND user_id=?", actor.orgId, userId);
	// Account and its access to other organizations remain intact.
	audit(tx, actor, "member.remove", userId);
	return { deleted: true };
}

/** @param {import("../types.js").AppBindings} env @param {import("../types.js").Actor} actor */
export async function invitations(env, actor) {
	requireManagement(actor);
	return (
		await statement(
			env,
			"SELECT id,handle,role,purpose,expires_at,created_at FROM invitations WHERE org_id=? AND expires_at>? ORDER BY created_at DESC",
			actor.orgId,
			Date.now(),
		).all()
	).results;
}

/** @param {import("../types.js").Transaction} tx @param {import("../types.js").Actor} actor @param {string} invitationId */
export async function revokeInvitation(tx, actor, invitationId) {
	requireDashboardAdmin(actor);
	const row = await statement(
		tx.env,
		"SELECT id FROM invitations WHERE org_id=? AND id=?",
		actor.orgId,
		invitationId,
	).first();
	if (!row) fail(404, "not_found", "Invitation not found");
	write(tx, "DELETE FROM invitations WHERE org_id=? AND id=?", actor.orgId, invitationId);
	audit(tx, actor, "invitation.revoke", invitationId);
	return { deleted: true };
}
