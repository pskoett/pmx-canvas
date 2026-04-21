// Type shim: @joplin/turndown-plugin-gfm ships without bundled TS types.
declare module '@joplin/turndown-plugin-gfm' {
  import type TurndownService from 'turndown';
  export function gfm(td: TurndownService): void;
}
