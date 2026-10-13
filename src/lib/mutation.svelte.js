// @ts-check
import { onDestroy, untrack } from "svelte";
import { authenticate, errorMessage, RequestFailure } from "./api.js";
import { route } from "./router.js";
import { session, expireSession } from "./session.svelte.js";

/**
 * A component-owned mutation, not a scheduler. Request inputs must be plain data.
 * Only request() is eligible for a passkey retry; onSuccess() is never replayed.
 * @template Input, Result
 * @param {{request:(input:Input)=>Promise<Result>, onSuccess?:(result:Result,input:Input,isCurrent:()=>boolean)=>void|Promise<void>}} options
 */
export function createMutation({ request, onSuccess }) {
	const state = $state({
		pending: false,
		succeeded: false,
		error: "",
		refreshError: "",
		needsVerification: false,
	});
	/** @typedef {{input:Input, generation:number, handle:string, isCurrent:()=>boolean}} Attempt */
	/** @type {Attempt|null} */
	let attempt = null;
	let alive = true;
	let revision = 0;
	let context = currentContextKey();

	function currentContextKey() {
		return `${session.generation}:${session.current?.user.id}:${session.orgId}:${route.pathname}`;
	}

	function invalidateAttempt() {
		revision += 1;
		attempt = null;
		state.pending = false;
		state.succeeded = false;
		state.needsVerification = false;
		state.error = "";
		state.refreshError = "";
	}

	$effect(() => {
		const next = currentContextKey();
		if (next === context) return;
		context = next;
		untrack(invalidateAttempt);
	});

	onDestroy(() => {
		alive = false;
		invalidateAttempt();
	});

	/** @param {unknown} cause @param {Attempt} current */
	function handleRequestFailure(cause, current) {
		if (cause instanceof RequestFailure && cause.status === 401) {
			expireSession(current.generation);
		}

		if (!current.isCurrent()) return;
		if (cause instanceof RequestFailure && cause.name === "reauthentication_required") {
			state.needsVerification = true;
		} else state.error = errorMessage(cause);
	}

	/** @param {Attempt} current */
	async function submitRequest(current) {
		state.needsVerification = false;
		let result;

		try {
			result = await request(current.input);
		} catch (cause) {
			handleRequestFailure(cause, current);
			return;
		}

		if (!current.isCurrent()) return;
		attempt = null;
		state.succeeded = true;

		try {
			await onSuccess?.(result, current.input, current.isCurrent);
		} catch (cause) {
			if (cause instanceof RequestFailure && cause.status === 401) {
				expireSession(current.generation);
			}

			if (current.isCurrent()) state.refreshError = errorMessage(cause);
		}
	}

	/** @param {Input} input */
	async function submit(input) {
		if (state.pending || state.needsVerification || !alive) return;
		const key = currentContextKey();
		const version = ++revision;
		const current = {
			input: /** @type {Input} */ (structuredClone($state.snapshot(input))),
			generation: session.generation,
			handle: session.current?.user.handle ?? "",
			isCurrent: () => alive && revision === version && currentContextKey() === key,
		};
		attempt = current;
		state.pending = true;
		state.succeeded = false;
		state.error = "";
		state.refreshError = "";

		try {
			await submitRequest(current);
		} finally {
			if (current.isCurrent()) state.pending = false;
		}
	}

	async function verifyAndRetry() {
		const current = attempt;
		if (!current?.isCurrent() || state.pending || !state.needsVerification) return;
		state.pending = true;
		state.error = "";

		try {
			await authenticate(current.handle);
			if (current.isCurrent()) await submitRequest(current);
		} catch (cause) {
			handleRequestFailure(cause, current);
		} finally {
			if (current.isCurrent()) state.pending = false;
		}
	}

	return {
		get pending() {
			return state.pending;
		},
		get succeeded() {
			return state.succeeded;
		},
		get blocked() {
			return state.pending || state.needsVerification;
		},
		get error() {
			return state.error;
		},
		get refreshError() {
			return state.refreshError;
		},
		get needsVerification() {
			return state.needsVerification;
		},
		submit,
		verifyAndRetry,
		cancelVerification() {
			if (!state.pending) invalidateAttempt();
		},
	};
}
