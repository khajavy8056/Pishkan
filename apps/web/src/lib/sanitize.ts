/**
 * Strict allow-list HTML sanitizer for blog article bodies.
 *
 * The blog editor stores HTML; anything rendered to readers passes through
 * here first. Only a small article vocabulary survives (headings, text
 * emphasis, lists, quotes, links, images, tables) with `href`/`src`
 * restricted to web-safe schemes. Everything else is unwrapped or dropped,
 * and scriptable subtrees are removed wholesale.
 */

const ALLOWED_TAGS = new Set([
  'P', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'S', 'A', 'UL', 'OL', 'LI', 'BLOCKQUOTE',
  'H2', 'H3', 'H4', 'IMG', 'HR', 'SPAN', 'DIV', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'CODE', 'PRE',
]);
const DROP_SUBTREE = new Set([
  'SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'BUTTON', 'INPUT', 'SELECT',
  'TEXTAREA', 'LINK', 'META', 'BASE', 'TITLE', 'NOSCRIPT', 'SVG', 'MATH', 'VIDEO', 'AUDIO', 'SOURCE',
]);

const SAFE_URL = /^(https?:\/\/|\/|#|mailto:|tel:)/i;

function cleanNode(node: Node, doc: Document): Node | null {
  if (node.nodeType === Node.TEXT_NODE) return doc.createTextNode(node.textContent ?? '');
  if (node.nodeType !== Node.ELEMENT_NODE) return null;
  const el = node as Element;
  const tag = el.tagName;
  if (DROP_SUBTREE.has(tag)) return null;

  const children: Node[] = [];
  el.childNodes.forEach((child) => {
    const cleaned = cleanNode(child, doc);
    if (cleaned) children.push(cleaned);
  });

  if (!ALLOWED_TAGS.has(tag)) {
    // unknown wrapper: keep its (cleaned) children only
    const fragment = doc.createDocumentFragment();
    children.forEach((c) => fragment.appendChild(c));
    return fragment;
  }

  const out = doc.createElement(tag.toLowerCase());
  if (tag === 'A') {
    const href = el.getAttribute('href') ?? '';
    if (SAFE_URL.test(href)) {
      out.setAttribute('href', href);
      if (/^https?:\/\//i.test(href)) {
        out.setAttribute('target', '_blank');
        out.setAttribute('rel', 'noopener noreferrer');
      }
    }
  }
  if (tag === 'IMG') {
    const src = el.getAttribute('src') ?? '';
    if (!SAFE_URL.test(src) || /^data:/i.test(src)) return null;
    out.setAttribute('src', src);
    out.setAttribute('alt', el.getAttribute('alt') ?? '');
    out.setAttribute('loading', 'lazy');
  }
  children.forEach((c) => out.appendChild(c));
  return out;
}

export function sanitizeHtml(html: string): string {
  if (!html) return '';
  if (typeof window === 'undefined' || typeof DOMParser === 'undefined') {
    return html.replace(/<[^>]*>/g, ' ');
  }
  const parsed = new DOMParser().parseFromString(html, 'text/html');
  const host = parsed.createElement('div');
  parsed.body.childNodes.forEach((child) => {
    const cleaned = cleanNode(child, parsed);
    if (cleaned) host.appendChild(cleaned);
  });
  return host.innerHTML;
}
