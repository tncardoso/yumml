import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { parseRecipe } from "../index.ts";
import { renderRecipe } from "../render.ts";

class FakeStyle {
  readonly values = new Map<string, string>();

  setProperty(name: string, value: string): void {
    this.values.set(name, value);
  }
}

class FakeElement {
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  readonly dataset: Record<string, string> = {};
  readonly ownerDocument: Document;
  readonly style = new FakeStyle();
  readonly tagName: string;
  className = "";
  tabIndex = -1;
  textContent = "";

  constructor(tagName: string, document: FakeDocument) {
    this.tagName = tagName;
    this.ownerDocument = document as unknown as Document;
  }

  append(...nodes: FakeElement[]): void {
    this.children.push(...nodes);
  }

  replaceChildren(...nodes: FakeElement[]): void {
    this.children.splice(0, this.children.length, ...nodes);
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }
}

class FakeDocument {
  createElement(tagName: string): FakeElement {
    return new FakeElement(tagName, this);
  }
}

function descendants(node: FakeElement): FakeElement[] {
  return [node, ...node.children.flatMap(descendants)];
}

function byClass(node: FakeElement, className: string): FakeElement[] {
  return descendants(node).filter((item) =>
    item.className.split(" ").includes(className),
  );
}

function text(node: FakeElement): string {
  return [node.textContent, ...node.children.map(text)].join(" ");
}

const SOURCE = `
title: Banana Bread
servings: 10
ingredients:
  - { id: banana, qty: 2, unit: item }
  - { id: butter, qty: 1/2, unit: cup }
  - { id: flour, qty: 200, unit: g }
  - { id: salt }
steps:
  - { id: prepare, desc: Butter and flour a loaf pan }
  - { id: mash, uses: [banana] }
  - { id: melt, uses: [{ id: butter, qty: 1/4 }] }
  - { id: brush, uses: [{ id: butter, qty: 1/4 }] }
  - { id: sift, uses: [flour] }
  - { id: mix, uses: [sift, melt, brush, salt] }
  - { id: combine, uses: [mash, mix] }
  - { id: bake, uses: [combine], time: 1h30m }
`;

describe("renderRecipe", () => {
  test("renders a responsive recipe flow into the supplied document", () => {
    const parsed = parseRecipe(SOURCE);
    assert.ok(parsed.ok);
    const document = new FakeDocument();
    const target = document.createElement("main");
    target.append(document.createElement("p"));

    const rendered = renderRecipe(
      parsed.recipe,
      target as unknown as HTMLElement,
    ) as unknown as FakeElement;

    assert.equal(target.children.length, 1, "the previous visualization is replaced");
    assert.equal(target.children[0], rendered);
    assert.equal(rendered.ownerDocument, target.ownerDocument);
    assert.match(text(rendered), /Banana Bread/);
    assert.match(text(rendered), /10 servings/);
    assert.match(text(rendered), /2 banana/);
    assert.match(text(rendered), /1\/2 cup butter/);
    assert.match(text(rendered), /1 hr 30 min/);
    assert.equal(rendered.attributes.get("aria-label"), "Banana Bread recipe flow");
    assert.equal(byClass(rendered, "yv-prep-item")[0]?.dataset.nodeId, "prepare");
    assert.deepEqual(
      byClass(rendered, "yv-stage").map((stage) => stage.dataset.nodeId),
      ["mash", "melt", "brush", "sift", "mix", "combine", "bake"],
    );

    const combine = byClass(rendered, "yv-stage").find(
      (stage) => stage.dataset.nodeId === "combine",
    );
    const band = combine?.children[0];
    assert.equal(band?.style.values.get("grid-row"), "1 / span 4");

    const css =
      byClass(rendered, "")[0]?.textContent ?? rendered.children[0]?.textContent;
    assert.doesNotMatch(
      css ?? "",
      /https?:\/\//,
      "rendering does not load remote assets",
    );
  });
});
