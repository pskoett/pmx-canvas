import { createNodeFromClient, requestJson } from '../state/intent-bridge';
import { activeBoardId } from '../state/boards-store';
import { showToast } from '../state/attention-bridge';

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
  const boardId = activeBoardId.value;
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

    if (/\.(pdf|pptx?|xlsx?|docx?|od[pts])$/i.test(fileName)) {
      if (!boardId || file.size === 0 || file.size > 20 * 1024 * 1024) {
        showToast('remove', 'File not attached', 'Open a board and choose a nonempty file under 20 MiB.');
        continue;
      }
      const query = new URLSearchParams({ boardId, name: fileName, mime: file.type, x: String(wx), y: String(wy) });
      showToast('context', 'Attaching document', fileName);
      await requestJson('attachDocument', `/api/canvas/attachments?${query}`, null, { method: 'POST', body: file });
      continue;
    }
    if (activeBoardId.value !== boardId) return;
    if (type === 'image') {
      const reader = new FileReader();
      const dataUri: string = await new Promise((resolve) => {
        reader.onload = () => resolve(reader.result as string);
        reader.readAsDataURL(file);
      });
      if (activeBoardId.value !== boardId) return;
      await createNodeFromClient({
        type: 'image',
        title: fileName,
        content: dataUri,
        x: wx,
        y: wy,
        width: nodeW,
        height: nodeH,
        ...(boardId ? { boardId } : {}),
      });
    } else {
      const text = await file.text();
      if (activeBoardId.value !== boardId) return;
      const isWide = type === 'markdown' || type === 'file';
      await createNodeFromClient({
        type,
        title: fileName,
        content: text,
        x: wx,
        y: wy,
        width: isWide ? 720 : nodeW,
        height: isWide ? 500 : nodeH,
        ...(boardId ? { boardId } : {}),
      });
    }
  }
}
