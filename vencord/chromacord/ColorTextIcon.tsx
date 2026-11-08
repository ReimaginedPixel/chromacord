/*
 * Chromacord for Vencord
 * MIT License, https://github.com/ReimaginedPixel/chromacord
 */

import { IconComponent } from "@utils/types";

// A letter over a bar in the reader's red, green and blue, like the Chromacord logo.
export const ColorTextIcon: IconComponent = ({ height = 20, width = 20, className }) => (
    <svg aria-hidden="true" role="img" width={width} height={height} className={className} viewBox="0 0 24 24">
        <path d="M6.5 15.5 12 3.5l5.5 12M8.6 11h6.8" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
        <rect x="3" y="18.5" width="5" height="3" rx="1.5" fill="var(--ansi-red, #de464a)" />
        <rect x="9.5" y="18.5" width="5" height="3" rx="1.5" fill="var(--ansi-green, #1b8d4d)" />
        <rect x="16" y="18.5" width="5" height="3" rx="1.5" fill="var(--ansi-blue, #1a7ce6)" />
    </svg>
);
