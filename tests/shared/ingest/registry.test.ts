import { describe, expect, it } from 'vitest';
import { AdapterRegistry, RegistryError, createRegistry, registerAdapter, validateDescriptor } from '../../../src/shared/ingest/registry';
import { createDefaultRegistry, builtinAdapters } from '../../../src/shared/ingest/adapters';
import { toyAdapter, TOY_MAGIC } from '../../ingest-kit/fakeAdapters';
import { asciiBytes } from '../../../src/shared/ingest/detect/bytes';
import type { AdapterDescriptor, FormatAdapter } from '../../../src/shared/ingest/types';

function withDescriptor(over: Partial<AdapterDescriptor>): FormatAdapter {
  return { ...toyAdapter, descriptor: { ...toyAdapter.descriptor, ...over } };
}

describe('registry', () => {
  it('registers adapters in order and lists supported and refusal families separately', () => {
    const reg = createDefaultRegistry();
    const ids = reg.list().map((a) => a.descriptor.id);
    expect(ids.slice(0, 2)).toEqual(['delimited-text', 'gzip']);
    expect(reg.supportedFamilies().map((d) => d.id)).toEqual(['delimited-text', 'gzip']);
    expect(reg.refusalFamilies().length).toBe(builtinAdapters.length - 2);
    expect(reg.refusalFamilies().every((d) => d.status === 'refusal')).toBe(true);
  });

  it('rejects duplicate ids', () => {
    const reg = createRegistry();
    reg.register(toyAdapter);
    expect(() => reg.register(toyAdapter)).toThrow(RegistryError);
  });

  it('returns an unregister function and get/unregister work', () => {
    const reg = createRegistry();
    const off = registerAdapter(reg, toyAdapter);
    expect(reg.get('toy-kv')).toBe(toyAdapter);
    off();
    expect(reg.get('toy-kv')).toBeUndefined();
  });

  it('validates descriptors at start-up', () => {
    const cases: Array<[Partial<AdapterDescriptor>, RegExp]> = [
      [{ id: 'Bad Id' }, /id must match/],
      [{ version: '1' }, /version/],
      [{ family: ' ' }, /family/],
      [{ yields: [] }, /yields/],
      [{ signatures: [], contentSniff: false }, /signatures or contentSniff/],
      [{ signatures: [{ offset: -1, bytes: [1] }] }, /offset/],
      [{ signatures: [{ offset: 0, bytes: [] }] }, /1\.\.32 bytes/],
      [{ signatures: [{ offset: 0, bytes: [1, 2], mask: [255] }] }, /mask/],
      [{ signatures: [{ offset: 0, bytes: [300] }] }, /0\.\.255/],
      [{ hints: { extensions: ['csv'], mimeTypes: [] } }, /extension hint/],
      [{ hints: { extensions: [], mimeTypes: ['nonsense'] } }, /MIME/],
      [{ sourceRefKind: [] }, /sourceRefKind/],
      [{ resourceHints: { needsWorker: false, sourceBytes: 10 ** 12 } }, /sourceBytes/],
      [{ resourceHints: { needsWorker: false, ratio: 10_000 } }, /ratio/]
    ];
    for (const [over, pattern] of cases) {
      const problems = validateDescriptor(withDescriptor(over).descriptor);
      expect(problems.join(';'), JSON.stringify(over)).toMatch(pattern);
      expect(() => createRegistry().register(withDescriptor(over))).toThrow(RegistryError);
    }
    expect(validateDescriptor(toyAdapter.descriptor)).toEqual([]);
  });

  it('returns adapters whose signature matches plus every content sniffer', () => {
    const reg = createDefaultRegistry();
    reg.register(toyAdapter);
    const toy = reg.adaptersForSignature(Uint8Array.from(asciiBytes(TOY_MAGIC))).map((a) => a.descriptor.id);
    expect(toy).toContain('toy-kv');
    expect(toy).toContain('delimited-text'); // sniffs every file
    expect(toy).not.toContain('gzip');
    const gz = reg.adaptersForSignature(Uint8Array.of(0x1f, 0x8b, 0x08, 0)).map((a) => a.descriptor.id);
    expect(gz).toContain('gzip');
  });

  it('tracks disabled adapters', () => {
    const reg = new AdapterRegistry();
    reg.register(toyAdapter);
    reg.setDisabled(['toy-kv']);
    expect(reg.isDisabled('toy-kv')).toBe(true);
    expect(reg.isDisabled('other')).toBe(false);
  });

  it('keeps registries independent (no global list)', () => {
    const a = createDefaultRegistry();
    const b = createDefaultRegistry();
    a.register(toyAdapter);
    expect(b.get('toy-kv')).toBeUndefined();
  });
});
