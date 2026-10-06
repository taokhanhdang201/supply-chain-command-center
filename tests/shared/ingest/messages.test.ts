import { describe, expect, it } from 'vitest';
import {
  MESSAGE_CATALOGUE,
  acceptAttribute,
  clip,
  extensionMismatchNotice,
  ingestError,
  messageText,
  supportedFamiliesList,
  supportedFormatsText,
  unsupportedTypeMessage
} from '../../../src/shared/ingest/messages';
import { createDefaultRegistry } from '../../../src/shared/ingest/adapters';
import { createRegistry } from '../../../src/shared/ingest/registry';
import { toyAdapter } from '../../ingest-kit/fakeAdapters';

describe('messages generated from the registry (SA-1)', () => {
  it('lists supported families from descriptors only', () => {
    const reg = createDefaultRegistry();
    expect(supportedFamiliesList(reg)).toBe('Delimited text (.csv, .tsv, .txt), Gzip-compressed file (.gz)');
    expect(supportedFormatsText(reg)).toBe('You can import Delimited text (.csv, .tsv, .txt), Gzip-compressed file (.gz).');
  });

  it('registering a new adapter changes the generated texts without editing any message', () => {
    const reg = createDefaultRegistry();
    const before = { supported: supportedFormatsText(reg), unknown: unsupportedTypeMessage(reg, null), accept: acceptAttribute(reg) };
    reg.register(toyAdapter);
    expect(supportedFormatsText(reg)).not.toBe(before.supported);
    expect(supportedFormatsText(reg)).toContain('Toy key-value text (.toy)');
    expect(unsupportedTypeMessage(reg, null)).toContain('Toy key-value text (.toy)');
    expect(acceptAttribute(reg)).not.toBe(before.accept);
    expect(acceptAttribute(reg)).toContain('.toy');
    expect(acceptAttribute(reg)).toContain('text/x-toy');
  });

  it('builds the unsupported-type text from the matching refusal adapter and the supported list', () => {
    const reg = createDefaultRegistry();
    const pdf = reg.get('refuse-pdf')?.descriptor ?? null;
    const text = unsupportedTypeMessage(reg, pdf);
    expect(text).toMatch(/^This looks like a PDF document\. SCC cannot import that type\./);
    expect(text).toContain('You can import: Delimited text (.csv, .tsv, .txt), Gzip-compressed file (.gz).');
    expect(unsupportedTypeMessage(reg, reg.get('refuse-xml')?.descriptor ?? null)).toContain('an XML file');
    expect(unsupportedTypeMessage(reg, reg.get('refuse-html')?.descriptor ?? null)).toContain('an HTML page');
    expect(unsupportedTypeMessage(reg, reg.get('refuse-utf32')?.descriptor ?? null)).toContain('a UTF-32 text file');
    expect(unsupportedTypeMessage(reg, null)).toContain('a file of an unknown type');
  });

  it('an empty registry has no hard-coded format names', () => {
    const empty = createRegistry();
    expect(supportedFormatsText(empty)).toBe('No file types are available for import.');
    expect(unsupportedTypeMessage(empty, null)).toBe('This looks like a file of an unknown type. SCC cannot import that type.');
    expect(acceptAttribute(empty)).toBe('');
  });

  it('the picker accept list is built from extensions then MIME types of readable adapters only', () => {
    expect(acceptAttribute(createDefaultRegistry())).toBe('.csv,.tsv,.txt,.gz,text/csv,text/tab-separated-values,text/plain,application/csv,application/gzip,application/x-gzip');
  });
});

describe('message catalogue', () => {
  it('keeps the legacy wordings verbatim as prefixes', () => {
    expect(messageText('EMPTY_FILE')).toBe('The file is empty.');
    expect(messageText('NO_DATA_ROWS')).toBe('The file has a header but no data rows.');
    expect(messageText('LIMIT_SOURCE_BYTES', { size: 3 * 1024 * 1024, limit: 2 * 1024 * 1024 })).toMatch(/^File is 3\.0 MB; the limit is 2\.0 MB\./);
    expect(messageText('LIMIT_ROWS', { limit: 20000 })).toMatch(/^The file has more than 20000 data rows\./);
    expect(messageText('LIMIT_COLUMNS', { line: 4, limit: 50 })).toMatch(/^Line 4 has more than 50 columns\./);
  });

  it('every entry renders a non-empty single-line string', () => {
    for (const code of Object.keys(MESSAGE_CATALOGUE) as Array<keyof typeof MESSAGE_CATALOGUE>) {
      const text = messageText(code, { size: 1, limit: 1, line: 1, family: 'Thing', label: 'Thing', detail: 'x' });
      expect(text.length, code).toBeGreaterThan(5);
      expect(text, code).not.toContain('\n');
      expect(text, code).not.toContain('undefined');
    }
  });

  it('ingestError carries code, stage, optional limit and source', () => {
    const e = ingestError('LIMIT_COLUMNS', 'limits', { line: 3, limit: 50 }, { limit: 'columns', source: { kind: 'line', line: 3 } });
    expect(e).toEqual({ code: 'LIMIT_COLUMNS', stage: 'limits', message: 'Line 3 has more than 50 columns. Remove columns you do not need and try again.', limit: 'columns', source: { kind: 'line', line: 3 } });
  });

  it('file-derived text is truncated and control characters are flattened', () => {
    expect(clip('a'.repeat(200), 10)).toHaveLength(10);
    expect(clip('a\u0000b\nc')).toBe('a b c');
    expect(extensionMismatchNotice('.verylongextensionname', 'Delimited text')).toContain('Delimited text');
  });
});
