/*
 * Chromacord for Vencord
 * MIT License, https://github.com/ReimaginedPixel/chromacord
 */

import { DraftStore, DraftType } from "@webpack/common";

import { plainText } from "./colorize";

// The chat box next to a chat bar button: the closest editor above it.
function findChatBox(button: HTMLElement) {
    for (let el = button.parentElement; el; el = el.parentElement) {
        const box = el.querySelector<HTMLElement>('[data-slate-editor="true"], textarea');
        if (box) return box;
    }
    return null;
}

// The text to color: what is selected in the chat box, or else the whole
// draft. The draft then gets selected, so inserting the result replaces it.
export function takeChatText(button: HTMLElement, channelId: string) {
    const box = findChatBox(button);

    if (box instanceof HTMLTextAreaElement) {
        if (box.selectionStart === box.selectionEnd) box.select();
        return plainText(box.value.slice(box.selectionStart, box.selectionEnd));
    }

    const selection = document.getSelection();
    if (box && selection && !selection.isCollapsed && box.contains(selection.anchorNode) && box.contains(selection.focusNode))
        return plainText(selection.toString());

    const draft = DraftStore.getDraft(channelId, DraftType.ChannelMessage) ?? "";
    if (box && selection && draft) selection.selectAllChildren(box);
    return plainText(draft);
}
