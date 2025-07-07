// auth-manager.js

// Assuming ErrorHandler is globally available or will be imported if using modules
// For now, we'll assume ErrorHandler is available on the window or will be handled by a bundler.
// If not, it would need: import ErrorHandler from './error-handler.js'; (if using ES6 modules)

// Assuming fetchWithRetry is globally available or will be imported.
// If not, it would need: import { fetchWithRetry } from './api-utils.js'; (if using ES6 modules)


class AuthManager {
  constructor() {
    this.tokenKey = 'tizentube_token';
    // Potentially, API endpoints could be configurable
    this.loginEndpoint = 'https://api.tizentube.com/v1/auth/login';
    this.refreshEndpoint = 'https://api.tizentube.com/v1/auth/refresh';
  }

  /**
   * Logs in the user with the provided credentials.
   * @param {string} username - The username.
   * @param {string} password - The password.
   * @returns {Promise<string|null>} The token if login is successful, otherwise null.
   */
  async login(username, password) {
    if (!username || !password) {
      const errMsg = 'Username and password are required.';
      console.error(`[AuthManager] Login Error: ${errMsg}`);
      // Optionally, use ErrorHandler.handle here if it's appropriate for this kind of validation error
      // ErrorHandler.handle(new Error(errMsg), 'AuthManager.login', errMsg);
      return null;
    }

    const options = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password })
    };

    try {
      // Use fetchWithRetry if available, otherwise fallback to standard fetch
      const fetchFunction = typeof fetchWithRetry === 'function' ? fetchWithRetry : fetch;
      const response = await fetchFunction(this.loginEndpoint, options);

      // fetchWithRetry is expected to return JSON directly or throw.
      // If using standard fetch, we'd need:
      // if (!response.ok) {
      //   const errorData = await response.json().catch(() => ({ message: 'Login failed with status: ' + response.status }));
      //   throw new Error(errorData.message || `HTTP error ${response.status}`);
      // }
      // const data = await response.json();

      const token = response?.token; // Assuming fetchWithRetry returns parsed JSON

      if (token) {
        localStorage.setItem(this.tokenKey, token);
        console.log('[AuthManager] Login successful. Token stored.');
        return token;
      } else {
        const errMsg = 'Login failed: No token received from server.';
        // Ensure ErrorHandler is available, e.g. window.ErrorHandler
        if (typeof ErrorHandler !== 'undefined' && ErrorHandler.handle) {
            ErrorHandler.handle(new Error(errMsg), 'AuthManager.login', 'Đăng nhập thất bại. Vui lòng kiểm tra lại thông tin.');
        } else {
            console.error('[AuthManager.login] ErrorHandler not available. Error:', errMsg);
        }
        return null;
      }
    } catch (error) {
      // Ensure ErrorHandler is available
      if (typeof ErrorHandler !== 'undefined' && ErrorHandler.handle) {
        ErrorHandler.handle(error, 'AuthManager.login', 'Lỗi trong quá trình đăng nhập.');
      } else {
        console.error('[AuthManager.login] ErrorHandler not available. Caught error:', error);
      }
      return null;
    }
  }

  /**
   * Refreshes the current authentication token.
   * @returns {Promise<string|null>} The new token if refresh is successful, otherwise null.
   */
  async refreshToken() {
    const currentToken = this.getToken();
    if (!currentToken) {
      // No need to call ErrorHandler.handle here, as this might be a normal state (e.g., user not logged in)
      console.warn('[AuthManager] No token found to refresh.');
      return null;
    }

    const options = {
      method: 'POST', // Typically refresh is POST, but the spec showed GET-like headers. Assuming POST.
      headers: {
        'Content-Type': 'application/json', // Added Content-Type
        'Authorization': `Bearer ${currentToken}`
      }
      // body: JSON.stringify({}) // Some refresh endpoints might require an empty body or specific payload
    };

    try {
      // Use fetchWithRetry if available, otherwise fallback to standard fetch
      const fetchFunction = typeof fetchWithRetry === 'function' ? fetchWithRetry : fetch;
      const response = await fetchFunction(this.refreshEndpoint, options);

      const newToken = response?.newToken; // Assuming fetchWithRetry returns parsed JSON

      if (newToken) {
        localStorage.setItem(this.tokenKey, newToken);
        console.log('[AuthManager] Token refreshed successfully.');
        return newToken;
      } else {
        const errMsg = 'Token refresh failed: No new token received.';
        if (typeof ErrorHandler !== 'undefined' && ErrorHandler.handle) {
            ErrorHandler.handle(new Error(errMsg), 'AuthManager.refreshToken', 'Phiên làm việc hết hạn. Vui lòng đăng nhập lại.');
        } else {
            console.error('[AuthManager.refreshToken] ErrorHandler not available. Error:', errMsg);
        }
        this.clearToken(); // Clear invalid token
        return null;
      }
    } catch (error) {
      if (typeof ErrorHandler !== 'undefined' && ErrorHandler.handle) {
        ErrorHandler.handle(error, 'AuthManager.refreshToken', 'Lỗi làm mới phiên làm việc. Vui lòng đăng nhập lại.');
      } else {
        console.error('[AuthManager.refreshToken] ErrorHandler not available. Caught error:', error);
      }
      this.clearToken(); // Clear token on error
      return null;
    }
  }

  /**
   * Retrieves the current token from localStorage.
   * @returns {string|null} The token, or null if not found.
   */
  getToken() {
    return localStorage.getItem(this.tokenKey);
  }

  /**
   * Clears the token from localStorage (logout).
   */
  clearToken() {
    localStorage.removeItem(this.tokenKey);
    console.log('[AuthManager] Token cleared (logged out).');
  }

  /**
   * Checks if the user is currently authenticated (i.e., a token exists).
   * @returns {boolean} True if a token exists, false otherwise.
   */
  isAuthenticated() {
    return !!this.getToken();
  }
}

// Example of making it globally available, if not using modules and a bundler
// window.authManager = new AuthManager();
// However, it's better to instantiate it where needed or use a dependency injection pattern.
