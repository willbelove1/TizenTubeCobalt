// network-monitor.js

// Assuming ErrorHandler and fetchWithRetry are globally available or will be imported.
// If not, they would need:
// import ErrorHandler from './error-handler.js';
// import { fetchWithRetry } from './api-utils.js';

class NetworkMonitor {
  constructor(options = {}) {
    this.listeners = new Map();
    this.currentSpeedMbps = options.defaultSpeedMbps || 5; // Default to 5 Mbps
    this.testIntervalMs = options.testIntervalMs || 10000; // Test every 10 seconds
    this.testEndpoint = options.testEndpoint || 'https://api.tizentube.com/test'; // Configurable test endpoint
    this.testFileSizeKB = options.testFileSizeKB || 100; // Assumed size of the test file in KB for calculation

    this.isMonitoring = false;
    this.intervalId = null;

    console.log(`[NetworkMonitor] Initialized. Default speed: ${this.currentSpeedMbps} Mbps. Test interval: ${this.testIntervalMs / 1000}s.`);
    // Automatically start monitoring, or provide a public start() method
    // this.startMonitoring();
  }

  /**
   * Registers a callback for a specific event.
   * @param {string} eventName - Currently only 'speedChange' is supported.
   * @param {function(number)} callback - Function to call when the event occurs, receives speed in Mbps.
   */
  on(eventName, callback) {
    if (typeof callback !== 'function') {
      console.error('[NetworkMonitor] on: Provided callback is not a function.');
      return;
    }
    if (eventName === 'speedChange') {
      if (!this.listeners.has(eventName)) {
        this.listeners.set(eventName, []);
      }
      this.listeners.get(eventName).push(callback);
      // console.log(`[NetworkMonitor] Listener added for '${eventName}'.`);
    } else {
      console.warn(`[NetworkMonitor] on: Event '${eventName}' is not supported.`);
    }
  }

  /**
   * Emits an event to all registered listeners.
   * @private
   * @param {string} eventName - The name of the event to emit.
   * @param {any} data - The data to pass to the listeners.
   */
  _emit(eventName, data) {
    if (this.listeners.has(eventName)) {
      // console.log(`[NetworkMonitor] Emitting '${eventName}' with data:`, data);
      this.listeners.get(eventName).forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error(`[NetworkMonitor] Error in '${eventName}' listener:`, error);
          if (typeof ErrorHandler !== 'undefined' && ErrorHandler.handle) {
            // User-facing message might be too disruptive for background listener errors.
            // Consider logging to analytics only or using a less intrusive user message.
            ErrorHandler.handle(error, `NetworkMonitor.emit.${eventName}`, 'Lỗi nội bộ khi xử lý thay đổi mạng.');
          } else {
            console.error(`[NetworkMonitor.emit.${eventName}] ErrorHandler not available. Caught error:`, error);
          }
        }
      });
    }
  }

  /**
   * Starts the periodic network speed monitoring.
   */
  startMonitoring() {
    if (this.isMonitoring) {
      console.warn('[NetworkMonitor] Monitoring is already active.');
      return;
    }
    this.isMonitoring = true;
    console.log('[NetworkMonitor] Starting network monitoring...');
    // Perform an initial test immediately
    this.performSpeedTest().then(() => {
        // Then set up the interval
        if (this.isMonitoring) { // Check again in case stopMonitoring was called during the initial test
            this.intervalId = setInterval(async () => {
                await this.performSpeedTest();
            }, this.testIntervalMs);
        }
    });
  }

  /**
   * Stops the periodic network speed monitoring.
   */
  stopMonitoring() {
    if (!this.isMonitoring) {
      // console.log('[NetworkMonitor] Monitoring is not active.');
      return;
    }
    this.isMonitoring = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    console.log('[NetworkMonitor] Network monitoring stopped.');
  }

  /**
   * Performs a network speed test.
   * Downloads a small file (or uses HEAD request) and calculates the speed.
   * @returns {Promise<number>} The estimated speed in Mbps.
   */
  async performSpeedTest() {
    const startTime = performance.now();
    const fetchFunction = typeof fetchWithRetry === 'function' ? fetchWithRetry : fetch;

    try {
      // Using HEAD request as specified in the solution to avoid downloading a body.
      // This method primarily tests latency and server responsiveness rather than actual bandwidth.
      // The calculation (testFileSizeKB * 1024 * 8) / (durationMs / 1000) / 1000000 is an estimation.
      const fetchFunc = typeof fetchWithRetry === 'function' ? fetchWithRetry : fetch;

      // fetchWithRetry will handle retries and terminal errors by calling ErrorHandler itself.
      // So, if fetchFunc is indeed fetchWithRetry, the catch block here might be redundant
      // for network errors, but still useful for other unexpected errors.
      const response = await fetchFunc(this.testEndpoint, { method: 'HEAD', mode: 'cors' });

      // If fetchFunc was standard fetch and it failed, it would throw, caught by outer catch.
      // If fetchFunc was fetchWithRetry and it ultimately failed, it would have called ErrorHandler and returned null.
      if (response === null && typeof fetchWithRetry === 'function') {
        // fetchWithRetry already handled the error and called ErrorHandler.
        // We might want to set a very low speed or keep previous, and not call ErrorHandler again.
        console.warn('[NetworkMonitor] performSpeedTest: fetchWithRetry failed and returned null. Keeping previous speed.');
        return this.currentSpeedMbps;
      }

      // If we reach here and response is null (but not from fetchWithRetry), it's an issue.
      // However, a HEAD request that is successful (e.g. 200 OK) but has no body is normal.
      // fetchWithRetry returns parsed JSON or null for 204/empty. A HEAD request won't have JSON.
      // The original fetchWithRetry might need adjustment for HEAD requests or non-JSON responses.
      // For now, let's assume if response is null here, it's an issue not caught by fetchWithRetry's !response.ok
      if (response === null) {
          throw new Error('Speed test HEAD request resulted in null response unexpectedly.');
      }


      const endTime = performance.now();
      const durationMs = endTime - startTime;

      if (durationMs <= 0) { // Avoid division by zero or nonsensical negative duration
        console.warn('[NetworkMonitor] Speed test duration was non-positive. Using previous speed.');
        return this.currentSpeedMbps;
      }

      const sizeInBits = this.testFileSizeKB * 1024 * 8;
      const durationInSeconds = durationMs / 1000;
      let newSpeedMbps = (sizeInBits / durationInSeconds) / 1000000; // Convert bits/sec to Mbps

      newSpeedMbps = Math.min(newSpeedMbps, 1000); // Cap at 1 Gbps
      newSpeedMbps = Math.max(newSpeedMbps, 0.1);  // Cap at 0.1 Mbps minimum

      if (this.currentSpeedMbps !== newSpeedMbps) {
        this.currentSpeedMbps = newSpeedMbps;
        this._emit('speedChange', this.currentSpeedMbps);
      }
      return this.currentSpeedMbps;

    } catch (error) {
      // If fetchWithRetry was used, it would have already called ErrorHandler for network errors.
      // This catch block will now primarily handle errors if standard fetch was used,
      // or other unexpected errors during the speed calculation.
      const isNetworkErrorFromFetchRetry = error.message.includes("Lỗi kết nối đến máy chủ");

      if (!(typeof fetchWithRetry === 'function' && isNetworkErrorFromFetchRetry)) {
        if (typeof ErrorHandler !== 'undefined' && ErrorHandler.handle) {
            ErrorHandler.handle(error, 'NetworkMonitor.performSpeedTest', 'Không thể kiểm tra tốc độ mạng.');
        } else {
            console.error('[NetworkMonitor.performSpeedTest] ErrorHandler not available. Error:', error.message);
        }
      } else {
          // Log locally if fetchWithRetry already handled the user-facing part.
          console.error('[NetworkMonitor] Speed test failed (already handled by fetchWithRetry):', error.message);
      }

      // Fallback strategy: Keep the last known speed or a safe default.
      // Consider if a failed test should significantly reduce the reported speed.
      // For example: this.currentSpeedMbps = Math.max(this.currentSpeedMbps / 2, 0.5);
      // this._emit('speedChange', this.currentSpeedMbps);
      return this.currentSpeedMbps;
    }
  }

  /**
   * Gets the current estimated network speed.
   * @returns {number} The current speed in Mbps.
   */
  getCurrentSpeed() {
    return this.currentSpeedMbps;
  }
}

// Example of making it globally available, if not using modules and a bundler
// window.networkMonitor = new NetworkMonitor();
// It's better to instantiate it where needed.
// For AutoQualityController, it will instantiate its own NetworkMonitor.
