import { createNodeFromClient } from '../state/intent-bridge';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'ico', 'avif']);
const MD_EXTS = new Set(['md', 'mdx', 'markdown']);

export function nodeTypeFromFilename(name: string): 'image' | 'markdown' | 'file' {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (MD_EXTS.has(ext)) return 'markdown';
  return 'file';
}

/**
 * Turn local files into nodes laid out in a grid around a world point — the
 * one implementation behind the viewport's drop zone and the empty state's
 * file picker. Images become image nodes (data URI), markdown becomes
 * markdown, everything else a file node with the text inlined.
 */
export async function importFiles(files: File[], baseWx: number, baseWy: number): Promise<void> {
  const nodeW = 400;
  const nodeH = 300;
  const spacing = 20;
  const cols = Math.ceil(Math.sqrt(files.length));

  for (let i = 0; i < files.length; i++) {
    const file = files[i]!;
    const col = i % cols;
    const row = Math.floor(i / cols);
    const wx = baseWx - (cols * (nodeW + spacing)) / 2 + col * (nodeW + spacing);
    const wy = baseWy - nodeH / 2 + row * (nodeH + spacing);

    const type = nodeTypeFromFilename(file.name);
    const fileName = file.name;

    if (type === 'image') {
      const reader = new FileReader();
      const dataUri: string = await new Promise((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      await createNodeFromClient({
        type: 'image',
        title: fileName,
        content: dataUri,
        x: wx,
        y: wy,
        width: nodeW,
        height: nodeH,
      });
    } else {
      const text = await file.text();
      const isWide = type === 'markdown' || type === 'file';
      await createNodeFromClient({
        type,
        title: fileName,
        content: text,
        x: wx,
        y: wy,
        width: isWide ? 720 : nodeW,
        height: isWide ? 500 : nodeH,
      });
    }
  }
}
