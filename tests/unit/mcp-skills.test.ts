import { afterEach, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { z } from 'zod';
import { createBundledSkillCatalog } from '../../src/server/bundled-skills.js';
import { registerSkillExtension } from '../../src/mcp/skills.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'pmx-skills-'));
  roots.push(root);
  mkdirSync(join(root, 'example', 'references'), { recursive: true });
  const markdown =
    '---\r\nname: example\r\ndescription: "A quoted: description"\r\nmetadata:\r\n  version: "1.2"\r\n---\r\n# Example\r\n';
  writeFileSync(join(root, 'example', 'SKILL.md'), markdown);
  writeFileSync(join(root, 'example', 'references', 'guide.md'), '# Café\n');
  writeFileSync(join(root, 'example', 'asset.bin'), Buffer.from([0, 255, 128, 42]));
  return { root, markdown };
}

describe('Skills extension', () => {
  test('serves complete, byte-verified manifests and supporting files without adding tools', async () => {
    const { root, markdown } = fixture();
    const server = new McpServer({ name: 'skills-test', version: '1' });
    registerSkillExtension(server, createBundledSkillCatalog(root));
    const client = new Client({ name: 'skills-test-client', version: '1' });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const sent: unknown[] = [];
    const send = serverTransport.send.bind(serverTransport);
    serverTransport.send = async (message, options) => {
      sent.push(message);
      await send(message, options);
    };
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    try {
      // The installed SDK strips unknown capabilities when parsing initialize,
      // so inspect the actual wire envelope as well as exercising SDK reads.
      expect(sent).toContainEqual(
        expect.objectContaining({
          result: expect.objectContaining({
            capabilities: expect.objectContaining({
              resources: expect.any(Object),
              extensions: { 'io.modelcontextprotocol/skills': {} },
            }),
          }),
        }),
      );
      const entrySchema = z.object({
        uri: z.string(),
        frontmatter: z.object({
          name: z.string(),
          description: z.string(),
          metadata: z.object({ version: z.string() }),
        }),
        resources: z.array(z.object({ uri: z.string(), digest: z.string(), size: z.number() })),
      });
      const listed = await client.request({ method: 'skills/list' }, z.object({ skills: z.array(entrySchema) }));
      expect(listed.skills).toHaveLength(1);
      const entry = listed.skills[0]!;
      expect(entry.uri).toBe('skill://example/SKILL.md');
      expect(entry.frontmatter).toEqual({
        name: 'example',
        description: 'A quoted: description',
        metadata: { version: '1.2' },
      });
      expect(entry.resources.map((file) => file.uri)).toEqual([
        'skill://example/SKILL.md',
        'skill://example/asset.bin',
        'skill://example/references/guide.md',
      ]);
      const fetched = await client.request(
        { method: 'skills/get', params: { uri: entry.uri } },
        z.object({ skill: entrySchema }),
      );
      expect(fetched.skill).toEqual(entry);
      // A package edit after startup cannot mix old manifests with new bytes.
      writeFileSync(join(root, 'example', 'SKILL.md'), 'changed after catalog creation');
      for (const file of entry.resources) {
        const result = await client.readResource({ uri: file.uri });
        const content = result.contents[0]!;
        const bytes = 'text' in content ? Buffer.from(content.text) : Buffer.from(content.blob, 'base64');
        expect(bytes.length).toBe(file.size);
        expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(file.digest);
        if (file.uri === entry.uri) expect(bytes.toString()).toBe(markdown);
        if (file.uri.endsWith('guide.md')) expect(bytes.toString()).toBe('# Café\n');
        if (file.uri.endsWith('asset.bin')) expect(bytes).toEqual(Buffer.from([0, 255, 128, 42]));
      }
      for (const uri of ['skill://missing/SKILL.md', 'skill://example/references/guide.md']) {
        await expect(client.request({ method: 'skills/get', params: { uri } }, z.object({}))).rejects.toMatchObject({
          code: -32602,
        });
      }
      for (const uri of [
        'skill://example/../../package.json',
        'skill://example/%2e%2e/secret',
        'skill://example/missing',
        'file:///etc/passwd',
      ]) {
        await expect(client.readResource({ uri })).rejects.toMatchObject({ code: -32602 });
      }
      await expect(
        client.request({ method: 'skills/list', params: { cursor: 'invalid' } }, z.object({})),
      ).rejects.toMatchObject({ code: -32602 });
      await expect(
        client.request({ method: 'resources/directory/read', params: { uri: 'skill://example' } }, z.object({})),
      ).rejects.toMatchObject({ code: -32601 });
    } finally {
      await client.close();
      await clientTransport.close();
      await server.close();
    }
  });

  test('rejects symlinked files instead of publishing an incomplete or escaped manifest', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'secret'), 'outside skill');
    symlinkSync(join(root, 'secret'), join(root, 'example', 'leak.md'));
    expect(() => createBundledSkillCatalog(root)).toThrow(/symbolic link/i);
  });

  test('rejects frontmatter names that differ from the directory', () => {
    const { root } = fixture();
    writeFileSync(join(root, 'example', 'SKILL.md'), '---\nname: other\ndescription: mismatch\n---\n');
    expect(() => createBundledSkillCatalog(root)).toThrow(/name/i);
  });

  test('rejects a non-file SKILL.md before reading it', () => {
    const { root } = fixture();
    rmSync(join(root, 'example', 'SKILL.md'));
    mkdirSync(join(root, 'example', 'SKILL.md'));
    expect(() => createBundledSkillCatalog(root)).toThrow(/non-regular file/);
  });

  test('accepts 512 files but rejects a 513th file', () => {
    const { root } = fixture();
    for (let i = 0; i < 509; i++) writeFileSync(join(root, 'example', `${i}.txt`), 'x');
    expect(createBundledSkillCatalog(root).skills[0]!.resources).toHaveLength(512);
    writeFileSync(join(root, 'example', 'extra.txt'), 'x');
    expect(() => createBundledSkillCatalog(root)).toThrow(/limits/);
  });

  test('accepts exactly 16 MiB but rejects one byte over', () => {
    const { root } = fixture();
    const initial = createBundledSkillCatalog(root).skills[0]!.resources.reduce((sum, file) => sum + file.size, 0);
    const padding = Buffer.alloc(16 * 1024 * 1024 - initial);
    writeFileSync(join(root, 'example', 'padding.bin'), padding);
    expect(createBundledSkillCatalog(root).skills[0]!.resources.reduce((sum, file) => sum + file.size, 0)).toBe(
      16 * 1024 * 1024,
    );
    writeFileSync(join(root, 'example', 'extra.txt'), 'x');
    expect(() => createBundledSkillCatalog(root)).toThrow(/limits/);
  });

  test('stdio serves every packaged skill file with matching frontmatter and bytes', async () => {
    // Also runnable against a clean tarball install by setting this to its package root.
    const packageRoot = process.env.PMX_SKILLS_TEST_PACKAGE ?? fileURLToPath(new URL('../../', import.meta.url));
    const workspace = mkdtempSync(join(tmpdir(), 'pmx-skills-consumer-'));
    roots.push(workspace);
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [join(packageRoot, 'src/cli/index.ts'), '--mcp'],
      cwd: workspace,
      env: { ...process.env, PMX_CANVAS_WORKSPACE_ROOT: workspace, PMX_CANVAS_DISABLE_BROWSER_OPEN: '1' },
      stderr: 'pipe',
    });
    const client = new Client({ name: 'skills-consumer', version: '1' });
    try {
      await client.connect(transport);
      const entrySchema = z.object({
        uri: z.string(),
        frontmatter: z.object({ name: z.string(), description: z.string() }).passthrough(),
        resources: z.array(z.object({ uri: z.string(), digest: z.string(), size: z.number() })),
      });
      const listed = await client.request({ method: 'skills/list' }, z.object({ skills: z.array(entrySchema) }));
      expect(listed.skills.map((skill) => skill.frontmatter.name)).toContain('pmx-canvas');
      expect(listed.skills.map((skill) => skill.frontmatter.name)).toContain('web-artifacts-builder');
      for (const skill of listed.skills) {
        const directory = join(packageRoot, 'skills', skill.frontmatter.name);
        const expectedFiles = readdirSync(directory, { recursive: true, withFileTypes: true }).filter((file) =>
          file.isFile(),
        );
        expect(skill.resources).toHaveLength(expectedFiles.length);
        const fetched = await client.request(
          { method: 'skills/get', params: { uri: skill.uri } },
          z.object({ skill: entrySchema }),
        );
        expect(fetched.skill).toEqual(skill);
        for (const file of skill.resources) {
          const result = await client.readResource({ uri: file.uri });
          const content = result.contents[0]!;
          const bytes = 'text' in content ? Buffer.from(content.text) : Buffer.from(content.blob, 'base64');
          const relative = decodeURIComponent(new URL(file.uri).pathname.slice(1));
          expect(bytes).toEqual(readFileSync(join(directory, relative)));
          expect(bytes.length).toBe(file.size);
          expect(`sha256:${createHash('sha256').update(bytes).digest('hex')}`).toBe(file.digest);
          if (file.uri === skill.uri) {
            expect<unknown>(skill.frontmatter).toEqual(
              Bun.YAML.parse(bytes.toString().match(/^---\r?\n([\s\S]*?)\r?\n---/)![1]!),
            );
          }
        }
      }
      expect((await client.listTools()).tools).toHaveLength(22);
      // Discovery and file reads should not start a daemon or write a consumer board.
      expect(readdirSync(workspace)).toEqual([]);
    } finally {
      await client.close();
      await transport.close();
    }
  }, 30000);
});
