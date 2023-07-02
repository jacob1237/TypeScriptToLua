/**
## Issues

1. Lua5.1 escape sequences
    Lua5.1 uses decimal escape sequences in a format of \ddd instead of octal like in JS, which means that it
    doesn't support things like \99 etc:
        - https://www.lua.org/manual/5.1/manual.html#:~:text=A%20character%20in,%5C0%27.

2. Octal escape sequences are deprecated in ES5 (except the \0):
    - https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Errors/Deprecated_octal

3. Unescaping raw literals from JS strings brings another problem:
    it makes `import`/`require` statements lookup invalid file names in ResolutionContext.
    To fix that problem we have to re-evaluate escape sequences to raw strings, but using Lua rules 

## Questions

- How to let the users use the \ddd form for Lua5.1+?
    Answer: octal escape sequences are deprecated, so we have to resort to \xHH
- Do we need to convert \xHH to \ddd for Lua 5.1?
    Answer: probably yes, to achieve better compatibility
- Do we need to convert \uHHHH to \u{HHHHHH} for Lua5.3 because the former is not supported?
    Answer: probably yes, to achieve better compatibility

------

Character escape problem:

1. All raw control characters in string literals must be replaced with escape sequences (or at least \r\n)
2. In tagged templates, the slash \ must be escaped because TypeScript doesn't check it

The first case is related to JSX and multi-line \r or \n-separated strings (Lua can't parse it)

Algorithm:

1. Find single " and \ and replace it
2. 
*/
import ts = require("typescript");
import { LuaTarget } from "../../CompilerOptions";
import { unsupportedUnicodeEscape } from "../utils/diagnostics";
import { TransformationContext } from "../context";

const enum CharCodes {
    DoubleQuote = 34,
    Slash = 92,
    U = 117,
    X = 120,
    OpenBrace = 123,
}

export type StringNode =
    | ts.StringLiteral
    | ts.NoSubstitutionTemplateLiteral
    | ts.TemplateHead
    | ts.TemplateMiddle
    | ts.TemplateTail;

export type EscapeSequenceTransformer = (node: StringNode, context: TransformationContext) => string;

const cache = new Map<LuaTarget, EscapeSequenceTransformer>();

export function transformEscapeSequences(node: StringNode, context: TransformationContext) {
    const target = context.luaTarget;

    if (!cache.has(target)) {
        cache.set(target, createTransformer(target));
    }

    return cache.get(target)!(node, context);
}

const unsupportedUnicodeTargets = [LuaTarget.Lua50, LuaTarget.Lua51, LuaTarget.Lua52];
const unsupportedHexTargets = [LuaTarget.Lua50, LuaTarget.Lua51];

/**
 * The escape sequence transformer is a small stateful parser that
 * takes the original node and returns its text with replaced escape sequences,
 * such as \xHH, \uHHHH and \u{HHH}
 *
 * It tries hard to be as performant as possible, meaning that it avoids unnecessary
 * object/array allocations, throwing exceptions, etc.
 */
function createTransformer(target: LuaTarget): EscapeSequenceTransformer {
    type SequenceParser = (text: string, node: ts.Node, context: TransformationContext) => boolean;

    let head = 0;
    let start = 0; // Current chunk start pos
    let buffer = "";

    /**
     * We stop the entire parsing process for unsupported Lua targets because
     * the resulting string will not cause any compile or runtime errors in Lua,
     * but we still notify the user about the fact that it's not supported
     */
    const parseUnicodeEscape: SequenceParser = !unsupportedUnicodeTargets.includes(target)
        ? transformUnicodeEscape
        : (_, node, context) => {
              context.diagnostics.push(unsupportedUnicodeEscape(node, target));
              return false;
          };

    /**
     * The hex character escape (\xHH) transformation only takes place
     * for Lua <= 5.1 because it's not supported by the language spec
     */
    const parseHexEscape: SequenceParser = unsupportedHexTargets.includes(target)
        ? transformHexEscape
        : () => {
              head++;
              return true;
          };

    /**
     * Append the current text chunk and the given token to the result buffer
     *
     * @param token - The token to append to the buffer
     * @param end - The end of the current string string chunk to copy from (start .. stop)
     * @param nextHead - Where to move the cursor after the operation
     */
    function bufferAppend(text: string, token: string, end: number, nextHead: number): void {
        buffer += text.slice(start, end) + token;
        head = nextHead;
        start = nextHead;
    }

    /**
     * To transform the \xHH escape sequence, we just need to take the next two
     * symbols and convert them into a decimal escape form \ddd (Lua <= 5.1)
     */
    function transformHexEscape(text: string): boolean {
        const nextHead = head + 3;
        const decimal = Number("0x" + text.slice(head + 1, nextHead));

        bufferAppend(text, `\\${decimal}`, head - 1, nextHead);
        return true;
    }

    /**
     * In Lua >= 5.3, the unicode escape sequence \uHHHH will cause a compile
     * time error, so we need to transform it to a correct \u{HHH} form
     *
     * Please note that we don't transform \u{HHH} sequences themselves
     */
    function transformUnicodeEscape(text: string): boolean {
        head++;

        // Skip \u{HHH}
        if (text.charCodeAt(head) === CharCodes.OpenBrace) {
            return true;
        }

        // Convert \uHHHH to \u{HHH}
        const next = head + 4;
        bufferAppend(text, `\\u{${text.slice(head, next)}}`, head - 2, next);

        return true;
    }

    function parseEscapeSequence(text: string, node: StringNode, context: TransformationContext): boolean {
        head++;

        switch (text.charCodeAt(head)) {
            case CharCodes.X:
                return parseHexEscape(text, node, context);
            case CharCodes.U:
                return parseUnicodeEscape(text, node, context);
            default:
                head++;
                return true; // Nothing of our interest
        }
    }

    return (node: StringNode, context: TransformationContext): string => {
        // Don't process nodes without real source code
        // because we can't report diagnostics for them
        if (node.pos === -1) return node.text;

        let text: string;
        let textStart: number;
        let textEnd: number;

        // Extract node text and its positions
        if (node.kind === ts.SyntaxKind.StringLiteral) {
            if (node.flags & ts.NodeFlags.Synthesized) {
                text = node.text;
                [textStart, textEnd] = [0, text.length];
            }
            else {
                text = node.getText();
                // Avoid capturing quotes
                [textStart, textEnd] = [1, text.length - 1];
            }
        }
        else {
            text = node.rawText ?? "";
            [textStart, textEnd] = [0, text.length];
        }

        if (!text.length) return "";

        head = textStart;
        start = head;
        buffer = "";

        // Fast-travel to the next escape token
        while ((head = text.indexOf("\\", head)) >= 0) {
            if (!parseEscapeSequence(text, node, context)) {
                start = textStart; // Reset the current chunk head
                break;
            }
        }

        let result = "";

        // If the chunk start position was reset on error, the buffer should not be prepended
        if (start !== textStart) result += buffer;
        result += text.slice(start, textEnd);

        // Discard the buffer to let the GC do its job
        buffer = "";

        return result;
    };
}
