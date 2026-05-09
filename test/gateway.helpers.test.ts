import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  cleanupVoiceFiles,
  downloadVoiceFile,
  extractImages,
  extractRecordSegments,
  extractText,
  isAmrFormat,
  isSilkFormat,
  processVoiceSegments,
  resolveInboundCommandAuthorization,
} from '../src/gateway.js';

describe('gateway helpers', () => {
  const oldFetch = globalThis.fetch;
  let sandboxDir: string;

  beforeEach(async () => {
    sandboxDir = await mkdtemp(join(tmpdir(), 'onebot-gateway-test-'));
    globalThis.fetch = vi.fn();
  });

  afterEach(async () => {
    globalThis.fetch = oldFetch;
    vi.restoreAllMocks();
    await rm(sandboxDir, { recursive: true, force: true });
  });

  it('extracts text, images, and record segments from OneBot message arrays', () => {
    const segments = [
      { type: 'text', data: { text: 'hello' } },
      { type: 'image', data: { url: 'https://img.example/x.png' } },
      { type: 'record', data: { file: 'voice.amr' } },
      { type: 'text', data: { text: ' world' } },
      { type: 'image', data: { file: 'fallback.png' } },
    ] as any;

    expect(extractText(segments)).toBe('hello world');
    expect(extractImages(segments)).toEqual([
      'https://img.example/x.png',
      'fallback.png',
    ]);
    expect(extractRecordSegments(segments)).toHaveLength(1);
  });

  it('detects SILK and AMR headers', () => {
    expect(isSilkFormat(Buffer.from('\u0002#!SILK_V3'))).toBe(true);
    expect(isSilkFormat(Buffer.from('plain-audio'))).toBe(false);
    expect(isAmrFormat(Buffer.from('#!AMR\n'))).toBe(true);
    expect(isAmrFormat(Buffer.from('#!SILK_V3'))).toBe(false);
  });

  it('downloads voice files with suffix detection and logs failures', async () => {
    const errors: string[] = [];
    const debugs: string[] = [];
    const log = {
      info: (_msg: string) => {},
      error: (msg: string) => errors.push(msg),
      debug: (msg: string) => debugs.push(msg),
    };

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: false,
      status: 502,
    });
    await expect(downloadVoiceFile('https://example.com/bad', log)).resolves.toBeNull();
    expect(errors.some((msg) => msg.includes('502'))).toBe(true);

    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => new Uint8Array().buffer,
    });
    await expect(downloadVoiceFile('https://example.com/empty', log)).resolves.toBeNull();
    expect(errors.some((msg) => msg.includes('empty file'))).toBe(true);

    (globalThis.fetch as any).mockRejectedValueOnce(new Error('network down'));
    await expect(downloadVoiceFile('https://example.com/error', log)).resolves.toBeNull();
    expect(errors.some((msg) => msg.includes('network down'))).toBe(true);

    const silkBytes = Buffer.from('\u0002#!SILK_V3 payload');
    (globalThis.fetch as any).mockResolvedValueOnce({
      ok: true,
      arrayBuffer: async () => silkBytes.buffer.slice(
        silkBytes.byteOffset,
        silkBytes.byteOffset + silkBytes.byteLength,
      ),
    });

    const downloaded = await downloadVoiceFile('https://example.com/silk', log);
    expect(downloaded).toMatch(/\.silk$/);
    expect(debugs.some((msg) => msg.includes('Downloaded voice'))).toBe(true);

    if (downloaded) {
      await unlink(downloaded);
    }
  });

  it('processes downloaded and local voice files without conversion when already supported', async () => {
    const mp3Path = join(sandboxDir, 'sample.mp3');
    const wavPath = join(sandboxDir, 'sample.wav');
    await writeFile(mp3Path, Buffer.from('not-real-mp3'));
    await writeFile(wavPath, Buffer.from('not-real-wav'));

    const oggBytes = Buffer.from('OggS-mock-audio');
    (globalThis.fetch as any).mockResolvedValue({
      ok: true,
      arrayBuffer: async () => oggBytes.buffer.slice(
        oggBytes.byteOffset,
        oggBytes.byteOffset + oggBytes.byteLength,
      ),
    });

    const results = await processVoiceSegments([
      { type: 'record', data: { file: `file://${mp3Path}` } },
      { type: 'record', data: { file: `file://${wavPath}` } },
      { type: 'record', data: { url: 'https://example.com/voice.ogg' } },
      { type: 'record', data: {} },
    ] as any, {
      info: () => {},
      error: () => {},
      debug: () => {},
    });

    expect(results).toEqual(
      expect.arrayContaining([
        { path: mp3Path, contentType: 'audio/mpeg' },
        { path: wavPath, contentType: 'audio/wav' },
      ]),
    );
    expect(results.some((entry) => entry.path.endsWith('.ogg'))).toBe(true);

    cleanupVoiceFiles(results.map((entry) => entry.path).filter((entry) => entry.includes('openclaw-onebot-voice')));
  });

  it('handles unreadable local voice files and cleanup tolerates missing files', async () => {
    const unreadableDir = join(sandboxDir, 'voice-dir');
    await mkdir(unreadableDir);
    const errors: string[] = [];

    const results = await processVoiceSegments([
      { type: 'record', data: { file: `file://${unreadableDir}` } },
    ] as any, {
      info: () => {},
      error: (msg: string) => errors.push(msg),
      debug: () => {},
    });

    expect(results).toEqual([]);
    expect(errors.some((msg) => msg.includes('Voice processing error'))).toBe(true);

    cleanupVoiceFiles([join(sandboxDir, 'missing.mp3')]);
  });

  it('resolves inbound command authorization with and without runtime helpers', () => {
    const runtimeWithHelper = {
      channel: {
        commands: {
          resolveCommandAuthorizedFromAuthorizers: vi.fn(({ authorizers }) =>
            authorizers.some((entry: any) => entry.allowed),
          ),
        },
      },
    } as any;

    expect(resolveInboundCommandAuthorization({
      pluginRuntime: runtimeWithHelper,
      cfg: { commands: { useAccessGroups: true } },
      allowFrom: ['private:42'],
      peerId: 'private:42',
    })).toBe(true);

    expect(resolveInboundCommandAuthorization({
      pluginRuntime: runtimeWithHelper,
      cfg: { commands: { useAccessGroups: true } },
      allowFrom: ['private:42'],
      peerId: 'private:99',
    })).toBe(false);

    expect(resolveInboundCommandAuthorization({
      pluginRuntime: runtimeWithHelper,
      cfg: { commands: { useAccessGroups: true } },
      allowFrom: undefined,
      peerId: 'private:42',
    })).toBe(false);

    const legacyRuntime = { channel: {} } as any;
    expect(resolveInboundCommandAuthorization({
      pluginRuntime: legacyRuntime,
      cfg: {},
      allowFrom: undefined,
      peerId: 'private:100',
    })).toBe(false);
  });
});
