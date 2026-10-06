import { existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { isCanvasTheme } from '../../shared/themes.js';
import { derivedTour, tourSchema, tourFrames, type Camera, type TourNode } from '../../shared/tour.js';
import { cmd, getBaseUrl, invokeOperation, output, parseFlags, showCommandHelp } from '../shared.js';

export function parseRecordOptions(flags: Record<string, string | boolean>) {
  const number = (key: string, fallback: number) => {
    if (flags[key] === true || flags[key] === false) throw new Error(`--${key} needs a number`);
    return flags[key] === undefined ? fallback : Number(flags[key]);
  };
  for (const key of ['tour-file', 'chrome-path']) {
    if (flags[key] !== undefined && typeof flags[key] !== 'string') throw new Error(`--${key} needs a path`);
  }
  const resolution = String(flags.resolution ?? '1280x720').match(/^(\d+)x(\d+)$/);
  if (!resolution) throw new Error('Use --resolution WIDTHxHEIGHT');
  const options = z
    .object({
      width: z.number().int().min(64).max(7680),
      height: z.number().int().min(64).max(4320),
      fps: z.number().int().min(1).max(120),
      duration: z.number().positive().max(86400).optional(),
      mode: z.enum(['realtime', 'deterministic']),
      output: z.string().min(1),
    })
    .parse({
      width: Number(resolution[1]),
      height: Number(resolution[2]),
      fps: number('fps', 30),
      duration: flags.duration === undefined ? undefined : number('duration', 10),
      mode: flags.mode ?? 'realtime',
      output: typeof flags.output === 'string' ? flags.output : '',
    });
  if (flags.theme !== undefined && !isCanvasTheme(flags.theme)) throw new Error('Unknown --theme');
  if (options.mode === 'realtime' && !options.duration && flags['stop-on-signal'] !== true) {
    throw new Error('Realtime recording needs --duration SECONDS or --stop-on-signal');
  }
  if (options.mode === 'deterministic' && (flags.duration !== undefined || flags['stop-on-signal'])) {
    throw new Error('Deterministic duration comes from tour stops; omit --duration and --stop-on-signal');
  }
  if (flags['tour-file'] && options.mode !== 'deterministic')
    throw new Error('--tour-file requires --mode deterministic');
  return {
    ...options,
    theme: typeof flags.theme === 'string' ? flags.theme : undefined,
    present: flags.present === true,
    tourFile: typeof flags['tour-file'] === 'string' ? flags['tour-file'] : undefined,
    chromePath: typeof flags['chrome-path'] === 'string' ? flags['chrome-path'] : undefined,
  };
}

cmd('tour get', 'Read the persisted tour or derived group order', ['pmx-canvas tour get'], async () => {
  output(await invokeOperation('tour.get', {}));
});
cmd(
  'tour set',
  'Persist camera stops from JSON (null resets to group order)',
  ['pmx-canvas tour set --file tour.json'],
  async (args) => {
    const { flags } = parseFlags(args);
    if (flags.help) return showCommandHelp('tour set');
    if (typeof flags.file !== 'string') throw new Error('Missing --file');
    const tour = tourSchema.nullable().parse(await Bun.file(flags.file).json());
    output(await invokeOperation('tour.set', { tour }));
  },
);

// Bun.WebView is not in bun-types yet; record needs its CDP channel, which the
// shared automation session does not expose, so it owns its own Chrome view.
interface CaptureView extends EventTarget {
  navigate(url: string): Promise<void>;
  evaluate(expression: string): Promise<unknown>;
  screenshot(options: { format: 'png' }): Promise<Uint8Array | ArrayBuffer | Blob>;
  resize(width: number, height: number): Promise<void>;
  cdp(method: string, params?: Record<string, unknown>): Promise<unknown>;
  close(): void;
}
type CaptureViewConstructor = new (options: {
  width: number;
  height: number;
  headless: true;
  backend: 'chrome' | { type: 'chrome'; path: string };
  dataStore: 'ephemeral';
}) => CaptureView;
interface ScreencastFrame {
  data: string;
  sessionId: number;
  metadata: { timestamp: number };
}

// A cold Chrome launch on macOS has been measured at 15–30 s.
const CAPTURE_TIMEOUT_MS = 60_000;
function timed<T>(task: Promise<T>, action: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    task,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Timed out after 60 s while ${action}`)), CAPTURE_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

cmd(
  'record',
  'Optionally capture the board tour or live presentation using Bun.WebView Chrome',
  [
    'pmx-canvas record --duration 10 --present --output demo.mp4',
    'pmx-canvas record --mode deterministic --tour-file tour.json --present --fps 30 --output frames',
    'pmx-canvas record --stop-on-signal --resolution 1920x1080 --output live.mp4',
  ],
  async (args) => {
    const { flags } = parseFlags(args, { boolFlags: ['present', 'stop-on-signal'] });
    if (flags.help || flags.h) return showCommandHelp('record');
    const options = parseRecordOptions(flags);
    const outputPath = resolve(options.output);
    const video = /\.mp4$/i.test(outputPath);
    const framesPath = video ? `${outputPath}.frames` : outputPath;
    if (existsSync(outputPath) || existsSync(framesPath)) throw new Error('Output already exists; choose a new path');
    const WebView = (Bun as typeof Bun & { WebView?: CaptureViewConstructor }).WebView;
    if (!WebView) throw new Error(`Bun.WebView is not available in Bun ${Bun.version}; Bun >=1.3.12 is required`);
    const response = await fetch(`${getBaseUrl()}/api/canvas/state`);
    if (!response.ok) throw new Error(`Cannot read board: HTTP ${response.status}`);
    const board = (await response.json()) as { nodes: TourNode[]; viewport: Camera; tour?: unknown };
    const tour =
      options.mode === 'deterministic'
        ? tourSchema.parse(
            options.tourFile ? await Bun.file(options.tourFile).json() : (board.tour ?? derivedTour(board.nodes)),
          )
        : undefined;
    if (tour && !tour.stops.length) throw new Error('No tour stops: supply --tour-file or create groups/a tour');
    const url = new URL('/workbench', getBaseUrl());
    if (options.present) url.searchParams.set('present', '1');
    if (tour) url.searchParams.set('capture', '1');
    if (options.theme) url.searchParams.set('theme', options.theme);
    let stopping = false;
    const stop = () => {
      stopping = true;
    };
    process.on('SIGINT', stop);
    process.on('SIGTERM', stop);
    const frameName = (i: number) => join(framesPath, `frame-${String(i).padStart(6, '0')}.png`);
    let count = 0;
    let duplicated = 0;
    const view = new WebView({
      width: options.width,
      height: options.height,
      headless: true,
      backend: options.chromePath ? { type: 'chrome', path: options.chromePath } : 'chrome',
      dataStore: 'ephemeral',
    });
    try {
      await timed(view.navigate(url.href), 'launching Chrome and loading the workbench');
      const deadline = Date.now() + 30_000;
      while (!(await timed(view.evaluate('!!window.pmxCapture?.ready()'), 'waiting for the workbench'))) {
        if (Date.now() > deadline) throw new Error('Workbench did not become capture-ready in 30 seconds');
        await Bun.sleep(50);
      }
      // Chrome launch dimensions describe the outer window. WebView.resize
      // applies viewport emulation, giving captures the requested pixels.
      await timed(view.resize(options.width, options.height), 'resizing the capture viewport');
      await timed(
        view.evaluate('new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))'),
        'waiting for paint',
      );
      await timed(view.evaluate('document.fonts.ready.then(() => true)'), 'waiting for fonts');
      mkdirSync(framesPath, { recursive: true });
      if (tour) {
        const area = (await view.evaluate('window.pmxCapture.area()')) as { width: number; height: number };
        const initial = (await view.evaluate('window.pmxCapture.camera()')) as Camera;
        for (const camera of tourFrames(tour, initial, board.nodes, area.width, area.height, options.fps)) {
          if (stopping) break;
          // Wait until the rendered .canvas-world matrix (screen = world * scale + offset)
          // matches the requested camera, not just the viewport signal. Computed
          // transforms keep six significant digits, hence the tolerances.
          const applied = await timed(
            view.evaluate(`window.pmxCapture.frame(${JSON.stringify(camera)}).then(async (c) => {
              const world = document.querySelector('.canvas-world');
              for (let i = 0; i < 30; i++) {
                const m = new DOMMatrix(getComputedStyle(world).transform);
                if (Math.abs(m.a / c.scale - 1) < 1e-5 && Math.abs(m.e - c.x) < 0.5 && Math.abs(m.f - c.y) < 0.5) return c;
                await new Promise((r) => requestAnimationFrame(r));
              }
              return getComputedStyle(world).transform;
            })`),
            'applying a camera frame',
          );
          if (JSON.stringify(applied) !== JSON.stringify(camera)) {
            throw new Error(
              `Frame ${count}: the canvas rendered ${JSON.stringify(applied)} instead of camera ${JSON.stringify(camera)}`,
            );
          }
          await Bun.write(frameName(count++), await timed(view.screenshot({ format: 'png' }), 'capturing a frame'));
        }
      } else {
        // Chrome pushes a frame on every paint and holds the next until the
        // previous is acked; cdp() allows one call in flight, so acks chain.
        // Each tick writes the newest painted frame, so frames land while recording.
        let latest: Buffer | undefined;
        let written: Buffer | undefined;
        let cdpQueue: Promise<unknown> = Promise.resolve();
        const send = (method: string, params?: Record<string, unknown>) => {
          cdpQueue = cdpQueue.then(() => view.cdp(method, params));
          return cdpQueue;
        };
        view.addEventListener('Page.screencastFrame', (event) => {
          const frame = (event as MessageEvent<ScreencastFrame>).data;
          latest = Buffer.from(frame.data, 'base64');
          void send('Page.screencastFrameAck', { sessionId: frame.sessionId });
        });
        await timed(
          send('Page.startScreencast', { format: 'png', maxWidth: options.width, maxHeight: options.height }),
          'starting the screencast',
        );
        const firstDeadline = Date.now() + 10_000;
        while (!latest) {
          if (Date.now() > firstDeadline) throw new Error('Chrome sent no screencast frames');
          await Bun.sleep(10);
        }
        const started = performance.now();
        const interval = 1000 / options.fps;
        while (!stopping && (!options.duration || count < Math.ceil(options.duration * options.fps))) {
          if (latest === written) duplicated++;
          written = latest;
          await Bun.write(frameName(count++), latest);
          const wait = started + count * interval - performance.now();
          if (wait > 0) await Bun.sleep(wait);
        }
        await timed(send('Page.stopScreencast'), 'stopping the screencast');
      }
      await Bun.write(
        join(framesPath, 'recording.json'),
        JSON.stringify(
          {
            mode: options.mode,
            fps: options.fps,
            width: options.width,
            height: options.height,
            frames: count,
            duplicated,
            seconds: count / options.fps,
          },
          null,
          2,
        ),
      );
    } finally {
      process.off('SIGINT', stop);
      process.off('SIGTERM', stop);
      view.close();
    }
    let encoded = false;
    if (video && count > 0) {
      const ffmpeg = Bun.which('ffmpeg');
      if (!ffmpeg) console.error(`ffmpeg not found; frame sequence retained at ${framesPath}`);
      else {
        const process = Bun.spawn(
          [
            ffmpeg,
            '-n',
            '-framerate',
            String(options.fps),
            '-i',
            join(framesPath, 'frame-%06d.png'),
            '-c:v',
            'libx264',
            '-pix_fmt',
            'yuv420p',
            '-vf',
            'pad=ceil(iw/2)*2:ceil(ih/2)*2',
            outputPath,
          ],
          { stdout: 'ignore', stderr: 'inherit' },
        );
        encoded = (await process.exited) === 0;
        if (!encoded) throw new Error(`ffmpeg failed; frame sequence retained at ${framesPath}`);
      }
    }
    output({ ok: true, output: encoded ? outputPath : framesPath, frames: count, fps: options.fps, duplicated });
  },
);
