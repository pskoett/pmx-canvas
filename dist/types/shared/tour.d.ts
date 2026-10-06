import { z } from 'zod';
export declare const cameraSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    scale: z.ZodNumber;
}, z.core.$strip>;
/** A world-space box: `{ x, y }` is its top-left corner. */
export declare const rectSchema: z.ZodObject<{
    x: z.ZodNumber;
    y: z.ZodNumber;
    width: z.ZodNumber;
    height: z.ZodNumber;
}, z.core.$strip>;
export declare const tourTargetSchema: z.ZodUnion<readonly [z.ZodObject<{
    nodeId: z.ZodString;
}, z.core.$strict>, z.ZodObject<{
    rect: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        width: z.ZodNumber;
        height: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strict>, z.ZodObject<{
    viewport: z.ZodObject<{
        x: z.ZodNumber;
        y: z.ZodNumber;
        scale: z.ZodNumber;
    }, z.core.$strip>;
}, z.core.$strict>]>;
export declare const tourStopSchema: z.ZodObject<{
    target: z.ZodUnion<readonly [z.ZodObject<{
        nodeId: z.ZodString;
    }, z.core.$strict>, z.ZodObject<{
        rect: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            width: z.ZodNumber;
            height: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strict>, z.ZodObject<{
        viewport: z.ZodObject<{
            x: z.ZodNumber;
            y: z.ZodNumber;
            scale: z.ZodNumber;
        }, z.core.$strip>;
    }, z.core.$strict>]>;
    duration: z.ZodOptional<z.ZodNumber>;
    easing: z.ZodOptional<z.ZodEnum<{
        linear: "linear";
        "ease-in-out": "ease-in-out";
        "ease-out": "ease-out";
    }>>;
    padding: z.ZodOptional<z.ZodNumber>;
    pullback: z.ZodOptional<z.ZodNumber>;
}, z.core.$strip>;
export declare const tourSchema: z.ZodObject<{
    stops: z.ZodArray<z.ZodObject<{
        target: z.ZodUnion<readonly [z.ZodObject<{
            nodeId: z.ZodString;
        }, z.core.$strict>, z.ZodObject<{
            rect: z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
                width: z.ZodNumber;
                height: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strict>, z.ZodObject<{
            viewport: z.ZodObject<{
                x: z.ZodNumber;
                y: z.ZodNumber;
                scale: z.ZodNumber;
            }, z.core.$strip>;
        }, z.core.$strict>]>;
        duration: z.ZodOptional<z.ZodNumber>;
        easing: z.ZodOptional<z.ZodEnum<{
            linear: "linear";
            "ease-in-out": "ease-in-out";
            "ease-out": "ease-out";
        }>>;
        padding: z.ZodOptional<z.ZodNumber>;
        pullback: z.ZodOptional<z.ZodNumber>;
    }, z.core.$strip>>;
}, z.core.$strip>;
export type Tour = z.infer<typeof tourSchema>;
export type TourStop = z.infer<typeof tourStopSchema>;
export type Camera = z.infer<typeof cameraSchema>;
export type Rect = z.infer<typeof rectSchema>;
export interface TourNode {
    id: string;
    type: string;
    position: {
        x: number;
        y: number;
    };
    size: {
        width: number;
        height: number;
    };
}
export declare function derivedTour(nodes: TourNode[]): Tour;
export declare function resolveStop(stop: TourStop, nodes: TourNode[], width: number, height: number): Camera;
/** Interpolate world-space centres and log zoom; translations remain screen-space. */
export declare function interpolateCamera(from: Camera, to: Camera, progress: number, width: number, height: number, easing?: TourStop['easing'], pullback?: number): Camera;
/** Each segment includes its endpoint; zero-duration stops take one frame. */
export declare function segmentFrameCount(duration: number, fps: number): number;
export declare function tourFrames(tour: Tour, initial: Camera, nodes: TourNode[], width: number, height: number, fps: number): Generator<{
    x: number;
    y: number;
    scale: number;
}, void, unknown>;
