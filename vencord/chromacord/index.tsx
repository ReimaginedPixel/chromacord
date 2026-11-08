/*
 * Chromacord for Vencord
 * MIT License, https://github.com/ReimaginedPixel/chromacord
 */

import { ChatBarButton, ChatBarButtonFactory } from "@api/ChatButtons";
import definePlugin from "@utils/types";
import { openModal } from "@webpack/common";

import { AnsiText } from "./AnsiText";
import { takeChatText } from "./chatBox";
import { ColorModal } from "./ColorModal";
import { ColorTextIcon } from "./ColorTextIcon";
import { settings } from "./settings";
import managedStyle from "./styles.css?managed";

const ColorTextButton: ChatBarButtonFactory = ({ isAnyChat, channel }) => {
    if (!isAnyChat) return null;

    return (
        <ChatBarButton
            tooltip="Color text"
            onClick={e => {
                const text = takeChatText(e.currentTarget as HTMLElement, channel.id);
                openModal(props => <ColorModal modalProps={props} initialText={text} />);
            }}
            buttonProps={{
                "aria-haspopup": "dialog",
                // keeps the chat box focused, so its selection survives the click
                onMouseDown: e => e.preventDefault()
            }}
        >
            <ColorTextIcon />
        </ChatBarButton>
    );
};

export default definePlugin({
    name: "Chromacord",
    description: "Shows ansi code blocks as colored text, and adds a chat bar button to color your own messages",
    tags: ["Appearance", "Chat"],
    authors: [{ name: "ReimaginedPixel", id: 0n }],
    settings,
    managedStyle,

    patches: [
        {
            find: "codeBlock:{react:(",
            replacement: {
                match: /codeBlock:\{react:\((\i),\i,(\i)\)=>/,
                replace: "$&$self.shouldRender($1)?$self.renderAnsi($1,$2):"
            }
        }
    ],

    chatBarButton: {
        icon: ColorTextIcon,
        render: ColorTextButton
    },

    shouldRender(node: { lang?: string; }) {
        return settings.store.renderAnsi && node.lang?.toLowerCase() === "ansi";
    },

    renderAnsi(node: { content: string; }, state: { key?: string; }) {
        return <AnsiText key={state.key} content={node.content} />;
    }
});
