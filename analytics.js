// analytics.js
import { ErrorHandler } from './error-handler.js';
import { fetchWithRetry } from './api-utils.js';

class Analytics {
  constructor() {
    this.events = [];
    this.sessionId = this.generateSessionId();
    this.userId = this.getUserId(); // Persisted user ID
    this.batchSize = 50; // Send events when this many are queued
    this.flushIntervalMs = 30000; // Send events every 30 seconds regardless of batch size
    this.flushTimerId = null;
    this.analyticsEndpoint = '/api/analytics/events'; // Configurable endpoint

    // Bind methods to ensure 'this' context is correct, especially for event listeners
    this._handlePageHide = this._handlePageHide.bind(this);
    this._handleDocumentClick = this._handleDocumentClick.bind(this);

    this.setupEventListeners();
    this.startPeriodicFlush();
    console.log(`[Analytics] Initialized. Session ID: ${this.sessionId}, User ID: ${this.userId}`);
  }

  /**
   * Tracks a generic event.
   * @param {string} eventName - The name of the event.
   * @param {object} [properties={}] - Additional properties for the event.
   */
  trackEvent(eventName, properties = {}) {
    if (!eventName || typeof eventName !== 'string') {
      console.warn('[Analytics.trackEvent] Invalid eventName provided.');
      return;
    }
    try {
      const event = {
        id: this.generateEventId(), // Unique ID for this specific event occurrence
        name: eventName,
        properties: {
          ...properties, // User-defined properties
          timestamp: Date.now(),
          sessionId: this.sessionId,
          userId: this.userId,
          userAgent: navigator.userAgent,
          url: window.location.href,
          // screenResolution: `${window.screen.width}x${window.screen.height}`, // Example of more device info
          // language: navigator.language,
        }
      };

      this.events.push(event);
      // console.log('[Analytics] Event tracked:', eventName, event.properties);

      if (this.events.length >= this.batchSize) {
        console.log(`[Analytics] Batch size reached (${this.events.length}). Flushing events.`);
        this.flush(); // Don't wait for await, let it run in background
      }
    } catch (error) {
      // Should not happen with basic event creation, but good for safety
      ErrorHandler.handle(error, 'Analytics.trackEvent', 'Lỗi khi theo dõi sự kiện.');
    }
  }

  /**
   * Tracks a video-specific event.
   * @param {string} eventName - e.g., 'video_play', 'video_pause', 'video_seek'
   * @param {object} videoData - Object containing video details.
   */
  trackVideoEvent(eventName, videoData = {}) {
    const properties = {
      videoId: videoData.id,
      title: videoData.title,
      duration: videoData.duration,
      currentTime: videoData.currentTime,
      quality: videoData.quality,
      volume: videoData.volume,
      playbackRate: videoData.playbackRate,
      // Add any other relevant video properties
      isMuted: videoData.muted,
      isFullScreen: videoData.fullscreen,
    };
    this.trackEvent(eventName, properties);
  }

  /**
   * Tracks performance metrics like page load times.
   */
  trackPerformanceMetrics() {
    try {
      if (performance && performance.timing) {
        const timing = performance.timing;
        const metrics = {
          loadTime: timing.loadEventEnd > 0 && timing.navigationStart > 0 ? timing.loadEventEnd - timing.navigationStart : null,
          domContentLoadedTime: timing.domContentLoadedEventEnd > 0 && timing.navigationStart > 0 ? timing.domContentLoadedEventEnd - timing.navigationStart : null,
          // firstPaint and firstContentfulPaint require PerformanceObserver or getEntriesByType
          // These might not be available immediately or might need to be observed.
        };

        const paintEntries = performance.getEntriesByType?.('paint');
        if (paintEntries) {
            const fpEntry = paintEntries.find(entry => entry.name === 'first-paint');
            if (fpEntry) metrics.firstPaint = fpEntry.startTime;

            const fcpEntry = paintEntries.find(entry => entry.name === 'first-contentful-paint');
            if (fcpEntry) metrics.firstContentfulPaint = fcpEntry.startTime;
        }

        this.trackEvent('performance_metrics', metrics);
      } else {
        console.warn('[Analytics.trackPerformanceMetrics] PerformanceTiming API not fully available.');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'Analytics.trackPerformanceMetrics', 'Lỗi khi theo dõi chỉ số hiệu suất.');
    }
  }

  /**
   * Sends currently queued events to the server.
   */
  async flush() {
    if (this.events.length === 0) {
      // console.log('[Analytics] No events to flush.');
      return;
    }

    const eventsToSend = [...this.events]; // Copy events to send
    this.events = []; // Clear the queue immediately

    console.log(`[Analytics] Flushing ${eventsToSend.length} events.`);
    try {
      await this.sendEvents(eventsToSend);
      console.log(`[Analytics] Successfully flushed ${eventsToSend.length} events.`);
    } catch (error) {
      // ErrorHandler.handle is called by sendEvents (via fetchWithRetry)
      // So, we just log here and re-queue failed events.
      console.error(`[Analytics.flush] Flush failed: ${error.message}. Re-queuing ${eventsToSend.length} events.`);
      this.events.unshift(...eventsToSend); // Add events back to the front of the queue

      // Optional: Implement a backoff for retrying flushes if the server is down
      // or if there are persistent network issues.
    }
  }

  /**
   * Sends a batch of events to the analytics server.
   * @param {Array<object>} eventsBatch - The batch of events to send.
   */
  async sendEvents(eventsBatch) {
    // Payload structure as per user specification
    const payload = {
      events: eventsBatch.map(event => ({
        id: event.id,
        name: event.name,
        timestamp: event.properties.timestamp, // Already part of properties
        sessionId: event.properties.sessionId, // Already part of properties
        userId: event.properties.userId,       // Already part of properties
        data: event.properties // Contains all other properties including the ones above
      }))
    };

    try {
      // fetchWithRetry will handle retries and call ErrorHandler on final failure.
      // It will throw an error if it ultimately fails.
      await fetchWithRetry(this.analyticsEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}` // Assuming token is needed
        },
        body: JSON.stringify(payload)
      });
      // If fetchWithRetry succeeds (doesn't throw), the request was successful (e.g. 2xx).
      // For POST, a 204 No Content is also a success. fetchWithRetry returns null for 204.
    } catch (error) {
      // Error is already handled by fetchWithRetry's ErrorHandler.
      // Re-throw to let flush() know and re-queue events.
      console.error(`[Analytics.sendEvents] API call failed after retries: ${error.message}`);
      throw error;
    }
  }

  /**
   * Generates a new session ID (UUID v4 like).
   * @returns {string} A new session ID.
   */
  generateSessionId() {
    // Basic UUID v4 generator
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
      const r = Math.random() * 16 | 0;
      const v = c === 'x' ? r : (r & 0x3 | 0x8);
      return v.toString(16);
    });
  }

  /**
   * Generates a unique ID for an event.
   * @returns {string} A new event ID.
   */
  generateEventId() {
    // Simple unique ID based on time and random number
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  /**
   * Retrieves or generates a persistent user ID.
   * @returns {string} The user ID.
   */
  getUserId() {
    const userIdKey = 'tizentube_analytics_user_id';
    let userId = localStorage.getItem(userIdKey);
    if (!userId) {
      userId = this.generateSessionId(); // Generate a new one if not found
      try {
        localStorage.setItem(userIdKey, userId);
      } catch (e) {
        console.warn('[Analytics] Could not persist user ID to localStorage:', e.message);
        // Use in-memory for this session if localStorage fails
      }
    }
    return userId;
  }

  /**
   * Sets up global event listeners for automatic event tracking.
   */
  setupEventListeners() {
    // Track clicks on document
    document.addEventListener('click', this._handleDocumentClick, true); // Use capture phase

    // Flush events when page is about to be unloaded
    // 'visibilitychange' with document.visibilityState === 'hidden' is more reliable than 'beforeunload' or 'unload'
    // 'pagehide' is also a good option for mobile.
    window.addEventListener('visibilitychange', this._handlePageHide);
    window.addEventListener('pagehide', this._handlePageHide); // For mobile specifically

    // Track initial performance metrics after page load
    if (document.readyState === 'complete') {
        this.trackPerformanceMetrics();
    } else {
        window.addEventListener('load', () => this.trackPerformanceMetrics());
    }
  }

  _handleDocumentClick(event) {
    // Basic click tracking - can be made more sophisticated
    let targetElement = event.target;
    let cssSelector = '';
    try {
        // Try to build a simple selector
        while(targetElement && targetElement.tagName && cssSelector.length < 200) {
            let currentSelector = targetElement.tagName.toLowerCase();
            if (targetElement.id) {
                currentSelector += `#${targetElement.id}`;
                cssSelector = currentSelector + (cssSelector ? ` > ${cssSelector}` : '');
                break; // Stop if ID found
            } else if (targetElement.className && typeof targetElement.className === 'string') {
                currentSelector += `.${targetElement.className.trim().split(/\s+/).join('.')}`;
            }
            cssSelector = currentSelector + (cssSelector ? ` > ${cssSelector}` : '');
            if (targetElement.parentNode === document || !targetElement.parentNode) break;
            targetElement = targetElement.parentNode;
        }
    } catch (e) { /* ignore selector generation errors */ }

    this.trackEvent('document_click', {
      targetTagName: event.target.tagName,
      targetId: event.target.id || null,
      targetClassName: event.target.className || null,
      targetSelector: cssSelector.substring(0, 250), // Limit selector length
      // textContent: event.target.textContent?.substring(0, 50), // Be careful with PII
    });
  }

  _handlePageHide(event) {
      // For 'visibilitychange', only flush if the state becomes 'hidden'
      if (event.type === 'visibilitychange' && document.visibilityState !== 'hidden') {
          return;
      }
      // For 'pagehide' or 'visibilitychange' to hidden, try to flush.
      // Note: Network requests in pagehide/unload are not guaranteed.
      // navigator.sendBeacon is preferred if this needs to be more robust,
      // but that requires a different server endpoint setup (typically POST with no complex headers).
      // For now, we use the existing flush which uses fetch.
      if (this.events.length > 0) {
          console.log('[Analytics] Page hidden/unloading, attempting to flush events.');
          this.flush();
      }
  }


  /**
   * Starts a timer to periodically flush events.
   */
  startPeriodicFlush() {
    if (this.flushTimerId) {
      clearInterval(this.flushTimerId);
    }
    this.flushTimerId = setInterval(() => {
      // console.log('[Analytics] Periodic flush triggered.');
      this.flush();
    }, this.flushIntervalMs);
    console.log(`[Analytics] Periodic flush setup every ${this.flushIntervalMs / 1000}s.`);
  }

  /**
   * Stops the periodic flush timer.
   */
  stopPeriodicFlush() {
    if (this.flushTimerId) {
      clearInterval(this.flushTimerId);
      this.flushTimerId = null;
      console.log('[Analytics] Periodic flush stopped.');
    }
  }

  getAuthToken() {
    // This should ideally use AuthManager if available
    return localStorage.getItem('tizentube_token') || '';
  }

  // Call this method when the application is shutting down or analytics is no longer needed.
  destroy() {
    this.stopPeriodicFlush();
    document.removeEventListener('click', this._handleDocumentClick, true);
    window.removeEventListener('visibilitychange', this._handlePageHide);
    window.removeEventListener('pagehide', this._handlePageHide);
    // Attempt a final flush.
    this.flush();
    console.log('[Analytics] Destroyed.');
  }
}

export { Analytics };
