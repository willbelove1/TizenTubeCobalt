// memory-manager.js
import { ErrorHandler } from './error-handler.js';

class MemoryManager {
  constructor(options = {}) {
    this.memoryThreshold = options.memoryThreshold || 0.8; // 80% of jsHeapSizeLimit
    this.cleanupIntervalMs = options.cleanupIntervalMs || 60000; // 60 seconds
    this.monitoringEnabled = options.monitoringEnabled !== undefined ? options.monitoringEnabled : true;
    this.monitorIntervalId = null;

    if (this.monitoringEnabled) {
      this.startMonitoring();
    }
    console.log('[MemoryManager] Initialized.');
  }

  startMonitoring() {
    if (this.monitorIntervalId) {
      console.warn('[MemoryManager] Monitoring is already active.');
      return;
    }
    if (!('memory' in performance)) {
      console.warn('[MemoryManager] performance.memory API not available. Memory monitoring disabled.');
      this.monitoringEnabled = false;
      return;
    }
    this.monitoringEnabled = true; // Ensure it's true if we proceed
    console.log(`[MemoryManager] Starting memory monitoring. Interval: ${this.cleanupIntervalMs / 1000}s, Threshold: ${this.memoryThreshold * 100}%.`);
    this.monitorIntervalId = setInterval(() => {
      if (this.monitoringEnabled) {
        this.checkMemoryUsage();
      }
    }, this.cleanupIntervalMs);
  }

  stopMonitoring() {
    if (this.monitorIntervalId) {
      clearInterval(this.monitorIntervalId);
      this.monitorIntervalId = null;
      console.log('[MemoryManager] Memory monitoring stopped.');
    }
    this.monitoringEnabled = false;
  }

  async checkMemoryUsage() {
    if (!('memory' in performance)) {
      // This check is also in startMonitoring, but good for robustness if called directly
      console.warn('[MemoryManager.checkMemoryUsage] performance.memory API not available.');
      return;
    }

    try {
      const memInfo = performance.memory;
      const usageRatio = memInfo.usedJSHeapSize / memInfo.jsHeapSizeLimit;

      console.log(`[MemoryManager] Memory usage: ${(usageRatio * 100).toFixed(2)}% (Used: ${memInfo.usedJSHeapSize / 1024 / 1024 MB}, Limit: ${memInfo.jsHeapSizeLimit / 1024 / 1024 MB})`);

      if (usageRatio > this.memoryThreshold) {
        console.warn(`[MemoryManager] Memory usage ${usageRatio * 100}% exceeds threshold ${this.memoryThreshold * 100}%. Performing cleanup.`);
        await this.performCleanup();
      }
    } catch (error) {
      ErrorHandler.handle(error, 'MemoryManager.checkMemoryUsage', 'Lỗi kiểm tra dung lượng bộ nhớ.');
    }
  }

  async performCleanup() {
    console.log('[MemoryManager] Performing cleanup tasks...');
    try {
      this.cleanupVideoBuffers();
      this.cleanupCache(); // This is async in VideoCache
      this.cleanupDOM();

      // Explicitly request garbage collection if available
      if (typeof window.gc === 'function') {
        console.log('[MemoryManager] Requesting garbage collection via window.gc().');
        window.gc();
      }
      console.log('[MemoryManager] Cleanup tasks completed.');
    } catch (error) {
      ErrorHandler.handle(error, 'MemoryManager.performCleanup', 'Lỗi trong quá trình dọn dẹp bộ nhớ.');
    }
  }

  cleanupVideoBuffers() {
    console.log('[MemoryManager] Cleaning up video buffers...');
    try {
      const videos = document.querySelectorAll('video');
      let cleanedCount = 0;
      videos.forEach(video => {
        // Only clear src if video is paused, not currently playing, and at the beginning (or no src)
        // to avoid interrupting active playback or a preloaded video.
        if (video.paused && (video.currentTime === 0 || !video.currentSrc) && video.networkState === HTMLMediaElement.NETWORK_EMPTY || video.networkState === HTMLMediaElement.NETWORK_NO_SOURCE) {
          // More robust check: if video is not visible or very far offscreen, it's a candidate.
          // For simplicity, sticking to paused and at start.
          const currentSrc = video.src || video.currentSrc;
          if (currentSrc && currentSrc !== window.location.href) { // Avoid clearing if src is just the page URL
            video.removeAttribute('src');
            video.load(); // This clears the buffer and resets the media element.
            cleanedCount++;
            console.log('[MemoryManager] Cleared buffer for video:', video.id || 'untitled video');
          }
        }
      });
      if (cleanedCount > 0) {
        console.log(`[MemoryManager] Cleaned buffers for ${cleanedCount} video elements.`);
      } else {
        console.log('[MemoryManager] No idle video buffers found to clean.');
      }
    } catch (error) {
      // Don't use ErrorHandler for this specific cleanup part usually, just log.
      // User-facing error for this might be too much.
      console.error('[MemoryManager.cleanupVideoBuffers] Error:', error);
    }
  }

  async cleanupCache() {
    console.log('[MemoryManager] Requesting cache cleanup...');
    try {
      if (window.cacheManager && typeof window.cacheManager.cleanupOldCache === 'function') {
        // The original VideoCache had cleanupOldCache, memory manager spec had cleanupOldEntries.
        // Assuming window.cacheManager is an instance of our VideoCache.
        await window.cacheManager.cleanupOldCache();
        console.log('[MemoryManager] Cache cleanup requested from cacheManager.');
      } else {
        console.warn('[MemoryManager] window.cacheManager or its cleanupOldCache method not found.');
      }
    } catch (error) {
      // ErrorHandler might be too intrusive for a background cache cleanup failure.
      console.error('[MemoryManager.cleanupCache] Error during cache cleanup:', error);
    }
  }

  cleanupDOM() {
    console.log('[MemoryManager] Cleaning up unused DOM elements...');
    try {
      // Example: remove elements marked with a specific class that are no longer needed.
      // This is highly application-specific.
      const unusedElements = document.querySelectorAll('.tizentube-unused-element, .unused-by-memory-manager');
      let cleanedCount = 0;
      unusedElements.forEach(el => {
        if (el.parentNode) { // Check if still in DOM
            el.remove();
            cleanedCount++;
        }
      });
      if (cleanedCount > 0) {
        console.log(`[MemoryManager] Removed ${cleanedCount} unused DOM elements.`);
      } else {
        console.log('[MemoryManager] No unused DOM elements found with specified selectors.');
      }
    } catch (error) {
      console.error('[MemoryManager.cleanupDOM] Error:', error);
    }
  }

  // Call this when the MemoryManager instance is no longer needed.
  destroy() {
    this.stopMonitoring();
    console.log('[MemoryManager] Destroyed.');
  }
}

export { MemoryManager };
