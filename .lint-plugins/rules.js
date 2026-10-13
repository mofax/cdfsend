function enclosingStatement(node) {
	for (let parent = node.parent; parent; parent = parent.parent) {
		if (parent.type.endsWith("Statement") || parent.type === "VariableDeclaration") {
			return parent;
		}

		if (parent.type === "ArrowFunctionExpression") {
			const hasExpressionBody = parent.body.type !== "BlockStatement";
			return hasExpressionBody ? parent : null;
		}

		if (parent.type === "FunctionDeclaration" || parent.type === "FunctionExpression") {
			return null;
		}
	}

	return null;
}

export default {
	meta: { name: "custom" },
	rules: {
		"no-mixed-ternary": {
			create(context) {
				const statements = new Map();

				function track(node, kind) {
					const statement = enclosingStatement(node);
					if (!statement) return;

					let entry = statements.get(statement);

					if (!entry) {
						entry = { ternaries: [], hasBinary: false };
						statements.set(statement, entry);
					}

					if (kind === "ternary") {
						entry.ternaries.push(node);
					} else {
						entry.hasBinary = true;
					}
				}

				return {
					ConditionalExpression(node) {
						track(node, "ternary");
					},
					BinaryExpression(node) {
						track(node, "binary");
					},
					LogicalExpression(node) {
						track(node, "binary");
					},
					"Program:exit"() {
						for (const entry of statements.values()) {
							if (!entry.hasBinary) continue;

							for (const node of entry.ternaries) {
								context.report({
									node,
									message:
										"Ternaries must not share a statement with binary or logical expressions. Make the code easier to read by splitting the statement using variables with names that reflect their purpose.",
								});
							}
						}
					},
				};
			},
		},
	},
};
