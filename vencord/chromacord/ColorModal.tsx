/*
 * Chromacord for Vencord
 * MIT License, https://github.com/ReimaginedPixel/chromacord
 */

import { Heading } from "@components/Heading";
import { Paragraph } from "@components/Paragraph";
import { copyWithToast, insertTextIntoChatInputBox } from "@utils/discord";
import { classes } from "@utils/misc";
import { RenderModalProps } from "@vencord/discord-types";
import { Modal, TextArea, TextInput, useEffect, useMemo, useState } from "@webpack/common";
import type { ReactNode } from "react";

import { AnsiText, cl } from "./AnsiText";
import { CLASSIC, colorBody, PLUGIN_EFFECTS, PRESETS } from "./colorize";
import { MESSAGE_LIMIT, NITRO_LIMIT, toMessage } from "./lib/ansi";
import { normalizeHex } from "./lib/color";
import { cssColor } from "./tokenize";

type Paint =
    | { kind: "none"; }
    | { kind: "classic"; code: number; }
    | { kind: "custom"; }
    | { kind: "preset"; id: string; };

interface Look {
    paint: Paint;
    hex: string;
    effect: string;
    target: "fg" | "bg";
    b: boolean;
    i: boolean;
    u: boolean;
    s: boolean;
}

// Remembered until Discord restarts, so a second message can match the first.
let lastLook: Look = { paint: { kind: "preset", id: "rainbow" }, hex: "#7c86ff", effect: "gradient", target: "fg", b: false, i: false, u: false, s: false };

function paintOptions({ paint, hex, ...rest }: Look) {
    return {
        ...rest,
        color: paint.kind === "classic" ? paint.code : paint.kind === "custom" ? hex : null,
        preset: paint.kind === "preset" ? paint.id : null
    };
}

function countLabel(length: number) {
    const count = `${length.toLocaleString()} characters`;
    if (length > NITRO_LIMIT) return `${count}, too long for one message`;
    if (length > MESSAGE_LIMIT) return `${count}, over 2,000 needs Nitro`;
    return `${count} of 2,000`;
}

function Toggle({ pressed, onClick, label, children }: { pressed: boolean; onClick(): void; label: string; children: ReactNode; }) {
    return (
        <button type="button" className={classes(cl("toggle"), pressed && cl("on"))} aria-pressed={pressed} title={label} onClick={onClick}>
            {children}
        </button>
    );
}

export function ColorModal({ modalProps, initialText }: { modalProps: RenderModalProps; initialText: string; }) {
    const [text, setText] = useState(initialText);
    const [look, setLook] = useState(lastLook);
    const [hexInput, setHexInput] = useState(lastLook.hex);
    useEffect(() => { lastLook = look; }, [look]);

    const update = (patch: Partial<Look>) => setLook(prev => ({ ...prev, ...patch }));
    const setHex = (value: string) => {
        setHexInput(value);
        const hex = normalizeHex(value);
        if (hex) update({ hex, paint: { kind: "custom" } });
    };

    const body = useMemo(() => colorBody(text, paintOptions(look)), [text, look]);
    const message = toMessage(body);
    const { paint } = look;

    return (
        <Modal
            {...modalProps}
            size="md"
            title="Color text"
            subtitle="Everyone sees the colors, with or without Chromacord."
            actions={[
                { text: "Copy", variant: "secondary", disabled: !text, onClick: () => copyWithToast(message, "Colored message copied") },
                {
                    text: "Insert", variant: "primary", disabled: !text, onClick() {
                        insertTextIntoChatInputBox(message);
                        modalProps.onClose();
                    }
                }
            ]}
        >
            <div className={cl("modal")}>
                <section>
                    <Heading>Text</Heading>
                    <TextArea value={text} onChange={setText} rows={3} placeholder="Type the text to color" />
                </section>

                <section>
                    <Heading>Color</Heading>
                    <div className={cl("swatches")} role="group" aria-label="Color">
                        <button
                            type="button"
                            className={classes(cl("swatch"), cl("none"), paint.kind === "none" && cl("on"))}
                            aria-pressed={paint.kind === "none"}
                            title="No color"
                            aria-label="No color"
                            onClick={() => update({ paint: { kind: "none" } })}
                        />
                        {CLASSIC.map(({ code, name }) => {
                            const on = paint.kind === "classic" && paint.code === code;
                            return (
                                <button
                                    key={code}
                                    type="button"
                                    className={classes(cl("swatch"), on && cl("on"))}
                                    style={{ background: cssColor(code - 30) }}
                                    aria-pressed={on}
                                    title={name}
                                    aria-label={name}
                                    onClick={() => update({ paint: { kind: "classic", code } })}
                                />
                            );
                        })}
                        <label
                            className={classes(cl("swatch"), cl("custom"), paint.kind === "custom" && cl("on"))}
                            style={{ background: look.hex }}
                            title="Custom color"
                        >
                            <input type="color" value={look.hex} aria-label="Custom color" onChange={e => setHex(e.currentTarget.value)} />
                        </label>
                        <TextInput className={cl("hex")} value={hexInput} onChange={setHex} maxLength={7} spellCheck={false} aria-label="Custom color as hex" />
                    </div>
                </section>

                <section>
                    <Heading>Gradients</Heading>
                    <div className={cl("presets")} role="group" aria-label="Gradients">
                        {PRESETS.map(({ id, name, colors }) => {
                            const on = paint.kind === "preset" && paint.id === id;
                            return (
                                <button
                                    key={id}
                                    type="button"
                                    className={classes(cl("preset"), on && cl("on"))}
                                    style={{ background: `linear-gradient(90deg, ${colors.join(", ")})` }}
                                    aria-pressed={on}
                                    title={name}
                                    aria-label={name}
                                    onClick={() => update({ paint: { kind: "preset", id } })}
                                />
                            );
                        })}
                    </div>
                    {paint.kind === "preset" && (
                        <div className={cl("group")} role="group" aria-label="Effect">
                            {PLUGIN_EFFECTS.map(({ id, label, hint }) => (
                                <Toggle key={id} pressed={look.effect === id} label={hint} onClick={() => update({ effect: id })}>{label}</Toggle>
                            ))}
                        </div>
                    )}
                </section>

                <section>
                    <Heading>Style</Heading>
                    <div className={cl("row")}>
                        <div className={cl("group")} role="group" aria-label="Text style">
                            <Toggle pressed={look.b} label="Bold" onClick={() => update({ b: !look.b })}><b>B</b></Toggle>
                            <Toggle pressed={look.i} label="Italic" onClick={() => update({ i: !look.i })}><i>I</i></Toggle>
                            <Toggle pressed={look.u} label="Underline" onClick={() => update({ u: !look.u })}><u>U</u></Toggle>
                            <Toggle pressed={look.s} label="Strikethrough" onClick={() => update({ s: !look.s })}><s>S</s></Toggle>
                        </div>
                        <div className={cl("group")} role="group" aria-label="Color the">
                            <Toggle pressed={look.target === "fg"} label="Color the text" onClick={() => update({ target: "fg" })}>Text</Toggle>
                            <Toggle pressed={look.target === "bg"} label="Color the background" onClick={() => update({ target: "bg" })}>Background</Toggle>
                        </div>
                    </div>
                </section>

                <section>
                    <Heading>Preview</Heading>
                    <div className={cl("preview")}>
                        {text ? <AnsiText content={body} /> : <span className={cl("placeholder")}>Your colored text shows here</span>}
                    </div>
                    <Paragraph className={classes(cl("count"), message.length > MESSAGE_LIMIT && cl("over"))}>
                        {countLabel(message.length)}
                    </Paragraph>
                </section>
            </div>
        </Modal>
    );
}
