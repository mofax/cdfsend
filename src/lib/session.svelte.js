// @ts-check
import { settled } from "svelte";
import { navigate, route } from "./router.js";
import { requestJson, RequestFailure, errorMessage } from "./api.js";

let refreshSequence = 0;
let initializationSequence = 0;
let endingSession = false;

export const session = $state({
	generation: 0,
	ready: false,
	error: "",
	status: { bootstrapped: true },
	current: /** @type {import("./types.js").Me|null} */ (null),
	invitation: /** @type {import("./types.js").InvitationLink|null} */ (null),
	get organization() {
		const organizations = this.current?.organizations ?? [];
		const parameter = route.search.org ?? "";
		const requested = String(parameter);
		return organizations.find((organization) => organization.id === requested) ?? organizations[0];
	},
	get orgId() {
		return this.organization?.id ?? "";
	},
	get canManage() {
		const organization = this.organization;
		if (!organization) return false;
		return organization.role !== "member";
	},
	get isOwner() {
		return this.organization?.role === "owner";
	},
});

export async function initializeSession() {
	const generation = session.generation;
	const sequence = ++initializationSequence;
	const canApplyInitialization = () =>
		generation === session.generation && sequence === initializationSequence;
	session.error = "";

	try {
		const status = /** @type {{bootstrapped:boolean}} */ (await requestJson("/api/auth/status"));
		if (!canApplyInitialization()) return;
		session.status = status;
		await loadInvitationFromHash(canApplyInitialization);
		if (!canApplyInitialization()) return;

		try {
			await refreshSession();
		} catch (cause) {
			if (!(cause instanceof RequestFailure) || cause.status !== 401) throw cause;
			expireSession(generation);
		}
	} catch (cause) {
		if (canApplyInitialization()) session.error = errorMessage(cause);
	} finally {
		// An unauthenticated bootstrap still needs to display the entry page.
		if (sequence === initializationSequence) session.ready = true;
	}
}

/** @param {()=>boolean} isCurrent */
async function loadInvitationFromHash(isCurrent) {
	const parameters = new URLSearchParams(location.hash.slice(1));
	const token = parameters.get("invite") ?? parameters.get("recover");
	if (!token) return;
	// Remove bearer invitations before requesting details; never persist them in browser storage.
	await navigate("/", { replace: true, search: location.search });
	if (!isCurrent()) return;
	session.invitation = null;
	const detail = /** @type {Omit<import("./types.js").InvitationLink,"token">} */ (
		await requestJson("/api/auth/invitation", "POST", { token })
	);
	if (isCurrent()) session.invitation = Object.assign(detail, { token });
}

export async function refreshSession() {
	const generation = session.generation;
	const sequence = ++refreshSequence;
	const canApplyRefresh = () =>
		generation === session.generation && sequence === refreshSequence && !endingSession;
	let result;

	try {
		result = /** @type {import("./types.js").Me} */ (await requestJson("/api/me"));
	} catch (cause) {
		if (!canApplyRefresh()) return;
		if (cause instanceof RequestFailure && cause.status === 401) expireSession(generation);
		throw cause;
	}

	if (!canApplyRefresh()) return;
	session.current = result;

	if (!session.orgId && session.current?.user.is_operator && route.pathname === "/") {
		await navigate("/app/instance", { replace: true });
	}

	await settled();
}

export async function completeSignIn() {
	session.generation += 1;
	session.invitation = null;
	await initializeSession();
}

/** @param {number} [generation] */
export function expireSession(generation = session.generation) {
	if (generation !== session.generation) return;
	session.generation += 1;
	session.current = null;
}

export async function signOut() {
	const generation = ++session.generation;
	endingSession = true;

	try {
		await requestJson("/api/auth/logout", "POST", {});
		if (generation !== session.generation) return;
		expireSession(generation);
		await navigate("/");
	} finally {
		endingSession = false;
	}
}

/** @param {unknown} cause */
export function handleSessionFailure(cause) {
	if (!(cause instanceof RequestFailure) || cause.status !== 401) return;
	const current = session.current;
	const generation = session.generation;
	// Commit a failed async boundary before replacing the authenticated shell.
	void settled().then(() => {
		if (session.current === current) expireSession(generation);
	});
}
