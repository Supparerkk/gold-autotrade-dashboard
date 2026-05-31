// Filename: src/lib/security.ts

/**
 * Base64 obfuscates a string value and saves it to local storage.
 */
export function secureSet(key: string, value: string): void {
  if (typeof window === 'undefined') return;
  try {
    const obfuscated = btoa(encodeURIComponent(value));
    localStorage.setItem(key, obfuscated);
  } catch (e) {
    console.error('Failed to obfuscate and save token:', e);
  }
}

/**
 * Loads a value from local storage and decodes it from Base64.
 */
export function secureGet(key: string): string {
  if (typeof window === 'undefined') return '';
  try {
    const value = localStorage.getItem(key);
    if (!value) return '';
    return decodeURIComponent(atob(value));
  } catch (e) {
    console.error('Failed to decode saved token:', e);
    return '';
  }
}

/**
 * Strips HTML/script tags and escapes characters to prevent XSS injection.
 */
export function sanitize(input: string): string {
  if (typeof input !== 'string') return '';
  
  // 1. Strip script and HTML tags using regex
  let clean = input.replace(/<[^>]*>/g, '');
  
  // 2. Escape special characters
  clean = clean
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;')
    .replace(/\//g, '&#x2F;');

  return clean.trim();
}
