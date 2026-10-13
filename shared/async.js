// @ts-check
/**
 * Run dependent operations in input order, stopping on the first rejection.
 * @template T
 * @param {T[]} items
 * @param {(item:T,index:number)=>Promise<void>} execute
 * @returns {Promise<void>}
 */
export function forEachSequential(items, execute) {
	return items.reduce(
		(pending, item, index) => pending.then(() => execute(item, index)),
		Promise.resolve(),
	);
}
