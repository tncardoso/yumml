/**
 * The palette the flow is drawn in, and the rule that says which node wears what.
 *
 * This module is pure data and arithmetic: no DOM, no `document`, nothing from Node.
 * That is deliberate, because both halves of a drawing need the same answer — core
 * paints the bands and the ingredient rows, the cookbook paints the chips in the
 * current-step strip, and a chip that names an ingredient has to wear that row's
 * colour or the strip and the flow stop looking like one picture.
 *
 * A hue is a **triplet**, not a colour, because the fills are pastels and nothing on a
 * pastel is white:
 *
 * | role | who wears it | what it has to be readable against |
 * |------|--------------|------------------------------------|
 * | `fill` | a stage band, its chevron | the paper |
 * | `ink` | the band's label, its time, its number | the fill |
 * | `tint` | an ingredient row, the chip that names it | the paper |
 *
 * In the stylesheet the same three roles are `--yv-fill`, `--yv-on-fill` and
 * `--yv-row-tint`. The CSS name is `on-fill` rather than `ink` because the drawing
 * already has an ink (`--yv-ink`, the near-black every other word is written in).
 *
 * Ten hues, ordered so that neighbouring columns are far apart in hue. The order is
 * the point: a reader compares column 3 with column 4, not column 3 with column 7, so
 * the palette steps 3 through a hue-sorted list until every neighbour is at least 94°
 * away — which is why the pinks (rose 8°, coral 32°) are six positions apart.
 *
 * Lightness is constant across the set (0.86 for a fill, 0.42 for its ink, 0.955 for a
 * tint) so that ten bands read as one family, and only the hue changes. Chroma is the
 * free variable: 0.08, with the yellows pushed to 0.095 so they do not come out grey.
 */

import type { Recipe, StepNode } from "../model/recipe.ts";

export type RecipeColor = {
  /** The band and its chevron: what covers an area. */
  readonly fill: string;
  /** Words on a fill: the band's label, its time, the number in its badge. */
  readonly ink: string;
  /** An ingredient row, and the chip that names the same ingredient in the strip. */
  readonly tint: string;
};

type Hue = {
  readonly name: string;
  /** OKLCH hue angle, in degrees. Only the order in this list is meaningful. */
  readonly hue: number;
  /** OKLCH chroma at the fill's lightness, before the sRGB fit below. */
  readonly chroma: number;
};

const HUES = [
  { name: "teal", hue: 190, chroma: 0.085 },
  { name: "violet", hue: 298, chroma: 0.085 },
  { name: "coral", hue: 32, chroma: 0.085 },
  { name: "jade", hue: 162, chroma: 0.075 },
  { name: "magenta", hue: 328, chroma: 0.08 },
  { name: "amber", hue: 68, chroma: 0.095 },
  { name: "indigo", hue: 266, chroma: 0.085 },
  { name: "moss", hue: 128, chroma: 0.08 },
  { name: "rose", hue: 8, chroma: 0.075 },
  { name: "sky", hue: 232, chroma: 0.08 },
] as const;

const FILL_LIGHTNESS = 0.86;
const INK_LIGHTNESS = 0.42;
const TINT_LIGHTNESS = 0.955;
/** A tint is the fill's chroma at a fraction of it: a row is a whisper, not a band. */
const TINT_CHROMA = 0.33;

/**
 * What a lap does to a hue. Ten colours do not bound a recipe — galinhada already has
 * nine columns — so column 11 is column 1's hue one step darker rather than a repeat
 * nobody can tell from a mistake.
 */
const LAP_FILL = 0.07;
const LAP_INK = 0.05;
/** Where the laps stop. A 31-column recipe is not a thing, and the ink cannot chase the fill forever. */
const MAX_LAP = 3;

/**
 * OKLab → linear sRGB. The three rows are the inverse of the LMS matrix: what is left
 * after the cube is the light itself, before the transfer function puts it back.
 */
function linearChannels(
  lightness: number,
  chroma: number,
  hue: number,
): readonly [number, number, number] {
  const radians = (hue * Math.PI) / 180;
  const a = chroma * Math.cos(radians);
  const b = chroma * Math.sin(radians);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function encode(channel: number): number {
  return Math.round(Math.min(1, Math.max(0, encodeLinear(channel))) * 255);
}

function encodeLinear(channel: number): number {
  return channel <= 0.0031308
    ? 12.92 * channel
    : 1.055 * Math.max(0, channel) ** (1 / 2.4) - 0.055;
}

/**
 * Walks the chroma down until the colour is inside sRGB.
 *
 * A uniform chroma at lightness 0.86 falls outside sRGB for most of these hues, and a
 * clamped colour is a lie: it renders as something other than what its contrast was
 * measured on. Fitting keeps the lightness, which is the part the palette is built
 * around, and gives up the saturation — the ten hues come out with ten different
 * chromas, which is why the set is a table and not a formula.
 *
 * The walk is in thousandths so that it lands on one value and not on a float that
 * renders a digit away from the hex its contrast was measured on.
 */
function fit(lightness: number, chroma: number, hue: number): number {
  let fitted = chroma;
  while (fitted > 0 && !inGamut(lightness, fitted, hue)) {
    fitted = Math.round((fitted - 0.001) * 1000) / 1000;
  }
  return Math.max(0, Math.round(fitted * 1000) / 1000);
}

/** Whether the colour needs no clamping: the test is on the encoded channels, since that is where a clamp would bite. */
function inGamut(lightness: number, chroma: number, hue: number): boolean {
  return linearChannels(lightness, chroma, hue).every((channel) => {
    const encoded = encodeLinear(channel);
    return encoded >= -1e-6 && encoded <= 1 + 1e-6;
  });
}

function toHex(lightness: number, chroma: number, hue: number): string {
  const digits = linearChannels(lightness, chroma, hue).map((channel) =>
    encode(channel).toString(16).padStart(2, "0"),
  );
  return `#${digits.join("")}`;
}

function colorOf(hue: Hue, lap: number): RecipeColor {
  const fill = fit(FILL_LIGHTNESS, hue.chroma, hue.hue);
  const ink = fit(INK_LIGHTNESS, Math.max(0.06, fill * 1.1), hue.hue);
  const tint = fit(TINT_LIGHTNESS, fill * TINT_CHROMA, hue.hue);
  return {
    fill: toHex(FILL_LIGHTNESS - LAP_FILL * lap, fill, hue.hue),
    ink: toHex(INK_LIGHTNESS - LAP_INK * lap, ink, hue.hue),
    // A tint does not lap: a row that got darker with every round would stop being a
    // row and start being a second band.
    tint: toHex(TINT_LIGHTNESS, tint, hue.hue),
  };
}

/** The ten hues at their first lap, in the order the columns take them. */
export const RECIPE_COLORS: readonly RecipeColor[] = HUES.map((hue) => colorOf(hue, 0));

const LAPS = new Map<string, RecipeColor>();

/**
 * The colour of a cooking column, laps included. Column 0 and column 10 are the same
 * hue at different lightnesses; column 40 is column 30.
 */
export function columnColor(column: number): RecipeColor {
  const index = column % RECIPE_COLORS.length;
  const hue: Hue = HUES[index] ?? HUES[0];
  const lap = Math.min(Math.floor(column / RECIPE_COLORS.length), MAX_LAP);
  const key = `${hue.name}:${lap}`;
  const cached = LAPS.get(key);
  if (cached !== undefined) return cached;
  const color = colorOf(hue, lap);
  LAPS.set(key, color);
  return color;
}

/** The steps of one cooking column, left to right. */
export type StageColumns = readonly (readonly StepNode[])[];

/**
 * Groups non-preparation steps into their earliest topological columns.
 *
 * A column is the unit the drawing is about: one cooking round, one band, one hue.
 * Steps that can happen together share a column, which is why `melt` and `brush` land
 * beside each other and not one after the other.
 */
export function stageColumns(orderedSteps: readonly StepNode[]): StageColumns {
  const depths = new Map<string, number>();
  const columns: StepNode[][] = [];
  for (const step of orderedSteps) {
    if (step.uses.length === 0) continue;
    const depth = step.uses.reduce(
      (latest, draw) => Math.max(latest, (depths.get(draw.id) ?? -1) + 1),
      0,
    );
    depths.set(step.id, depth);
    const column = columns[depth];
    if (column === undefined) columns[depth] = [step];
    else column.push(step);
  }
  return columns;
}

export type RecipeColors = {
  /**
   * The colour of every step that is drawn as a band. A preparation step has no
   * column, so it has no entry: it is a card above the flow, not a band in it.
   */
  readonly steps: ReadonlyMap<string, RecipeColor>;
  /** The colour of every ingredient, keyed by id. Total, for any recipe that parsed. */
  readonly ingredients: ReadonlyMap<string, RecipeColor>;
};

/**
 * The colour of every node in one recipe.
 *
 * A step takes its column's hue. An ingredient takes the hue of the **earliest** column
 * that draws it — the band it sits under, which is what a reader compares the row to —
 * and not the first consumer in the recipe's declaration order, which is a step that
 * may sit three columns to the right.
 */
export function recipeColors(recipe: Recipe): RecipeColors {
  const byId = new Map(recipe.steps.map((step) => [step.id, step]));
  const ordered = recipe.order
    .map((id) => byId.get(id))
    .filter((step): step is StepNode => step !== undefined);

  const steps = new Map<string, RecipeColor>();
  const columnOf = new Map<string, number>();
  stageColumns(ordered).forEach((column, index) => {
    const color = columnColor(index);
    for (const step of column) {
      columnOf.set(step.id, index);
      steps.set(step.id, color);
    }
  });

  const ingredients = new Map<string, RecipeColor>();
  for (const ingredient of recipe.ingredients) {
    const drawn = (recipe.consumers[ingredient.id] ?? [])
      .map((id) => columnOf.get(id))
      .filter((index): index is number => index !== undefined);
    // An ingredient nobody draws is a `node/unused` diagnostic, so an empty `drawn` is
    // only reachable from a model that did not come from the parser. The first column
    // is the colour that keeps such a model renderable instead of crashing.
    ingredients.set(
      ingredient.id,
      columnColor(drawn.length === 0 ? 0 : Math.min(...drawn)),
    );
  }

  return { steps, ingredients };
}
