import { MOD_KEY as MOD } from '../utils/platform';

interface ShortcutGroup {
  title: string;
  shortcuts: Array<{ keys: string; desc: string }>;
}

const GROUPS: ShortcutGroup[] = [
  {
    title: 'Navigation',
    shortcuts: [
      { keys: `${MOD}+K`, desc: 'Command palette — search nodes & actions' },
      { keys: 'Tab / Shift+Tab', desc: 'Cycle through nodes' },
      { keys: '\u2190 \u2191 \u2192 \u2193', desc: 'Walk graph along edges (when node focused)' },
      { keys: `${MOD}+0`, desc: 'Reset viewport to origin' },
      { keys: `${MOD}++ / ${MOD}+\u2212`, desc: 'Zoom in / out' },
    ],
  },
  {
    title: 'Creation',
    shortcuts: [
      { keys: 'Double-click', desc: 'Create new markdown note on canvas' },
      { keys: 'Drag port \u2192 node', desc: 'Connect two nodes (hover to reveal ports)' },
    ],
  },
  {
    title: 'Selection',
    shortcuts: [
      { keys: 'Click', desc: 'Focus node (highlights neighbors & edges)' },
      { keys: 'Shift+Click', desc: 'Toggle node in multi-selection' },
      { keys: 'Shift+Drag', desc: 'Lasso select multiple nodes' },
      { keys: 'Esc', desc: 'Clear selection / close overlay' },
    ],
  },
  {
    title: 'View',
    shortcuts: [
      { keys: '?', desc: 'Toggle this shortcut overlay' },
      { keys: 'Minimap', desc: 'Click/drag to navigate (toggle in toolbar)' },
      { keys: 'Right-click', desc: 'Context menu — dock, focus, connect' },
    ],
  },
];

export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  return (
    <div class="shortcut-overlay-backdrop" onMouseDown={onClose}>
      <div class="shortcut-overlay" onMouseDown={(e) => e.stopPropagation()}>
        <div class="shortcut-overlay-header">
          <span class="shortcut-overlay-title">Keyboard Shortcuts</span>
          <span class="shortcut-overlay-hint">Press <kbd>?</kbd> or <kbd>Esc</kbd> to close</span>
        </div>
        <div class="shortcut-overlay-body">
          {GROUPS.map((group) => (
            <div key={group.title} class="shortcut-group">
              <div class="shortcut-group-title">{group.title}</div>
              {group.shortcuts.map((s) => (
                <div key={s.keys} class="shortcut-row">
                  <kbd class="shortcut-keys">{s.keys}</kbd>
                  <span class="shortcut-desc">{s.desc}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
