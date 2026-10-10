// A figure against its target colours only its number: plain on target, amber below it, red below the floor. Utilization turns
// amber from 90% full and red over capacity. A figure with nothing to rate stays plain.
import { describe, expect, it } from 'vitest';
import { onTimeTone, targetFigureTone, utilizationTone, UTILIZATION_WARN_FROM } from '../../../src/client/lib/targets';

describe('onTimeTone with targetFigureTone', () => {
  it('leaves the on-time value plain at exactly 90% and colours it amber at 89.9%', () => {
    expect(targetFigureTone(onTimeTone(0.9))).toBe('neutral');
    expect(targetFigureTone(onTimeTone(0.899))).toBe('warning');
    expect(targetFigureTone(onTimeTone(0.856))).toBe('warning');
  });

  it('turns red below the 80% floor and not at it', () => {
    expect(targetFigureTone(onTimeTone(0.8))).toBe('warning');
    expect(targetFigureTone(onTimeTone(0.799))).toBe('critical');
    expect(targetFigureTone(onTimeTone(0))).toBe('critical');
  });

  it('keeps a rate that cannot be rated plain (shown as a dash, no gauge tone)', () => {
    expect(onTimeTone(null)).toBe('neutral');
    expect(targetFigureTone(onTimeTone(null))).toBe('neutral');
  });

  it('never paints a good rate green: good maps to plain ink', () => {
    expect(onTimeTone(1)).toBe('good');
    expect(targetFigureTone('good')).toBe('neutral');
    expect(targetFigureTone('warning')).toBe('warning');
    expect(targetFigureTone('critical')).toBe('critical');
  });
});

describe('utilizationTone', () => {
  it('colours utilization amber from 90% and leaves 89.9% plain', () => {
    expect(UTILIZATION_WARN_FROM).toBe(0.9);
    expect(utilizationTone(0.9)).toBe('warning');
    expect(utilizationTone(0.924)).toBe('warning');
    expect(utilizationTone(0.899)).toBe('neutral');
    expect(utilizationTone(0)).toBe('neutral');
  });

  it('keeps a full warehouse amber at exactly 100% and turns red only over capacity', () => {
    expect(utilizationTone(1)).toBe('warning');
    expect(utilizationTone(1.0001)).toBe('critical');
    expect(utilizationTone(1.5)).toBe('critical');
  });

  it('leaves an unknown capacity (null) plain', () => {
    expect(utilizationTone(null)).toBe('neutral');
  });
});
