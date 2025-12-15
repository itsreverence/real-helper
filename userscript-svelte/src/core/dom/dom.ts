export function qs<T extends Element = Element>(sel: string, root: ParentNode = document): T | null {
  return root.querySelector(sel) as T | null;
}

export function qsa<T extends Element = Element>(sel: string, root: ParentNode = document): T[] {
  return Array.from(root.querySelectorAll(sel)) as T[];
}

export function textOf(el: Element | null | undefined): string {
  const anyEl = el as any;
  return String((anyEl && (anyEl.innerText || anyEl.textContent)) || "").trim();
}



