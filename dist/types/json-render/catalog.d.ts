/**
 * json-render catalog definition for PMX Canvas.
 *
 * Uses the shadcn component set from @json-render/shadcn/catalog plus local
 * chart components. The catalog validates specs before they are stored in
 * canvas node state or rendered in the browser viewer.
 */
export declare const allComponentDefinitions: {
    LineChart: {
        readonly props: import("zod").ZodObject<{
            title: import("zod").ZodNullable<import("zod").ZodString>;
            data: import("zod").ZodArray<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            xKey: import("zod").ZodString;
            yKey: import("zod").ZodString;
            aggregate: import("zod").ZodNullable<import("zod").ZodEnum<{
                count: "count";
                sum: "sum";
                avg: "avg";
            }>>;
            color: import("zod").ZodNullable<import("zod").ZodString>;
            height: import("zod").ZodNullable<import("zod").ZodNumber>;
        }, import("zod/v4/core").$strip>;
        readonly description: "Line chart for time-series or trend data. Provide data as an array of objects with xKey and yKey fields.";
        readonly example: {
            readonly title: "Weekly trend";
            readonly data: readonly [{
                readonly day: "Mon";
                readonly value: 10;
            }, {
                readonly day: "Tue";
                readonly value: 25;
            }, {
                readonly day: "Wed";
                readonly value: 18;
            }];
            readonly xKey: "day";
            readonly yKey: "value";
            readonly aggregate: null;
            readonly color: null;
            readonly height: null;
        };
    };
    BarChart: {
        readonly props: import("zod").ZodObject<{
            title: import("zod").ZodNullable<import("zod").ZodString>;
            data: import("zod").ZodArray<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            xKey: import("zod").ZodString;
            yKey: import("zod").ZodString;
            aggregate: import("zod").ZodNullable<import("zod").ZodEnum<{
                count: "count";
                sum: "sum";
                avg: "avg";
            }>>;
            color: import("zod").ZodNullable<import("zod").ZodString>;
            height: import("zod").ZodNullable<import("zod").ZodNumber>;
        }, import("zod/v4/core").$strip>;
        readonly description: "Bar chart for comparing categories. Provide data as an array of objects with xKey and yKey fields.";
        readonly example: {
            readonly title: "Sales by region";
            readonly data: readonly [{
                readonly region: "North";
                readonly sales: 120;
            }, {
                readonly region: "South";
                readonly sales: 98;
            }, {
                readonly region: "East";
                readonly sales: 150;
            }];
            readonly xKey: "region";
            readonly yKey: "sales";
            readonly aggregate: null;
            readonly color: null;
            readonly height: null;
        };
    };
    PieChart: {
        readonly props: import("zod").ZodObject<{
            title: import("zod").ZodNullable<import("zod").ZodString>;
            data: import("zod").ZodArray<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            nameKey: import("zod").ZodString;
            valueKey: import("zod").ZodString;
            height: import("zod").ZodNullable<import("zod").ZodNumber>;
        }, import("zod/v4/core").$strip>;
        readonly description: "Pie chart for showing proportions. Provide data as an array of objects with nameKey and valueKey fields.";
        readonly example: {
            readonly title: "Market share";
            readonly data: readonly [{
                readonly name: "Product A";
                readonly share: 45;
            }, {
                readonly name: "Product B";
                readonly share: 30;
            }, {
                readonly name: "Product C";
                readonly share: 25;
            }];
            readonly nameKey: "name";
            readonly valueKey: "share";
            readonly height: null;
        };
    };
    Card: {
        props: import("zod").ZodObject<{
            title: import("zod").ZodNullable<import("zod").ZodString>;
            description: import("zod").ZodNullable<import("zod").ZodString>;
            maxWidth: import("zod").ZodNullable<import("zod").ZodEnum<{
                sm: "sm";
                md: "md";
                lg: "lg";
                full: "full";
            }>>;
            centered: import("zod").ZodNullable<import("zod").ZodBoolean>;
        }, import("zod/v4/core").$strip>;
        slots: string[];
        description: string;
        example: {
            title: string;
            description: string;
        };
    };
    Stack: {
        props: import("zod").ZodObject<{
            direction: import("zod").ZodNullable<import("zod").ZodEnum<{
                horizontal: "horizontal";
                vertical: "vertical";
            }>>;
            gap: import("zod").ZodNullable<import("zod").ZodEnum<{
                sm: "sm";
                md: "md";
                lg: "lg";
                none: "none";
            }>>;
            align: import("zod").ZodNullable<import("zod").ZodEnum<{
                start: "start";
                center: "center";
                end: "end";
                stretch: "stretch";
            }>>;
            justify: import("zod").ZodNullable<import("zod").ZodEnum<{
                start: "start";
                center: "center";
                end: "end";
                between: "between";
                around: "around";
            }>>;
        }, import("zod/v4/core").$strip>;
        slots: string[];
        description: string;
        example: {
            direction: string;
            gap: string;
        };
    };
    Grid: {
        props: import("zod").ZodObject<{
            columns: import("zod").ZodNullable<import("zod").ZodNumber>;
            gap: import("zod").ZodNullable<import("zod").ZodEnum<{
                sm: "sm";
                md: "md";
                lg: "lg";
            }>>;
        }, import("zod/v4/core").$strip>;
        slots: string[];
        description: string;
        example: {
            columns: number;
            gap: string;
        };
    };
    Separator: {
        props: import("zod").ZodObject<{
            orientation: import("zod").ZodNullable<import("zod").ZodEnum<{
                horizontal: "horizontal";
                vertical: "vertical";
            }>>;
        }, import("zod/v4/core").$strip>;
        description: string;
    };
    Tabs: {
        props: import("zod").ZodObject<{
            tabs: import("zod").ZodArray<import("zod").ZodObject<{
                label: import("zod").ZodString;
                value: import("zod").ZodString;
            }, import("zod/v4/core").$strip>>;
            defaultValue: import("zod").ZodNullable<import("zod").ZodString>;
            value: import("zod").ZodNullable<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>;
        slots: string[];
        events: string[];
        description: string;
    };
    Accordion: {
        props: import("zod").ZodObject<{
            items: import("zod").ZodArray<import("zod").ZodObject<{
                title: import("zod").ZodString;
                content: import("zod").ZodString;
            }, import("zod/v4/core").$strip>>;
            type: import("zod").ZodNullable<import("zod").ZodEnum<{
                single: "single";
                multiple: "multiple";
            }>>;
        }, import("zod/v4/core").$strip>;
        description: string;
    };
    Collapsible: {
        props: import("zod").ZodObject<{
            title: import("zod").ZodString;
            defaultOpen: import("zod").ZodNullable<import("zod").ZodBoolean>;
        }, import("zod/v4/core").$strip>;
        slots: string[];
        description: string;
    };
    Dialog: {
        props: import("zod").ZodObject<{
            title: import("zod").ZodString;
            description: import("zod").ZodNullable<import("zod").ZodString>;
            openPath: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        slots: string[];
        description: string;
    };
    Drawer: {
        props: import("zod").ZodObject<{
            title: import("zod").ZodString;
            description: import("zod").ZodNullable<import("zod").ZodString>;
            openPath: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        slots: string[];
        description: string;
    };
    Carousel: {
        props: import("zod").ZodObject<{
            items: import("zod").ZodArray<import("zod").ZodObject<{
                title: import("zod").ZodNullable<import("zod").ZodString>;
                description: import("zod").ZodNullable<import("zod").ZodString>;
            }, import("zod/v4/core").$strip>>;
        }, import("zod/v4/core").$strip>;
        description: string;
    };
    Table: {
        props: import("zod").ZodObject<{
            columns: import("zod").ZodArray<import("zod").ZodString>;
            rows: import("zod").ZodArray<import("zod").ZodArray<import("zod").ZodString>>;
            caption: import("zod").ZodNullable<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>;
        description: string;
        example: {
            columns: string[];
            rows: string[][];
        };
    };
    Heading: {
        props: import("zod").ZodObject<{
            text: import("zod").ZodString;
            level: import("zod").ZodNullable<import("zod").ZodEnum<{
                h1: "h1";
                h2: "h2";
                h3: "h3";
                h4: "h4";
            }>>;
        }, import("zod/v4/core").$strip>;
        description: string;
        example: {
            text: string;
            level: string;
        };
    };
    Text: {
        props: import("zod").ZodObject<{
            text: import("zod").ZodString;
            variant: import("zod").ZodNullable<import("zod").ZodEnum<{
                caption: "caption";
                body: "body";
                muted: "muted";
                lead: "lead";
                code: "code";
            }>>;
        }, import("zod/v4/core").$strip>;
        description: string;
        example: {
            text: string;
        };
    };
    Image: {
        props: import("zod").ZodObject<{
            src: import("zod").ZodNullable<import("zod").ZodString>;
            alt: import("zod").ZodString;
            width: import("zod").ZodNullable<import("zod").ZodNumber>;
            height: import("zod").ZodNullable<import("zod").ZodNumber>;
        }, import("zod/v4/core").$strip>;
        description: string;
    };
    Avatar: {
        props: import("zod").ZodObject<{
            src: import("zod").ZodNullable<import("zod").ZodString>;
            name: import("zod").ZodString;
            size: import("zod").ZodNullable<import("zod").ZodEnum<{
                sm: "sm";
                md: "md";
                lg: "lg";
            }>>;
        }, import("zod/v4/core").$strip>;
        description: string;
        example: {
            name: string;
            size: string;
        };
    };
    Badge: {
        props: import("zod").ZodObject<{
            text: import("zod").ZodString;
            variant: import("zod").ZodNullable<import("zod").ZodEnum<{
                default: "default";
                secondary: "secondary";
                destructive: "destructive";
                outline: "outline";
            }>>;
        }, import("zod/v4/core").$strip>;
        description: string;
        example: {
            text: string;
            variant: string;
        };
    };
    Alert: {
        props: import("zod").ZodObject<{
            title: import("zod").ZodString;
            message: import("zod").ZodNullable<import("zod").ZodString>;
            type: import("zod").ZodNullable<import("zod").ZodEnum<{
                success: "success";
                info: "info";
                warning: "warning";
                error: "error";
            }>>;
        }, import("zod/v4/core").$strip>;
        description: string;
        example: {
            title: string;
            message: string;
            type: string;
        };
    };
    Progress: {
        props: import("zod").ZodObject<{
            value: import("zod").ZodNumber;
            max: import("zod").ZodNullable<import("zod").ZodNumber>;
            label: import("zod").ZodNullable<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>;
        description: string;
        example: {
            value: number;
            max: number;
            label: string;
        };
    };
    Skeleton: {
        props: import("zod").ZodObject<{
            width: import("zod").ZodNullable<import("zod").ZodString>;
            height: import("zod").ZodNullable<import("zod").ZodString>;
            rounded: import("zod").ZodNullable<import("zod").ZodBoolean>;
        }, import("zod/v4/core").$strip>;
        description: string;
    };
    Spinner: {
        props: import("zod").ZodObject<{
            size: import("zod").ZodNullable<import("zod").ZodEnum<{
                sm: "sm";
                md: "md";
                lg: "lg";
            }>>;
            label: import("zod").ZodNullable<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>;
        description: string;
    };
    Tooltip: {
        props: import("zod").ZodObject<{
            content: import("zod").ZodString;
            text: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        description: string;
    };
    Popover: {
        props: import("zod").ZodObject<{
            trigger: import("zod").ZodString;
            content: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        description: string;
    };
    Input: {
        props: import("zod").ZodObject<{
            label: import("zod").ZodString;
            name: import("zod").ZodString;
            type: import("zod").ZodNullable<import("zod").ZodEnum<{
                number: "number";
                text: "text";
                email: "email";
                password: "password";
            }>>;
            placeholder: import("zod").ZodNullable<import("zod").ZodString>;
            value: import("zod").ZodNullable<import("zod").ZodString>;
            checks: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodObject<{
                type: import("zod").ZodString;
                message: import("zod").ZodString;
                args: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            }, import("zod/v4/core").$strip>>>;
            validateOn: import("zod").ZodNullable<import("zod").ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
        example: {
            label: string;
            name: string;
            type: string;
            placeholder: string;
        };
    };
    Textarea: {
        props: import("zod").ZodObject<{
            label: import("zod").ZodString;
            name: import("zod").ZodString;
            placeholder: import("zod").ZodNullable<import("zod").ZodString>;
            rows: import("zod").ZodNullable<import("zod").ZodNumber>;
            value: import("zod").ZodNullable<import("zod").ZodString>;
            checks: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodObject<{
                type: import("zod").ZodString;
                message: import("zod").ZodString;
                args: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            }, import("zod/v4/core").$strip>>>;
            validateOn: import("zod").ZodNullable<import("zod").ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, import("zod/v4/core").$strip>;
        description: string;
    };
    Select: {
        props: import("zod").ZodObject<{
            label: import("zod").ZodString;
            name: import("zod").ZodString;
            options: import("zod").ZodArray<import("zod").ZodString>;
            placeholder: import("zod").ZodNullable<import("zod").ZodString>;
            value: import("zod").ZodNullable<import("zod").ZodString>;
            checks: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodObject<{
                type: import("zod").ZodString;
                message: import("zod").ZodString;
                args: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            }, import("zod/v4/core").$strip>>>;
            validateOn: import("zod").ZodNullable<import("zod").ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
    };
    Checkbox: {
        props: import("zod").ZodObject<{
            label: import("zod").ZodString;
            name: import("zod").ZodString;
            checked: import("zod").ZodNullable<import("zod").ZodBoolean>;
            checks: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodObject<{
                type: import("zod").ZodString;
                message: import("zod").ZodString;
                args: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            }, import("zod/v4/core").$strip>>>;
            validateOn: import("zod").ZodNullable<import("zod").ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
    };
    Radio: {
        props: import("zod").ZodObject<{
            label: import("zod").ZodString;
            name: import("zod").ZodString;
            options: import("zod").ZodArray<import("zod").ZodString>;
            value: import("zod").ZodNullable<import("zod").ZodString>;
            checks: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodObject<{
                type: import("zod").ZodString;
                message: import("zod").ZodString;
                args: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            }, import("zod/v4/core").$strip>>>;
            validateOn: import("zod").ZodNullable<import("zod").ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
    };
    Switch: {
        props: import("zod").ZodObject<{
            label: import("zod").ZodString;
            name: import("zod").ZodString;
            checked: import("zod").ZodNullable<import("zod").ZodBoolean>;
            checks: import("zod").ZodNullable<import("zod").ZodArray<import("zod").ZodObject<{
                type: import("zod").ZodString;
                message: import("zod").ZodString;
                args: import("zod").ZodOptional<import("zod").ZodRecord<import("zod").ZodString, import("zod").ZodUnknown>>;
            }, import("zod/v4/core").$strip>>>;
            validateOn: import("zod").ZodNullable<import("zod").ZodEnum<{
                change: "change";
                blur: "blur";
                submit: "submit";
            }>>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
    };
    Slider: {
        props: import("zod").ZodObject<{
            label: import("zod").ZodNullable<import("zod").ZodString>;
            min: import("zod").ZodNullable<import("zod").ZodNumber>;
            max: import("zod").ZodNullable<import("zod").ZodNumber>;
            step: import("zod").ZodNullable<import("zod").ZodNumber>;
            value: import("zod").ZodNullable<import("zod").ZodNumber>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
    };
    Button: {
        props: import("zod").ZodObject<{
            label: import("zod").ZodString;
            variant: import("zod").ZodNullable<import("zod").ZodEnum<{
                secondary: "secondary";
                primary: "primary";
                danger: "danger";
            }>>;
            disabled: import("zod").ZodNullable<import("zod").ZodBoolean>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
        example: {
            label: string;
            variant: string;
        };
    };
    Link: {
        props: import("zod").ZodObject<{
            label: import("zod").ZodString;
            href: import("zod").ZodString;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
    };
    DropdownMenu: {
        props: import("zod").ZodObject<{
            label: import("zod").ZodString;
            items: import("zod").ZodArray<import("zod").ZodObject<{
                label: import("zod").ZodString;
                value: import("zod").ZodString;
            }, import("zod/v4/core").$strip>>;
            value: import("zod").ZodNullable<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
    };
    Toggle: {
        props: import("zod").ZodObject<{
            label: import("zod").ZodString;
            pressed: import("zod").ZodNullable<import("zod").ZodBoolean>;
            variant: import("zod").ZodNullable<import("zod").ZodEnum<{
                default: "default";
                outline: "outline";
            }>>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
    };
    ToggleGroup: {
        props: import("zod").ZodObject<{
            items: import("zod").ZodArray<import("zod").ZodObject<{
                label: import("zod").ZodString;
                value: import("zod").ZodString;
            }, import("zod/v4/core").$strip>>;
            type: import("zod").ZodNullable<import("zod").ZodEnum<{
                single: "single";
                multiple: "multiple";
            }>>;
            value: import("zod").ZodNullable<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
    };
    ButtonGroup: {
        props: import("zod").ZodObject<{
            buttons: import("zod").ZodArray<import("zod").ZodObject<{
                label: import("zod").ZodString;
                value: import("zod").ZodString;
            }, import("zod/v4/core").$strip>>;
            selected: import("zod").ZodNullable<import("zod").ZodString>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
    };
    Pagination: {
        props: import("zod").ZodObject<{
            totalPages: import("zod").ZodNumber;
            page: import("zod").ZodNullable<import("zod").ZodNumber>;
        }, import("zod/v4/core").$strip>;
        events: string[];
        description: string;
    };
};
export declare const catalog: import("@json-render/core").Catalog<import("@json-render/core").SchemaDefinition<import("@json-render/core").SchemaType<string, unknown>, import("@json-render/core").SchemaType<string, unknown>>, never>;
export interface JsonRenderIssue {
    path?: PropertyKey[];
    message?: string;
}
interface JsonRenderValidationResult {
    success: boolean;
    data?: unknown;
    error?: {
        issues?: JsonRenderIssue[];
    };
}
export declare function validateShadcnElementProps(spec: unknown): JsonRenderValidationResult;
export {};
