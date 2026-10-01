/** Themed single-choice menu shared by the feedback form and steering composer. */
export declare function ChoiceMenu({ label, value, options, onChange, className, above, }: {
    label: string;
    value: string;
    options: Array<{
        value: string;
        label: string;
        disabled?: boolean;
    }>;
    onChange: (value: string) => void;
    className?: string;
    above?: boolean;
}): import("preact/src").JSX.Element;
