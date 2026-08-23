export declare function nodeTypeFromFilename(name: string): 'image' | 'markdown' | 'file';
/**
 * Turn local files into nodes laid out in a grid around a world point — the
 * one implementation behind the viewport's drop zone and the empty state's
 * file picker. Images become image nodes (data URI), markdown becomes
 * markdown, everything else a file node with the text inlined.
 */
export declare function importFiles(files: File[], baseWx: number, baseWy: number): Promise<void>;
