import { describe, it, expect } from 'vitest';
import { buildHash, parseHash } from '../../src/client/router';

describe('parseHash', () => {
  it('treats empty string, "#" and "#/" as the dashboard route', () => {
    expect(parseHash('').id).toBe('dashboard');
    expect(parseHash('#').id).toBe('dashboard');
    expect(parseHash('#/').id).toBe('dashboard');
  });

  it('parses each known route', () => {
    expect(parseHash('#/inventory').id).toBe('inventory');
    expect(parseHash('#/shipments').id).toBe('shipments');
    expect(parseHash('#/routes').id).toBe('routes');
    expect(parseHash('#/analytics').id).toBe('analytics');
    expect(parseHash('#/alerts').id).toBe('alerts');
    expect(parseHash('#/import').id).toBe('import');
  });

  it('tolerates a trailing slash', () => {
    expect(parseHash('#/inventory/').id).toBe('inventory');
  });

  it('returns not_found for an unknown path', () => {
    expect(parseHash('#/nope').id).toBe('not_found');
  });

  it('parses query params after "?"', () => {
    const route = parseHash('#/inventory?stock=low_or_out&q=widget');
    expect(route.id).toBe('inventory');
    expect(route.params.get('stock')).toBe('low_or_out');
    expect(route.params.get('q')).toBe('widget');
  });

  it('returns empty params when there is no query string', () => {
    expect(Array.from(parseHash('#/inventory').params.keys())).toEqual([]);
  });
});

describe('buildHash', () => {
  it('builds a bare hash with no params', () => {
    expect(buildHash('dashboard')).toBe('#/');
    expect(buildHash('shipments')).toBe('#/shipments');
  });

  it('builds a hash with a query string', () => {
    expect(buildHash('shipments', { status: 'delivered' })).toBe('#/shipments?status=delivered');
  });

  it('encodes special characters in param values', () => {
    const hash = buildHash('inventory', { q: 'a b&c' });
    expect(hash).toBe('#/inventory?q=a+b%26c');
  });

  it('round-trips through parseHash', () => {
    const hash = buildHash('alerts', { severity: 'critical' });
    const parsed = parseHash(hash);
    expect(parsed.id).toBe('alerts');
    expect(parsed.params.get('severity')).toBe('critical');
  });
});
