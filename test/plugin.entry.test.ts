import { readFileSync } from 'node:fs';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

import plugin from '../index.js';
import setupEntry from '../setup-entry.js';
import { onebotPlugin } from '../src/channel.js';
import { clearOneBotRuntime, getOneBotRuntime } from '../src/runtime.js';

describe('plugin entry compatibility', () => {
  beforeEach(() => {
    clearOneBotRuntime();
  });

  afterEach(() => {
    clearOneBotRuntime();
    vi.restoreAllMocks();
  });

  it('default export is a channel entry bound to the onebot plugin', () => {
    expect(plugin.id).toBe('openclaw-onebot');
    expect((plugin as any).channelPlugin).toBe(onebotPlugin);
    expect(typeof plugin.register).toBe('function');
  });

  it('register wires runtime storage and channel registration', () => {
    const runtime = { channel: { activity: { record: () => {} }, routing: {}, reply: {} } } as any;
    const registerChannel = vi.fn();

    plugin.register({
      runtime,
      registerChannel,
      registrationMode: 'full',
    } as any);

    expect(registerChannel).toHaveBeenCalledWith({ plugin: onebotPlugin });
    expect(getOneBotRuntime()).toBe(runtime);
  });

  it('setup entry keeps the plugin id stable while registering the onebot channel', () => {
    const registerChannel = vi.fn();

    expect((setupEntry as any).id).toBe('openclaw-onebot');

    (setupEntry as any).register({
      registerChannel,
      registrationMode: 'setup-only',
    });

    expect(registerChannel).toHaveBeenCalledWith({ plugin: onebotPlugin });
  });
});

describe('package compatibility metadata', () => {
  const packageJson = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  const manifest = JSON.parse(readFileSync(new URL('../openclaw.plugin.json', import.meta.url), 'utf8'));

  it('keeps the existing npm package identity and runtime id stable for installed users', () => {
    expect(packageJson.name).toBe('openclaw-onebot');
    expect(manifest.id).toBe('openclaw-onebot');
    expect(manifest.version).toBe(packageJson.version);
  });

  it('advertises the tested openclaw build and plugin sdk versions', () => {
    expect(packageJson.openclaw.build).toEqual({
      openclawVersion: '2026.4.26',
      pluginSdkVersion: '2026.4.26',
    });
  });

  it('declares the minimum gateway/plugin api version required by the modern sdk entrypoints', () => {
    expect(packageJson.openclaw.compat).toEqual({
      pluginApi: '>=2026.3.23-1',
      minGatewayVersion: '2026.3.23-1',
    });
    expect(packageJson.peerDependencies.openclaw).toBe('>=2026.3.23-1 <2027');
    expect(packageJson.openclaw.setupEntry).toBe('./dist/setup-entry.js');
  });

  it('declares channel config metadata for every manifest channel', () => {
    expect(manifest.configSchema).toEqual({
      type: 'object',
      properties: {},
      additionalProperties: false,
    });
    expect(manifest.channels).toContain('onebot');
    expect(manifest.channelConfigs?.onebot?.schema).toMatchObject({
      type: 'object',
      additionalProperties: false,
      properties: {
        wsUrl: { type: 'string' },
        httpUrl: { type: 'string' },
        groupAllowFrom: { type: 'array', deprecated: true },
        accounts: { type: 'object' },
        streaming: { $ref: '#/$defs/streaming' },
      },
    });
    expect(manifest.channelConfigs.onebot.schema.$defs.account.properties.groupAllowFrom).toMatchObject({
      type: 'array',
      deprecated: true,
    });
    expect(manifest.channelEnvVars.onebot).toContain('ONEBOT_WS_URL');
  });

  it('keeps network runtime files free of direct env reads for install scanning', () => {
    for (const sourcePath of ['../src/gateway.ts', '../src/outbound.ts', '../src/channel.ts']) {
      const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
      expect(source, sourcePath).not.toContain('process.env');
    }
  });

  it('keeps voice file reads isolated from outbound network delivery code', () => {
    const inspectedSources = [
      '../src/gateway.ts',
      '../src/voice.ts',
      '../src/voice-download.ts',
      '../src/voice-inspect.ts',
      '../src/voice-convert.ts',
      '../src/outbound.ts',
    ];
    const fileReadPatterns = ['readFile', 'createReadStream'];
    const outboundPatterns = ['sendOutboundText', 'sendImage', 'sendRecord', 'fetch('];

    for (const sourcePath of inspectedSources) {
      const source = readFileSync(new URL(sourcePath, import.meta.url), 'utf8');
      const hasFileRead = fileReadPatterns.some((pattern) => source.includes(pattern));
      const hasOutboundNetwork = outboundPatterns.some((pattern) => source.includes(pattern));
      expect(hasFileRead && hasOutboundNetwork, sourcePath).toBe(false);
    }

    const gatewaySource = readFileSync(new URL('../src/gateway.ts', import.meta.url), 'utf8');
    expect(gatewaySource).not.toContain('node:fs/promises');
    expect(gatewaySource).not.toContain('node:child_process');
    expect(gatewaySource).not.toContain('readFile');
  });
});
