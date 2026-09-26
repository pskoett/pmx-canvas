import { type Camera } from '../../shared/tour.js';
import { canvasArea } from './canvas-area';
declare global {
    interface Window {
        pmxCapture?: {
            ready: () => boolean;
            area: typeof canvasArea;
            camera: () => Camera;
            frame: (camera: Camera) => Promise<Camera>;
        };
    }
}
export declare function Presentation(): import("preact/jsx-runtime").JSX.Element | null;
