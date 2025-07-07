// api-utils.js

import { ErrorHandler } from './error-handler.js';

/**
 * Fetches a resource with retry logic and exponential backoff.
 * @param {string} url - The URL to fetch.
 * @param {object} options - Fetch options (method, headers, body, etc.).
 * @param {number} [retries=3] - The maximum number of retries.
 * @param {number} [initialBackoff=1000] - The initial backoff delay in milliseconds.
 * @returns {Promise<any|null>} The parsed JSON response if successful, otherwise null after all retries.
 */
async function fetchWithRetry(url, options = {}, retries = 3, initialBackoff = 1000) {
  let lastError = null;

  for (let i = 0; i < retries; i++) {
    try {
      const response = await fetch(url, options);

      if (response.status === 429) { // Rate limited
        const retryAfter = parseInt(response.headers.get('Retry-After'), 10); // Seconds
        const backoffDuration = isNaN(retryAfter) ? (initialBackoff * Math.pow(2, i)) : retryAfter * 1000;

        const warningMessage = `Rate limited. Retrying after ${backoffDuration / 1000}s... (Attempt ${i + 1}/${retries})`;
        console.warn(`[fetchWithRetry] ${url} - ${warningMessage}`);
        // ErrorHandler.handle(new Error(warningMessage), `fetchWithRetry - ${url}`, `Tạm thời bị giới hạn yêu cầu. Đang thử lại...`); // This might be too noisy for users

        await new Promise(resolve => setTimeout(resolve, backoffDuration));
        lastError = new Error(`Rate limited: ${response.status}`); // Store error for potential final throw
        continue; // Move to next retry attempt
      }

      if (!response.ok) {
        let errorData;
        try {
          errorData = await response.json(); // Try to parse error response from server
        } catch (e) {
          // If error response is not JSON, use status text
          errorData = { message: response.statusText || `HTTP error ${response.status}` };
        }
        // Construct a more informative error
        const httpError = new Error(errorData.message || `HTTP error ${response.status}`);
        httpError.status = response.status;
        httpError.response = response; // Attach full response if needed
        httpError.errorData = errorData; // Attach parsed error data
        throw httpError;
      }

      // Handle cases where response is OK but content might be empty (e.g., 204 No Content)
      if (response.status === 204 || response.headers.get('content-length') === '0') {
        return null; // Or an empty object/array based on expected response type
      }

      // Assuming successful responses are JSON. Adjust if other content types are expected.
      return await response.json();

    } catch (error) {
      lastError = error; // Store the most recent error
      console.error(`[fetchWithRetry] Attempt ${i + 1}/${retries} for ${url} failed:`, error.message);

      if (i < retries - 1) { // If not the last retry
        const backoffDuration = initialBackoff * Math.pow(2, i);
        console.log(`[fetchWithRetry] Retrying in ${backoffDuration / 1000}s...`);
        await new Promise(resolve => setTimeout(resolve, backoffDuration));
      }
    }
  }

  // All retries failed
  const finalMessage = `Failed to fetch ${url} after ${retries} attempts.`;
  console.error(`[fetchWithRetry] ${finalMessage}`, lastError);

  // Use ErrorHandler for the final, persistent error.
  // Pass the actual lastError to ErrorHandler for more detailed logging.
  if (typeof ErrorHandler !== 'undefined' && ErrorHandler.handle) {
    ErrorHandler.handle(lastError || new Error(finalMessage), `fetchWithRetry - ${url}`, 'Lỗi kết nối đến máy chủ sau nhiều lần thử. Vui lòng kiểm tra lại kết nối mạng.');
  } else {
    console.error(`[fetchWithRetry] Final error for ${url} (ErrorHandler not available):`, lastError || new Error(finalMessage));
  }

  // Throw the error so the caller knows the operation ultimately failed and can act accordingly.
  // Callers should be prepared to catch this.
  throw lastError || new Error(finalMessage);
}

// To make it globally available if not using modules:
// window.fetchWithRetry = fetchWithRetry;

// Export for ES6 modules
export { fetchWithRetry };
