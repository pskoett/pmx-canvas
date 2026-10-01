import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import { IconChevronDown } from '../icons';

/** Themed single-choice menu shared by the feedback form and steering composer. */
export function ChoiceMenu({
  label,
  value,
  options,
  onChange,
  className = '',
  above = false,
}: {
  label: string;
  value: string;
  options: Array<{ value: string; label: string; disabled?: boolean }>;
  onChange: (value: string) => void;
  className?: string;
  above?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const close = () => {
    setOpen(false);
    trigger.current?.focus();
  };

  useLayoutEffect(() => {
    if (!open) return;
    const selected = menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not(:disabled)');
    (selected ?? menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  return (
    <div
      ref={root}
      class={`choice-menu ${className}`}
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && !root.current?.contains(e.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(e) => {
        // Menu typing/navigation must not trigger canvas tool shortcuts.
        // Tab still reaches modal focus traps; closed Escape reaches the dialog.
        if (e.key !== 'Tab' && (e.key !== 'Escape' || open)) e.stopPropagation();
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          e.stopPropagation();
          close();
        }
        if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(e.key)) {
          e.preventDefault();
          e.stopPropagation();
          if (!open) {
            setOpen(true);
            return;
          }
          const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])];
          if (!items.length) return;
          const index = items.findIndex((item) => item === document.activeElement);
          const next =
            e.key === 'Home'
              ? 0
              : e.key === 'End'
                ? items.length - 1
                : (index + (e.key === 'ArrowUp' ? -1 : 1) + items.length) % items.length;
          items[next]?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        type="button"
        class="choice-menu-trigger"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        <span>{options.find((option) => option.value === value)?.label ?? label}</span>
        <IconChevronDown size={14} />
      </button>
      {open && (
        <div
          ref={menu}
          role="menu"
          aria-label={label}
          class={`toolbar-menu choice-menu-options${above ? ' opens-above' : ''}`}
        >
          {options.map((option) => (
            <button
              key={option.value}
              type="button"
              role="menuitemradio"
              class={`toolbar-menu-item${option.value === value ? ' active' : ''}`}
              aria-checked={option.value === value}
              disabled={option.disabled}
              tabIndex={-1}
              data-value={option.value}
              onClick={() => {
                onChange(option.value);
                close();
              }}
            >
              <span>{option.label}</span>
              {option.value === value && (
                <span class="toolbar-menu-check" aria-hidden="true">
                  ✓
                </span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
