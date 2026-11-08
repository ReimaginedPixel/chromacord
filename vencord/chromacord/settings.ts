/*
 * Chromacord for Vencord
 * MIT License, https://github.com/ReimaginedPixel/chromacord
 */

import { definePluginSettings } from "@api/Settings";
import { OptionType } from "@utils/types";

export const settings = definePluginSettings({
    renderAnsi: {
        type: OptionType.BOOLEAN,
        description: "Show ansi code blocks as colored text instead of a code block",
        default: true
    },
    monospace: {
        type: OptionType.BOOLEAN,
        description: "Keep the monospace font for ansi text",
        default: false
    }
});
