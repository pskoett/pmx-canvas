export declare const schema: import("@json-render/core").Schema<{
    spec: import("@json-render/core").SchemaType<"object", {
        root: import("@json-render/core").SchemaType<"string", unknown>;
        elements: import("@json-render/core").SchemaType<"record", import("@json-render/core").SchemaType<"object", {
            type: import("@json-render/core").SchemaType<"ref", string>;
            props: import("@json-render/core").SchemaType<"propsOf", string>;
            children: import("@json-render/core").SchemaType<"array", import("@json-render/core").SchemaType<"string", unknown>>;
            visible: import("@json-render/core").SchemaType<"any", unknown>;
        }>>;
    }>;
    catalog: import("@json-render/core").SchemaType<"object", {
        components: import("@json-render/core").SchemaType<"map", {
            props: import("@json-render/core").SchemaType<"zod", unknown>;
            slots: import("@json-render/core").SchemaType<"array", import("@json-render/core").SchemaType<"string", unknown>>;
            description: import("@json-render/core").SchemaType<"string", unknown>;
            example: import("@json-render/core").SchemaType<"any", unknown>;
        }>;
        actions: import("@json-render/core").SchemaType<"map", {
            params: import("@json-render/core").SchemaType<"zod", unknown>;
            description: import("@json-render/core").SchemaType<"string", unknown>;
        }>;
    }>;
}>;
export declare const elementTreeSchema: import("@json-render/core").Schema<{
    spec: import("@json-render/core").SchemaType<"object", {
        root: import("@json-render/core").SchemaType<"string", unknown>;
        elements: import("@json-render/core").SchemaType<"record", import("@json-render/core").SchemaType<"object", {
            type: import("@json-render/core").SchemaType<"ref", string>;
            props: import("@json-render/core").SchemaType<"propsOf", string>;
            children: import("@json-render/core").SchemaType<"array", import("@json-render/core").SchemaType<"string", unknown>>;
            visible: import("@json-render/core").SchemaType<"any", unknown>;
        }>>;
    }>;
    catalog: import("@json-render/core").SchemaType<"object", {
        components: import("@json-render/core").SchemaType<"map", {
            props: import("@json-render/core").SchemaType<"zod", unknown>;
            slots: import("@json-render/core").SchemaType<"array", import("@json-render/core").SchemaType<"string", unknown>>;
            description: import("@json-render/core").SchemaType<"string", unknown>;
            example: import("@json-render/core").SchemaType<"any", unknown>;
        }>;
        actions: import("@json-render/core").SchemaType<"map", {
            params: import("@json-render/core").SchemaType<"zod", unknown>;
            description: import("@json-render/core").SchemaType<"string", unknown>;
        }>;
    }>;
}>;
