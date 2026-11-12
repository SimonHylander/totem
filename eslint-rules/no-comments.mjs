import { readdirSync } from "node:fs";

const DOCUMENTED = new Set([
  "ExportNamedDeclaration",
  "ExportDefaultDeclaration",
  "TSPropertySignature",
  "TSMethodSignature",
  "TSIndexSignature",
  "TSEnumMember",
  "PropertyDefinition",
  "MethodDefinition",
  "Property",
]);

const EXPORTS = new Set(["ExportNamedDeclaration", "ExportDefaultDeclaration"]);

const isDirective = (text) =>
  /^\s*@ts-expect-error\s+\S/.test(text) || /^\s*eslint-(disable|enable)(-next-line|-line)?\s+\S.*\s--\s+\S/.test(text);

/** The outermost node that starts where `token` starts. */
function nodeStartingAt(sourceCode, token) {
  let node = sourceCode.getNodeByRangeIndex(token.range[0]);
  while (node?.parent && node.parent.type !== "Program" && node.parent.range[0] === token.range[0]) node = node.parent;
  return node;
}

function topLevel(node) {
  while (node.parent && node.parent.type !== "Program") node = node.parent;
  return node;
}

function documentsExport(sourceCode, comment) {
  const token = sourceCode.getTokenAfter(comment);
  const node = token && nodeStartingAt(sourceCode, token);
  return node !== undefined && node !== null && DOCUMENTED.has(node.type) && EXPORTS.has(topLevel(node).type);
}

/**
 * Bans code comments. Allowed: JSDoc on an exported declaration or one of its members, `quirk:`
 * notes about behaviour we cannot change (a browser, a vendor API), `@ts-expect-error` and
 * `eslint-disable` directives that give a reason, shebangs and `/// <reference>`. An allowed comment
 * that names an ADR must name one in `decisionsDir`.
 */
export const noComments = {
  meta: {
    type: "suggestion",
    schema: [{ type: "object", properties: { decisionsDir: { type: "string" } }, required: ["decisionsDir"] }],
    messages: {
      comment:
        "Delete this comment, or change the code so it is not needed. Allowed: JSDoc on exports, `quirk:` notes about browser or vendor behaviour, and directives with a reason.",
      selfDisable: "Do not disable totem/no-comments.",
      unknownAdr: "ADR {{adr}} does not exist in docs/decisions.",
    },
  },
  create(context) {
    const { sourceCode } = context;
    const adrs = new Set(readdirSync(context.options[0].decisionsDir).map((file) => file.slice(0, 4)));
    return {
      Program() {
        for (const comment of sourceCode.getAllComments()) {
          const text = comment.value;
          if (comment.type === "Shebang" || (comment.type === "Line" && text.startsWith("/ <reference "))) continue;
          if (/eslint-disable[^\n]*\/no-comments\b/.test(text)) {
            context.report({ loc: comment.loc, messageId: "selfDisable" });
            continue;
          }
          const jsdoc = comment.type === "Block" && text.startsWith("*") && documentsExport(sourceCode, comment);
          if (!jsdoc && !isDirective(text) && !/^\s*quirk:\s*\S/.test(text)) {
            context.report({ loc: comment.loc, messageId: "comment" });
            continue;
          }
          for (const [, adr] of text.matchAll(/ADR (\d{4})/g)) {
            if (!adrs.has(adr)) context.report({ loc: comment.loc, messageId: "unknownAdr", data: { adr } });
          }
        }
      },
    };
  },
};

export default { rules: { "no-comments": noComments } };
