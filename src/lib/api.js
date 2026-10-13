// @ts-check
import { startAuthentication, startRegistration } from "@simplewebauthn/browser";

export class RequestFailure extends Error {
	/** @param {number} status @param {string} name @param {string} message */
	constructor(status, name, message) {
		super(message);
		this.status = status;
		this.name = name;
	}
}

/** @template [T=unknown] @param {string} path @param {string} [method] @param {unknown} [body] @param {Record<string,string>} [headers] @returns {Promise<T>} */
export async function requestJson(path, method = "GET", body, headers = {}) {
	/** @type {RequestInit} */
	const options = {
		method,
		credentials: "same-origin",
		cache: "no-store",
		headers: Object.assign({ "Content-Type": "application/json" }, headers),
	};
	if (body !== undefined && method !== "GET") options.body = JSON.stringify(body);
	const url = new URL(path, location.origin);
	const response = await fetch(url, options);
	const data = await response.json();

	if (!response.ok) {
		const message = data.message ?? "Request failed";
		throw new RequestFailure(response.status, data.name, message);
	}

	return data;
}

/** @param {string} handle */
export async function authenticate(handle) {
	const result =
		/** @type {{ceremonyId:string,options:import("@simplewebauthn/browser").PublicKeyCredentialRequestOptionsJSON}} */ (
			await requestJson("/api/auth/login/options", "POST", { handle })
		);
	const optionsJSON = Object.assign({}, result.options, { rpId: location.hostname });
	const credential = await startAuthentication({ optionsJSON });
	await requestJson("/api/auth/login/verify", "POST", {
		ceremonyId: result.ceremonyId,
		credential,
	});
}

/** @param {Record<string,unknown>} input @param {string} [label] */
export async function register(input, label = "My passkey") {
	const result =
		/** @type {{ceremonyId:string,options:import("@simplewebauthn/browser").PublicKeyCredentialCreationOptionsJSON}} */ (
			await requestJson("/api/auth/register/options", "POST", input)
		);
	const rp = Object.assign({}, result.options.rp, { id: location.hostname });
	const optionsJSON = Object.assign({}, result.options, { rp });
	const credential = await startRegistration({ optionsJSON });
	await requestJson("/api/auth/register/verify", "POST", {
		ceremonyId: result.ceremonyId,
		credential,
		label,
	});
}

/** @param {unknown} error */
export function errorMessage(error) {
	if (error instanceof Error) return error.message;
	return "Something went wrong";
}
