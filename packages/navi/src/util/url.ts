/**
 * Centralized URL validation logic for Navi tools.
 */
export function validateUrl(url: string): void {
  if (!url.startsWith("http://") && !url.startsWith("https://")) {
    throw new Error("URL must start with http:// or https://")
  }
}
