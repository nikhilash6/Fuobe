/**
 * The class names of Home's first screen (home-bento.css), each with its hb- prefix. The sheet is global, as every
 * stylesheet in this app is (next.config.ts runs each .css file through Tailwind as plain CSS), so the prefix keeps its
 * names to itself.
 */
const NAMES = ["accent","aside","audio","badge","before","bento","big","board","box","canvas","caret","clip","copy","corner","cta","edges","figures","fill","filmMark","foot","frame","grid","h1","head","image","kenburns","l2b","left","line1","line2","live","meta","node","nodeLabel","numbers","numbersFoot","numbersLine","out","pic","pill","playGlyph","playhead","progress","restore","right","shade","side","split","step","three","tile","title","tsx","typed","video","wave"] as const;

export const s = Object.fromEntries(NAMES.map((n) => [n, `hb-${n.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`])) as Record<(typeof NAMES)[number], string>;
