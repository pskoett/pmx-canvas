/**
 * In-canvas replacement for `window.prompt`, which embedded browser panes
 * silently no-op (a Shift+F that "does nothing") and no test can drive. One
 * request at a time; a new ask cancels the previous one.
 */
interface TextPromptRequest {
    title: string;
    placeholder: string;
    resolve: (value: string | null) => void;
}
export declare const textPromptRequest: import("@preact/signals-core").Signal<TextPromptRequest | null>;
export declare function askText(title: string, placeholder: string): Promise<string | null>;
export declare function TextPrompt(): import("preact/src").JSX.Element | null;
export {};
