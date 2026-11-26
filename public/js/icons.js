// Outline icons for the tool buttons, drawn on a 24x24 grid with round strokes.
const ICONS = {
  // pencil at 45°, with a sharpened tip
  pencil: `<path d="M16.5 3.5l4 4L8 20H4v-4z"/><path d="M14 6l4 4"/>`,
  // block eraser, tilted, sitting on a baseline
  eraser: `<path d="M7.5 20l-4-4a1.5 1.5 0 0 1 0-2.1L13.4 4a1.5 1.5 0 0 1 2.1 0l4.6 4.6a1.5 1.5 0 0 1 0 2.1L11 20z"/><path d="M8.5 9.5l6 6"/><path d="M11 20h9"/>`,
  // tipped paint bucket with a drip
  fill: `<path d="M10 3l8.5 8.5-6.5 6.5a2 2 0 0 1-2.8 0L3.5 12.3a2 2 0 0 1 0-2.8z"/><path d="M3.8 11h13.7"/><path d="M20.5 15.5s-1.8 2.2-1.8 3.4a1.8 1.8 0 0 0 3.6 0c0-1.2-1.8-3.4-1.8-3.4z"/>`,
  line: `<path d="M5 19L19 5"/><circle cx="5" cy="19" r="1.4" fill="currentColor"/><circle cx="19" cy="5" r="1.4" fill="currentColor"/>`,
  rect: `<rect x="4" y="5" width="16" height="14" rx="1"/>`,
  ellipse: `<ellipse cx="12" cy="12" rx="8.5" ry="7"/>`,
  // eyedropper
  picker: `<path d="M11 8l5 5"/><path d="M13.8 7.2l2.7-2.7a2.1 2.1 0 0 1 3 3l-2.7 2.7"/><path d="M12.5 9.5L6 16l-1 3 3-1 6.5-6.5"/>`,
  // four-way arrows
  move: `<path d="M12 3v18M3 12h18"/><path d="M9 6l3-3 3 3M9 18l3 3 3-3M6 9l-3 3 3 3M18 9l3 3-3 3"/>`,
  // dashed marquee
  select: `<rect x="4" y="4" width="16" height="16" rx="1" stroke-dasharray="3 2.6"/>`,
  // freehand lasso loop with a tail
  lasso: `<path d="M7.5 15.5C4.5 14 3 12 3 10c0-3.9 4-7 9-7s9 3.1 9 7-4 7-9 7c-1.3 0-2.6-.2-3.7-.6"/><circle cx="7" cy="17" r="2"/><path d="M7 19c0 1.5-.8 2.3-2 2.5"/>`,
  // magic wand with sparkles
  wand: `<path d="M4 20L15 9"/><path d="M13.5 7.5l3 3"/><path d="M18 2.5v3M16.5 4h3M20.5 9.5v2M19.5 10.5h2M10 3.5v2M9 4.5h2"/>`,
  // spray can with dots
  spray: `<rect x="4" y="10" width="8" height="11" rx="1.5"/><path d="M6 10V7.5h4V10"/><path d="M7 7.5V5h2"/><circle cx="15.5" cy="6" r=".9" fill="currentColor"/><circle cx="18.5" cy="4" r=".9" fill="currentColor"/><circle cx="18.5" cy="8.5" r=".9" fill="currentColor"/><circle cx="21" cy="6.2" r=".9" fill="currentColor"/>`,
  // gradient: box shading from solid to empty
  gradient: `<rect x="3.5" y="4" width="17" height="16" rx="1"/><path d="M3.5 4h5.5v16H3.5z" fill="currentColor"/><path d="M11 6v2M11 10v2M11 14v2M11 18v1M14 7v1M14 11v1M14 15v1M17 9v.5M17 14v.5"/>`,
  // contour: freehand closed blob
  contour: `<path d="M6 5c3-2 8-1.5 11 0s4.5 5 2.5 8-1.5 5.5-4.5 6.5-8 .5-10-2.5S3 7 6 5z" fill="currentColor" fill-opacity=".25"/>`,
  // slice: frame corners with a centre box
  slice: `<path d="M4 8V4h4M16 4h4v4M20 16v4h-4M8 20H4v-4"/><rect x="8.5" y="8.5" width="7" height="7" stroke-dasharray="2 2"/>`,
  // lighten / darken: half-filled circle
  shade: `<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>`,
};

export function iconSVG(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ""}</svg>`;
}
