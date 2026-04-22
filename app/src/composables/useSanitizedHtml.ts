import DOMPurify from 'dompurify';

const PURIFY_CONFIG = {
  ALLOWED_TAGS: [
    'p', 'br', 'b', 'i', 'em', 'strong', 'ul', 'ol', 'li',
    'a', 'span', 'table', 'thead', 'tbody', 'tr', 'th', 'td',
    'pre', 'div', 'h1', 'h2', 'h3', 'h4', 'sub', 'sup', 'hr', 'blockquote',
  ],
  ALLOWED_ATTR: ['href', 'target', 'style', 'class'],
  FORCE_BODY: true,
  RETURN_TRUSTED_TYPE: false,
};

export function sanitizeHtml(html: string): string {
  return DOMPurify.sanitize(html, PURIFY_CONFIG) as string;
}
