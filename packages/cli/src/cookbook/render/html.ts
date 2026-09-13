/**
 * Escaping, and one way to build markup.
 *
 * The rule this file exists to enforce: **a value is escaped unless it is
 * `Html`**. Every interpolation into an `html` template goes through
 * {@link escapeHtml} — text, attributes, URLs, all of it — so a recipe whose
 * `desc` is `milk & <script>` cannot become markup, and forgetting to escape is
 * not an option that is available.
 *
 * `escapeHtml` escapes the five characters that matter in both text and a
 * quoted attribute, which is why one function is enough:
 *
 * ```
 * &  →  &amp;      "  →  &quot;
 * <  →  &lt;       '  →  &#39;
 * >  →  &gt;
 * ```
 */

export type Renderable =
  | Html
  | string
  | number
  | undefined
  | null
  | readonly Renderable[];

/** Markup that is already safe. Build it with {@link html} or {@link raw}. */
export class Html {
  readonly value: string;

  constructor(value: string) {
    this.value = value;
  }

  toString(): string {
    return this.value;
  }
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (character) => ESCAPES[character] ?? character);
}

/** Markup that did not come from a recipe. `raw("")` of a value you own, never of input. */
export function raw(value: string): Html {
  return new Html(value);
}

function coerce(value: Renderable): Html {
  if (value instanceof Html) return value;
  if (value === undefined || value === null) return new Html("");
  if (Array.isArray(value)) {
    return new Html(value.map((item) => coerce(item as Renderable).value).join(""));
  }
  return new Html(escapeHtml(String(value)));
}

/** Builds markup. Interpolated values are escaped; `Html` values are not. */
export function html(strings: TemplateStringsArray, ...values: Renderable[]): Html {
  let out = strings[0] ?? "";
  for (const [index, value] of values.entries()) {
    out += coerce(value).value;
    out += strings[index + 1] ?? "";
  }
  return new Html(out);
}

/** The finished document, or a fragment of one. */
export function render(node: Html): string {
  return node.value;
}
