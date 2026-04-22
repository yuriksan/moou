import DOMPurify from 'dompurify';

// Enforce rel="noopener noreferrer" on all links and restrict style to safe properties
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('target', '_blank');
    node.setAttribute('rel', 'noopener noreferrer');
  }
  // Restrict style to safe properties only (prevent UI redress)
  if (node.hasAttribute('style')) {
    const style = (node as HTMLElement).style;
    const safeProps = ['white-space', 'text-align', 'font-weight', 'font-style', 'text-decoration'];
    const allowed: string[] = [];
    for (const prop of safeProps) {
      const val = style.getPropertyValue(prop);
      if (val) allowed.push(`${prop}: ${val}`);
    }
    if (allowed.length) {
      node.setAttribute('style', allowed.join('; '));
    } else {
      node.removeAttribute('style');
    }
  }
});

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'i', 'em', 'strong', 'ul', 'ol', 'li',
    'a', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'pre', 'div', 'h1', 'h2', 'h3', 'h4', 'sub', 'sup', 'hr', 'blockquote',
  ],
  ALLOWED_ATTR: ['href', 'style', 'class'],
  FORCE_BODY: true,
  RETURN_TRUSTED_TYPE: false,
};

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as string;
}
