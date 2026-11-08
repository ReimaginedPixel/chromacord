/*
 * Chromacord for Vencord
 * MIT License, https://github.com/ReimaginedPixel/chromacord
 */

import ErrorBoundary from "@components/ErrorBoundary";
import { classNameFactory } from "@utils/css";
import { classes } from "@utils/misc";
import { useMemo } from "@webpack/common";

import { settings } from "./settings";
import { cssOf, tokenize } from "./tokenize";

export const cl = classNameFactory("vc-chromacord-");

const ESCAPES = /\u001b\[[0-?]*[ -/]*[@-~]/g;

function AnsiTextInner({ content }: { content: string; }) {
    const { monospace } = settings.use(["monospace"]);
    const tokens = useMemo(() => tokenize(content), [content]);

    return (
        <div className={classes(cl("text"), monospace && cl("mono"))}>
            {tokens.map((token, i) => <span key={i} style={cssOf(token.style)}>{token.text}</span>)}
        </div>
    );
}

export const AnsiText = ErrorBoundary.wrap(AnsiTextInner, {
    fallback: ({ wrappedProps }) => <div className={cl("text")}>{wrappedProps.content.replace(ESCAPES, "")}</div>
});
