// @ts-check
import {
	generateRegistrationOptions,
	verifyRegistrationResponse,
	generateAuthenticationOptions,
	verifyAuthenticationResponse,
} from "@simplewebauthn/server";
import { z } from "zod";
import { registration, finishPasskey, handle } from "../../shared/schema.js";
import { fail, parse, json } from "../lib/http.js";
import { statement, write, commit } from "../storage/db.js";
import { hash, randomToken } from "../security/crypto.js";
import { requireSession, requireRecent, sessionCookie, sessionToken } from "../security/access.js";
import { requireOrigin, requireCeremonyOrigin } from "../security/origin.js";

/** @param {import("../types.js").AppBindings} env */
export async function authStatus(env) {
	const setup = await statement(env, "SELECT value FROM settings WHERE key='bootstrapped'").first();
	return { bootstrapped: Boolean(setup) };
}

/** @param {import("../types.js").AppBindings} env @param {string} token */
export async function invitationForToken(env, token) {
	const tokenHash = await hash(token);
	const invitation = /** @type {import("../types.js").Invitation|null} */ (
		await statement(
			env,
			"SELECT * FROM invitations WHERE token_hash=? AND expires_at>?",
			tokenHash,
			Date.now(),
		).first()
	);
	if (!invitation) fail(404, "not_found", "Invitation expired or already used");
	return invitation;
}

/** @param {import("../types.js").AppBindings} env @param {unknown} raw */
export async function inspectInvitation(env, raw) {
	const input = parse(z.object({ token: z.string().min(16).max(256) }).strict(), raw);
	const invitation = await invitationForToken(env, input.token);
	const existing = await statement(
		env,
		"SELECT id FROM users WHERE handle=?",
		invitation.handle,
	).first();
	const name = invitation.org_id
		? await statement(env, "SELECT name FROM organizations WHERE id=?", invitation.org_id).first(
				"name",
			)
		: null;
	return {
		handle: invitation.handle,
		purpose: invitation.purpose,
		organization: name,
		existing: Boolean(existing),
	};
}

/** @param {Request} request @param {import("../types.js").AppBindings} env @param {z.infer<typeof registration>} input */
async function registrationSubject(request, env, input) {
	if (input.purpose === "add") {
		const current = await requireSession(request, env);
		requireRecent(current.session);
		return {
			userId: current.user.id,
			handle: current.user.handle,
			invitationId: null,
			sessionHash: current.sessionHash,
		};
	}

	if (input.purpose === "bootstrap") return bootstrapSubject(env, input);
	const invitationToken = input.token ?? "";
	const invitation = await invitationForToken(env, invitationToken);

	if (input.purpose !== invitation.purpose) {
		fail(403, "restricted_api_key", "Invitation purpose mismatch");
	}

	const existing = await statement(
		env,
		"SELECT id FROM users WHERE handle=?",
		invitation.handle,
	).first("id");

	if (input.purpose === "invite" && existing) {
		fail(409, "existing_account", "Sign in with your existing passkey to accept this invitation");
	}

	const userId = invitation.user_id ?? crypto.randomUUID();
	return { userId, handle: invitation.handle, invitationId: invitation.id, sessionHash: null };
}

/** @param {import("../types.js").AppBindings} env @param {z.infer<typeof registration>} input */
async function bootstrapSubject(env, input) {
	const status = await authStatus(env);
	if (status.bootstrapped) fail(403, "restricted_api_key", "Instance is already configured");
	const accountHandle = parse(handle, input.handle);
	return {
		userId: crypto.randomUUID(),
		handle: accountHandle,
		invitationId: null,
		sessionHash: null,
	};
}

/** @param {Request} request @param {import("../types.js").AppBindings} env @param {unknown} raw */
export async function beginRegistration(request, env, raw) {
	const site = requireOrigin(request);
	const input = parse(registration, raw);
	const subject = await registrationSubject(request, env, input);
	const credentials = await userCredentials(env, subject.userId);
	const options = await generateRegistrationOptions({
		rpName: "cdfsend",
		rpID: site.rpId,
		userName: subject.handle,
		userID: new TextEncoder().encode(subject.userId),
		attestationType: "none",
		excludeCredentials: credentials.map((credential) => ({ id: credential.id })),
		authenticatorSelection: { residentKey: "required", userVerification: "required" },
	});
	const ceremonyId = crypto.randomUUID();
	const expiresAt = Date.now() + 5 * 60_000;
	await statement(
		env,
		"INSERT INTO challenges(id,challenge,purpose,user_id,invitation_id,handle,session_hash,origin,expires_at) VALUES(?,?,?,?,?,?,?,?,?)",
		ceremonyId,
		options.challenge,
		input.purpose,
		subject.userId,
		subject.invitationId,
		subject.handle,
		subject.sessionHash,
		site.origin,
		expiresAt,
	).run();
	return { ceremonyId, options };
}

/** Burn a ceremony before signature verification; verification never admits replay. @param {import("../types.js").AppBindings} env @param {string} ceremonyId */
async function consumeCeremony(env, ceremonyId) {
	const ceremony = /** @type {import("../types.js").Ceremony|null} */ (
		await statement(
			env,
			"DELETE FROM challenges WHERE id=? AND expires_at>? RETURNING *",
			ceremonyId,
			Date.now(),
		).first()
	);
	if (!ceremony) fail(403, "validation_error", "Passkey challenge expired or already used");
	return ceremony;
}

/** @param {import("../types.js").AppBindings} env @param {string} userId */
async function userCredentials(env, userId) {
	const rows = await statement(env, "SELECT * FROM credentials WHERE user_id=?", userId).all();
	return /** @type {import("../types.js").Credential[]} */ (rows.results);
}

/** @param {import("../types.js").Transaction} tx @param {import("../types.js").Ceremony} ceremony */
async function registrationWrites(tx, ceremony) {
	if (!ceremony.user_id || !ceremony.handle) {
		fail(403, "validation_error", "Invalid registration ceremony");
	}

	if (ceremony.purpose === "bootstrap") {
		if ((await authStatus(tx.env)).bootstrapped) {
			fail(409, "conflict", "Instance already configured");
		}

		write(
			tx,
			"INSERT INTO users(id,handle,is_operator,created_at) VALUES(?,?,1,?)",
			ceremony.user_id,
			ceremony.handle,
			Date.now(),
		);
		write(tx, "INSERT INTO settings(key,value) VALUES('bootstrapped','1')");
		bootstrapOrganization(tx, ceremony.user_id);
		return;
	}

	if (ceremony.purpose === "add") return;
	const invitation = /** @type {import("../types.js").Invitation|null} */ (
		await statement(
			tx.env,
			"SELECT * FROM invitations WHERE id=? AND expires_at>?",
			ceremony.invitation_id,
			Date.now(),
		).first()
	);
	if (!invitation) fail(403, "validation_error", "Invitation expired or already used");

	if (ceremony.purpose === "recover") {
		write(tx, "DELETE FROM credentials WHERE user_id=?", ceremony.user_id);
		write(tx, "DELETE FROM sessions WHERE user_id=?", ceremony.user_id);
		write(tx, "DELETE FROM invitations WHERE purpose='recover' AND user_id=?", ceremony.user_id);
	} else {
		write(
			tx,
			"INSERT INTO users(id,handle,created_at) VALUES(?,?,?)",
			ceremony.user_id,
			ceremony.handle,
			Date.now(),
		);
		write(
			tx,
			"INSERT INTO memberships(org_id,user_id,role) VALUES(?,?,?)",
			invitation.org_id,
			ceremony.user_id,
			invitation.role,
		);
	}

	write(tx, "DELETE FROM invitations WHERE id=?", invitation.id);
}

/** @param {import("../types.js").Transaction} tx @param {string} userId */
function bootstrapOrganization(tx, userId) {
	const orgId = crypto.randomUUID();
	write(
		tx,
		"INSERT INTO organizations(id,name,created_at) VALUES(?,?,?)",
		orgId,
		"Default",
		Date.now(),
	);
	write(tx, "INSERT INTO memberships(org_id,user_id,role) VALUES(?,?,'owner')", orgId, userId);
}

/** @param {import("../types.js").Transaction} tx @param {string} userId */
async function newSession(tx, userId) {
	const token = randomToken();
	const sessionHash = await hash(token);
	const expiresAt = Date.now() + 12 * 3600_000;
	write(
		tx,
		"INSERT INTO sessions(hash,user_id,auth_at,expires_at) VALUES(?,?,?,?)",
		sessionHash,
		userId,
		Date.now(),
		expiresAt,
	);
	return token;
}

/** @param {Request} request @param {import("../types.js").Transaction} tx @param {unknown} raw */
export async function finishRegistration(request, tx, raw) {
	const site = requireOrigin(request);
	const input = parse(finishPasskey, raw);
	const ceremony = await consumeCeremony(tx.env, input.ceremonyId);
	requireCeremonyOrigin(ceremony, site);
	if (ceremony.purpose === "authenticate") fail(403, "validation_error", "Wrong ceremony type");

	if (ceremony.purpose === "add") {
		const current = await requireSession(request, tx.env);
		requireRecent(current.session);

		if (current.sessionHash !== ceremony.session_hash) {
			fail(403, "restricted_api_key", "Session changed");
		}
	}

	const verified = await verifyRegistration(input.credential, ceremony, site);
	await registrationWrites(tx, ceremony);
	const userId = /** @type {string} */ (ceremony.user_id);
	write(
		tx,
		"INSERT INTO credentials(id,user_id,data,label,created_at) VALUES(?,?,?,?,?)",
		verified.id,
		userId,
		encodeCredential(verified),
		input.label,
		Date.now(),
	);
	const token = await newSession(tx, userId);
	await commit(tx);
	return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
}

/** SimpleWebAuthn validates the untrusted credential, including its transport shape. @param {unknown} credential @param {import("../types.js").Ceremony} ceremony @param {{origin: string, rpId: string}} site */
async function verifyRegistration(credential, ceremony, site) {
	try {
		const result = await verifyRegistrationResponse({
			response: /** @type {import("@simplewebauthn/server").RegistrationResponseJSON} */ (
				credential
			),
			expectedChallenge: ceremony.challenge,
			expectedOrigin: site.origin,
			expectedRPID: site.rpId,
			requireUserVerification: true,
		});

		if (!result.verified || !result.registrationInfo) {
			fail(403, "validation_error", "Passkey verification failed");
		}

		return result.registrationInfo.credential;
	} catch {
		fail(403, "validation_error", "Passkey verification failed");
	}
}

/** @param {Request} request @param {import("../types.js").AppBindings} env @param {unknown} raw */
export async function beginAuthentication(request, env, raw) {
	const site = requireOrigin(request);
	const input = parse(z.object({ handle }).strict(), raw);
	const userId = await statement(env, "SELECT id FROM users WHERE handle=?", input.handle).first(
		"id",
	);
	if (typeof userId !== "string") fail(403, "validation_error", "Account or passkey unavailable");
	const credentials = await userCredentials(env, userId);
	const options = await generateAuthenticationOptions({
		rpID: site.rpId,
		userVerification: "required",
		allowCredentials: credentials.map((credential) => ({ id: credential.id })),
	});
	const ceremonyId = crypto.randomUUID();
	const expiresAt = Date.now() + 5 * 60_000;
	const token = sessionToken(request);
	const sessionHash = token ? await hash(token) : null;
	await statement(
		env,
		"INSERT INTO challenges(id,challenge,purpose,user_id,session_hash,origin,expires_at) VALUES(?,?,'authenticate',?,?,?,?)",
		ceremonyId,
		options.challenge,
		userId,
		sessionHash,
		site.origin,
		expiresAt,
	).run();
	return { ceremonyId, options };
}

/** @param {Request} request @param {import("../types.js").Transaction} tx @param {unknown} raw */
export async function finishAuthentication(request, tx, raw) {
	const site = requireOrigin(request);
	const input = parse(finishPasskey, raw);
	const ceremony = await consumeCeremony(tx.env, input.ceremonyId);
	requireCeremonyOrigin(ceremony, site);
	if (ceremony.purpose !== "authenticate") fail(403, "validation_error", "Wrong ceremony type");
	const credential = /** @type {import("../types.js").Credential|null} */ (
		await statement(
			tx.env,
			"SELECT * FROM credentials WHERE id=? AND user_id=?",
			String(input.credential.id),
			ceremony.user_id,
		).first()
	);
	if (!credential) fail(403, "validation_error", "Passkey unavailable");
	const data = decodeCredential(credential.data);
	const counter = await verifyAuthentication(input.credential, ceremony, data, site);
	data.counter = counter;
	write(tx, "UPDATE credentials SET data=? WHERE id=?", encodeCredential(data), credential.id);
	if (ceremony.session_hash) write(tx, "DELETE FROM sessions WHERE hash=?", ceremony.session_hash);
	const token = await newSession(tx, credential.user_id);
	await commit(tx);
	return json({ ok: true }, 200, { "Set-Cookie": sessionCookie(token) });
}

/** @param {unknown} response @param {import("../types.js").Ceremony} ceremony @param {import("@simplewebauthn/server").WebAuthnCredential} credential @param {{origin: string, rpId: string}} site */
async function verifyAuthentication(response, ceremony, credential, site) {
	try {
		const result = await verifyAuthenticationResponse({
			response: /** @type {import("@simplewebauthn/server").AuthenticationResponseJSON} */ (
				response
			),
			credential,
			expectedChallenge: ceremony.challenge,
			expectedOrigin: site.origin,
			expectedRPID: site.rpId,
			requireUserVerification: true,
		});
		if (!result.verified) fail(403, "validation_error", "Passkey verification failed");
		return result.authenticationInfo.newCounter;
	} catch {
		fail(403, "validation_error", "Passkey verification failed");
	}
}

/** @param {Request} request @param {import("../types.js").AppBindings} env */
export async function logout(request, env) {
	const current = await requireSession(request, env);
	await statement(env, "DELETE FROM sessions WHERE hash=?", current.sessionHash).run();
	return json({ ok: true }, 200, {
		"Set-Cookie": "__Host-cdfsend=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0",
	});
}

/** @param {Request} request @param {import("../types.js").AppBindings} env */
export async function me(request, env) {
	const current = await requireSession(request, env);
	const organizations = await statement(
		env,
		"SELECT o.*,m.role FROM organizations o JOIN memberships m ON m.org_id=o.id WHERE m.user_id=? ORDER BY o.name",
		current.user.id,
	).all();
	const credentials = await statement(
		env,
		"SELECT id,label,created_at FROM credentials WHERE user_id=? ORDER BY created_at",
		current.user.id,
	).all();
	return {
		user: current.user,
		organizations: organizations.results,
		credentials: credentials.results,
	};
}

/** @param {Request} request @param {import("../types.js").Transaction} tx @param {string} credentialId */
export async function removeCredential(request, tx, credentialId) {
	parse(z.string().min(1).max(1024), credentialId);
	const current = await requireSession(request, tx.env);
	requireRecent(current.session);
	const credentials = await userCredentials(tx.env, current.user.id);

	if (!credentials.some((credential) => credential.id === credentialId)) {
		fail(404, "not_found", "Passkey not found");
	}

	if (credentials.length < 2) fail(409, "conflict", "Keep at least one passkey");
	write(tx, "DELETE FROM credentials WHERE user_id=? AND id=?", current.user.id, credentialId);
	write(
		tx,
		"DELETE FROM sessions WHERE user_id=? AND hash!=?",
		current.user.id,
		current.sessionHash,
	);
	await commit(tx);
	return { deleted: true };
}

/** @param {import("@simplewebauthn/server").WebAuthnCredential} credential */
function encodeCredential(credential) {
	return JSON.stringify(
		Object.assign({}, credential, { publicKey: Array.from(credential.publicKey) }),
	);
}

/** @param {string} value @returns {import("@simplewebauthn/server").WebAuthnCredential} */
function decodeCredential(value) {
	const stored = JSON.parse(value);
	return Object.assign({}, stored, { publicKey: new Uint8Array(stored.publicKey) });
}
