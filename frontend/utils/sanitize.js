/**
 * HTML Sanitization Utility using DOMPurify
 * Protects against XSS attacks by sanitizing HTML content before insertion
 */

// Import DOMPurify from CDN for browser usage
// This will be loaded via script tag in HTML files that need it

/**
 * Sanitize HTML content with DOMPurify
 * @param {string} dirty - Untrusted HTML string
 * @param {Object} config - Optional DOMPurify configuration
 * @returns {string} Sanitized HTML string safe for innerHTML
 */
function sanitizeHTML(dirty, config = {}) {
  // Check if DOMPurify is available
  if (typeof DOMPurify === 'undefined') {
    logger.error('DOMPurify not loaded! Falling back to basic sanitization.');
    return basicSanitize(dirty);
  }

  // Default configuration for exam questions
  const defaultConfig = {
    ALLOWED_TAGS: [
      'p', 'br', 'strong', 'em', 'b', 'i', 'u', 
      'ul', 'ol', 'li', 'div', 'span', 'img',
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
      'pre', 'code', 'blockquote'
    ],
    ALLOWED_ATTR: [
      'class', 'id', 'src', 'alt', 'title', 
      'width', 'height', 'style'
    ],
    ALLOWED_URI_REGEXP: /^(?:(?:(?:f|ht)tps?|mailto|tel|callto|cid|xmpp|data):|[^a-z]|[a-z+.\-]+(?:[^a-z+.\-:]|$))/i,
    KEEP_CONTENT: true,
    RETURN_TRUSTED_TYPE: false
  };

  // Merge custom config with defaults
  const finalConfig = { ...defaultConfig, ...config };

  try {
    return DOMPurify.sanitize(dirty, finalConfig);
  } catch (error) {
    logger.error('DOMPurify sanitization failed:', error);
    return basicSanitize(dirty);
  }
}

/**
 * Basic fallback sanitization when DOMPurify is not available
 * @param {string} html - HTML string to sanitize
 * @returns {string} Sanitized HTML
 */
function basicSanitize(html) {
  try {
    const container = document.createElement('div');
    container.innerHTML = String(html || '');
    
    // Remove script and style tags entirely
    container.querySelectorAll('script, style').forEach(el => el.remove());
    
    // Walk and strip unsafe attributes and protocols
    const walker = document.createTreeWalker(
      container, 
      NodeFilter.SHOW_ELEMENT, 
      null
    );
    
    while (walker.nextNode()) {
      const el = walker.currentNode;
      
      // Remove event handlers (on* attributes)
      Array.from(el.attributes || []).forEach(attr => {
        const name = attr.name.toLowerCase();
        if (name.startsWith('on')) {
          el.removeAttribute(attr.name);
        }
        
        // Validate href and src for safe protocols
        if (name === 'href' || name === 'src') {
          const val = (attr.value || '').trim();
          const safe = /^(https?:|\/|data:image\/)/i.test(val);
          if (!safe) {
            el.removeAttribute(attr.name);
          }
        }
      });
    }
    
    return container.innerHTML;
  } catch (e) {
    logger.error('Basic sanitization failed:', e);
    return String(html || '');
  }
}

/**
 * Sanitize for plain text display (strips all HTML)
 * @param {string} html - HTML string
 * @returns {string} Plain text without HTML tags
 */
function sanitizeText(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html;
  return temp.textContent || temp.innerText || '';
}

/**
 * Check if content contains HTML tags
 * @param {string} content - Content to check
 * @returns {boolean} True if content contains HTML
 */
function containsHTML(content) {
  return /(<img|<p|<br|<div|<span|<strong|<em|<b|<i|<ul|<ol|<li)/i.test(content);
}

// Export for module usage
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sanitizeHTML,
    basicSanitize,
    sanitizeText,
    containsHTML
  };
}

// Make available globally for non-module scripts
if (typeof window !== 'undefined') {
  window.sanitizeHTML = sanitizeHTML;
  window.sanitizeText = sanitizeText;
  window.containsHTML = containsHTML;
}
