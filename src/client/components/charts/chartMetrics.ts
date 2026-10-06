// Geometry shared by every axis chart (BarChart, LineChart, StackedBarChart), so the three cannot drift apart.
//
// Charts are pure SVG scaled to fit their card (`width="100%"`), so the text size a person sees is
// `AXIS_FONT_SIZE * renderedWidth / CHART_WIDTH`. The viewBox is deliberately about as wide as the narrowest real
// chart card (about 330px on both a 1440px desktop and a 390px phone), so the scale is close to 1 and axis text is
// really ~12px on screen. (A 600-unit viewBox shown ~330px wide rendered the same text at ~6.5px.)

export const CHART_WIDTH = 340;
export const CHART_HEIGHT = 300;
export const AXIS_FONT_SIZE = 12;

/** Smallest card width (px) the charts are designed for; below this the effective text size drops under 11px. */
export const MIN_DESIGN_WIDTH = 320;

/** Rendered px size of axis text when the chart is displayed `renderedWidth` px wide. */
export function effectiveFontSize(renderedWidth: number): number {
  return (AXIS_FONT_SIZE * renderedWidth) / CHART_WIDTH;
}

/** Base plot margins: room for a value axis on the left (grown further to fit the widest tick label). */
export const BASE_MARGIN = { top: 16, right: 20, bottom: 44, left: 52 };
