import { mkdirSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { z } from 'zod';
import { isCanvasTheme } from '../../shared/themes.js';
import { derivedTour, tourSchema, tourFrames, type Camera, type TourNode } from '../../shared/tour.js';
import {
  startCanvasAutomationWebView,
  evaluateCanvasAutomationWebView,
  screenshotCanvasAutomationWebView,
  resizeCanvasAutomationWebView,
  stopCanvasAutomationWebView,
} from '../../server/server.js';
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
    let count = 0;
    let duplicated = 0;
    try {
      await startCanvasAutomationWebView(url.href, {
        backend: 'chrome',
        width: options.width,
        height: options.height,
        chromePath: options.chromePath,
      });
      const deadline = Date.now() + 30_000;
      while (!(await evaluateCanvasAutomationWebView('!!window.pmxCapture?.ready()'))) {
        if (Date.now() > deadline) throw new Error('Workbench did not become capture-ready in 30 seconds');
        await Bun.sleep(50);
      }
      // Chrome launch dimensions describe the outer window. WebView.resize
      // applies viewport emulation, giving screenshots the requested pixels.
      await resizeCanvasAutomationWebView(options.width, options.height);
      await evaluateCanvasAutomationWebView(
        'new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(true))))',
      );
      await evaluateCanvasAutomationWebView('document.fonts.ready.then(() => true)');
      const area = (await evaluateCanvasAutomationWebView('window.pmxCapture.area()')) as {
        width: number;
        height: number;
      };
      const initial = (await evaluateCanvasAutomationWebView('window.pmxCapture.camera()')) as Camera;
      mkdirSync(framesPath, { recursive: true });
      const write = async (bytes: Uint8Array) => {
        await Bun.write(join(framesPath, `frame-${String(count++).padStart(6, '0')}.png`), bytes);
      };
      const started = performance.now();
      if (tour) {
        for (const camera of tourFrames(tour, initial, board.nodes, area.width, area.height, options.fps)) {
          if (stopping) break;
          const applied = (await evaluateCanvasAutomationWebView(
            `window.pmxCapture.frame(${JSON.stringify(camera)})`,
          )) as Camera;
          if (applied.x !== camera.x || applied.y !== camera.y || applied.scale !== camera.scale) {
            throw new Error('Capture camera was changed before paint');
          }
          await write(await screenshotCanvasAutomationWebView({ format: 'png' }));
        }
      } else {
        const limit = options.duration ? Math.ceil(options.duration * options.fps) : Infinity;
        while (!stopping && count < limit) {
          await Bun.sleep(Math.max(0, started + (count / options.fps) * 1000 - performance.now()));
          const bytes = await screenshotCanvasAutomationWebView({ format: 'png' });
          await write(bytes);
          // Preserve wall-clock speed if capture is slower than requested fps.
          const elapsedFrames = Math.min(limit, Math.floor(((performance.now() - started) / 1000) * options.fps));
          while (count < elapsedFrames) {
            await write(bytes);
            duplicated++;
          }
        }
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
      await stopCanvasAutomationWebView();
    }
    let encoded = false;
    if (video && count > 0) {
      const ffmpeg = Bun.which('ffmpeg');
      if (!ffmpeg) console.error(`ffmpeg not found; PNG sequence retained at ${framesPath}`);
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
        if (!encoded) throw new Error(`ffmpeg failed; PNG sequence retained at ${framesPath}`);
      }
    }
    output({ ok: true, output: encoded ? outputPath : framesPath, frames: count, fps: options.fps, duplicated });
  },
);
