// auto-quality.js
import { ErrorHandler } from './error-handler.js';
import { fetchWithRetry } from './api-utils.js';
// NetworkMonitor was created in a previous step. Assuming it's available for import.
import { NetworkMonitor } from './network-monitor.js';

class AutoQualityController {
  constructor(videoElement) {
    if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
      const error = new Error('AutoQualityController requires a valid HTMLVideoElement.');
      console.error('[AutoQualityController.constructor]', error.message);
      throw error;
    }
    this.video = videoElement;

    try {
        this.networkMonitor = new NetworkMonitor(); // Instantiate NetworkMonitor
        this.networkMonitor.startMonitoring(); // Start its monitoring process
    } catch (error) {
        ErrorHandler.handle(error, 'AutoQualityController.constructor', 'Không thể khởi tạo NetworkMonitor.');
        // If NetworkMonitor is critical, might rethrow or disable auto quality.
        // For now, allow continuation but auto quality might not work.
        this.networkMonitor = null;
    }

    // Quality levels and their corresponding (example) bitrate in Kbps
    this.qualityLevels = ['144p', '240p', '360p', '480p', '720p', '1080p', '1440p', '2160p'];
    this.qualityBitrates = { // Example bitrates in Kbps
      '144p': 300,
      '240p': 500,
      '360p': 800,
      '480p': 1200,
      '720p': 2500,
      '1080p': 5000,
      '1440p': 10000,
      '2160p': 20000
    };
    this.currentQuality = '720p'; // Default or could be read from settings/initial detection
    this.bufferHealthThresholdSeconds = 15; // Minimum buffer needed to consider increasing quality (original was 30)
    this.isSwitchingQuality = false; // Flag to prevent concurrent quality switches

    this._boundHandleBuffering = this.handleBuffering.bind(this);
    this._boundHandleBufferRecovery = this.handleBufferRecovery.bind(this);
    this._boundHandleSpeedChange = this.handleSpeedChange.bind(this);
    // The original spec mentioned this.networkMonitor.on('qualityChange', ...)
    // but NetworkMonitor emits 'speedChange'. 'qualityChange' might be an internal event or a typo.
    // We will adapt based on network speed.

    this.setupEventListeners();
    // Set initial quality based on current conditions if desired
    // this.adaptQuality(); // Potentially call adaptQuality on init
    console.log('[AutoQualityController] Initialized.');
  }

  setupEventListeners() {
    if (!this.video) return;
    this.video.addEventListener('waiting', this._boundHandleBuffering); // Player is waiting for more data
    this.video.addEventListener('canplay', this._boundHandleBufferRecovery); // Enough data buffered to play, or after seek/stall

    if (this.networkMonitor) {
      this.networkMonitor.on('speedChange', this._boundHandleSpeedChange);
    }
    console.log('[AutoQualityController] Event listeners setup.');
  }

  handleBuffering() {
    if (this.isSwitchingQuality) return;
    console.log('[AutoQualityController] Video is buffering (waiting event).');
    try {
      const bufferHealth = this.calculateBufferHealth();
      // If buffer is low (e.g., less than a few seconds beyond current time), decrease quality.
      // Using a threshold significantly smaller than bufferHealthThresholdSeconds for decreasing.
      if (bufferHealth < 5) { // e.g. 5 seconds
        console.log(`[AutoQualityController] Low buffer health (${bufferHealth}s) during buffering. Decreasing quality.`);
        this.decreaseQuality();
      }
    } catch (error) {
      ErrorHandler.handle(error, 'AutoQualityController.handleBuffering', 'Lỗi xử lý sự kiện buffering.');
    }
  }

  handleBufferRecovery() {
    if (this.isSwitchingQuality) return;
    console.log('[AutoQualityController] Video buffer recovered (canplay event). Adapting quality.');
    // After buffer recovers, attempt to adapt quality upwards if conditions allow.
    this.adaptQuality();
  }

  handleSpeedChange(newSpeedMbps) {
    if (this.isSwitchingQuality) return;
    console.log(`[AutoQualityController] Network speed changed: ${newSpeedMbps.toFixed(2)} Mbps. Adapting quality.`);
    this.adaptQuality();
  }

  calculateBufferHealth() { // Returns buffer ahead of current time in seconds
    if (!this.video || !this.video.buffered || this.video.buffered.length === 0) {
      return 0;
    }
    try {
      const currentTime = this.video.currentTime;
      let maxBufferedEnd = 0;
      for (let i = 0; i < this.video.buffered.length; i++) {
          // Find the buffered range that contains or is ahead of the current time
          if (this.video.buffered.start(i) <= currentTime && this.video.buffered.end(i) > currentTime) {
              maxBufferedEnd = Math.max(maxBufferedEnd, this.video.buffered.end(i));
          } else if (this.video.buffered.start(i) > currentTime) { // Consider future buffers too
              maxBufferedEnd = Math.max(maxBufferedEnd, this.video.buffered.end(i));
          }
      }
      return maxBufferedEnd > currentTime ? (maxBufferedEnd - currentTime) : 0;
    } catch (error) {
      ErrorHandler.handle(error, 'AutoQualityController.calculateBufferHealth', 'Lỗi tính toán sức khoẻ buffer.');
      return 0; // Return 0 on error
    }
  }

  async adaptQuality() {
    if (this.isSwitchingQuality || !this.networkMonitor) {
      console.log('[AutoQualityController] Adapt quality skipped (switching or no network monitor).');
      return;
    }
    console.log('[AutoQualityController] Adapting quality...');
    this.isSwitchingQuality = true;

    try {
      const networkSpeedMbps = this.networkMonitor.getCurrentSpeed(); // Speed in Mbps
      const deviceCapabilities = this.getDeviceCapabilities();
      const bufferHealth = this.calculateBufferHealth();

      const optimalQuality = this.calculateOptimalQuality(networkSpeedMbps, deviceCapabilities, bufferHealth);

      if (optimalQuality !== this.currentQuality) {
        console.log(`[AutoQualityController] Optimal quality is ${optimalQuality}, current is ${this.currentQuality}. Switching.`);
        await this.switchQuality(optimalQuality);
      } else {
        console.log(`[AutoQualityController] Current quality ${this.currentQuality} is already optimal.`);
      }
       if (window.stateManager) {
         window.stateManager.setState('currentQuality', this.currentQuality);
       }

    } catch (error) {
      ErrorHandler.handle(error, 'AutoQualityController.adaptQuality', 'Lỗi tự động điều chỉnh chất lượng.');
    } finally {
      this.isSwitchingQuality = false;
    }
  }

  calculateOptimalQuality(speedMbps, capabilities, bufferHealth) {
    const networkSpeedKbps = speedMbps * 1000;
    const safeSpeedKbps = networkSpeedKbps * 0.8; // Use 80% of available bandwidth

    let bestQuality = this.qualityLevels[0]; // Default to lowest

    // Iterate from highest to lowest quality
    for (let i = this.qualityLevels.length - 1; i >= 0; i--) {
      const quality = this.qualityLevels[i];
      const requiredBitrateKbps = this.qualityBitrates[quality];
      const resolutionHeight = this.getResolutionHeight(quality);

      if (requiredBitrateKbps <= safeSpeedKbps && capabilities.maxScreenResolutionHeight >= resolutionHeight) {
        bestQuality = quality;
        break; // Found the best possible quality for current conditions
      }
    }

    // Consider buffer health for up-switching
    const currentQualityIndex = this.qualityLevels.indexOf(this.currentQuality);
    const bestQualityIndex = this.qualityLevels.indexOf(bestQuality);

    if (bestQualityIndex > currentQualityIndex) { // Attempting to switch up
        if (bufferHealth < this.bufferHealthThresholdSeconds) {
            console.log(`[AutoQualityController] Optimal quality is ${bestQuality}, but buffer health (${bufferHealth}s) is below threshold (${this.bufferHealthThresholdSeconds}s). Staying at ${this.currentQuality}.`);
            return this.currentQuality; // Not enough buffer to risk up-switching yet
        }
    }

    console.log(`[AutoQualityController.calculateOptimalQuality] Speed: ${speedMbps.toFixed(2)}Mbps, DeviceRes: ${capabilities.maxScreenResolutionHeight}p, Buffer: ${bufferHealth.toFixed(1)}s -> Optimal: ${bestQuality}`);
    return bestQuality;
  }

  async switchQuality(newQuality) {
    if (!this.video || !this.qualityLevels.includes(newQuality)) {
      console.warn(`[AutoQualityController] Invalid quality or video element for switchQuality: ${newQuality}`);
      return;
    }
    console.log(`[AutoQualityController] Switching quality from ${this.currentQuality} to ${newQuality}`);

    const currentTime = this.video.currentTime;
    const wasPaused = this.video.paused;

    try {
      const sourceUrl = await this.getVideoSource(newQuality);
      if (!sourceUrl) {
        throw new Error(`No source URL found for quality ${newQuality}.`);
      }

      this.video.src = sourceUrl;

      const onLoadedMetadata = () => {
        this.video.currentTime = currentTime;
        if (!wasPaused) {
          this.video.play().catch(e => ErrorHandler.handle(e, 'AutoQualityController.switchQuality.play', 'Lỗi phát video sau khi đổi chất lượng.'));
        }
        this.video.removeEventListener('loadedmetadata', onLoadedMetadata);
        console.log(`[AutoQualityController] Successfully switched to ${newQuality}.`);
        this.currentQuality = newQuality; // Update currentQuality only on success
      };
      this.video.addEventListener('loadedmetadata', onLoadedMetadata);
      this.video.load(); // Important to load the new source

    } catch (error) {
      ErrorHandler.handle(error, 'AutoQualityController.switchQuality', `Không thể chuyển sang chất lượng ${newQuality}.`);
      // On failure, isSwitchingQuality will be reset by adaptQuality's finally block.
      // Consider reverting to previous source if possible, or re-adapting.
    }
  }

  async getVideoSource(quality) {
    // User spec: uses fetchWithRetry to an API endpoint
    console.log(`[AutoQualityController] Fetching video source for quality: ${quality}`);
    try {
      // Assuming the API returns an object like { url: "video_source_url" }
      const response = await fetchWithRetry(`https://api.tizentube.com/v1/videos/source/${quality}`, {
        headers: { 'Authorization': `Bearer ${localStorage.getItem('tizentube_token') || ''}` }
      });
      if (response && response.url) {
        return response.url;
      }
      throw new Error(`Invalid or missing URL in API response for quality ${quality}.`);
    } catch (error) {
      // fetchWithRetry calls ErrorHandler.handle
      console.error(`[AutoQualityController.getVideoSource] Failed to get source for ${quality}: ${error.message}`);
      throw error; // Re-throw for switchQuality to handle
    }
  }

  getDeviceCapabilities() {
    try {
      return {
        // Max screen height is a proxy, actual decoding capability might differ.
        maxScreenResolutionHeight: Math.max(window.screen?.height || 720, window.screen?.width || 1280) * (window.devicePixelRatio || 1)
        // Could add more checks: HDR support, specific codec support via MediaCapabilities API if needed.
      };
    } catch (error) {
      console.warn('[AutoQualityController.getDeviceCapabilities] Error detecting device capabilities:', error.message);
      return { maxScreenResolutionHeight: 720 }; // Fallback
    }
  }

  getResolutionHeight(qualityString) { // e.g., "720p" -> 720
    try {
      return parseInt(qualityString, 10) || 144; // Default to 144p if parsing fails
    } catch {
      return 144;
    }
  }

  decreaseQuality() {
    if (this.isSwitchingQuality) return;
    const currentIndex = this.qualityLevels.indexOf(this.currentQuality);
    if (currentIndex > 0) {
      const newQuality = this.qualityLevels[currentIndex - 1];
      console.log(`[AutoQualityController] Decreasing quality to ${newQuality} due to poor conditions.`);
      this.isSwitchingQuality = true; // Set flag before async operation
      this.switchQuality(newQuality).finally(() => {
          this.isSwitchingQuality = false;
      });
    } else {
      console.log('[AutoQualityController] Already at lowest quality, cannot decrease further.');
    }
  }

  destroy() {
    if (this.video) {
      this.video.removeEventListener('waiting', this._boundHandleBuffering);
      this.video.removeEventListener('canplay', this._boundHandleBufferRecovery);
    }
    if (this.networkMonitor) {
      // Assuming NetworkMonitor has a way to remove specific listeners or a destroy method
      // For now, if NetworkMonitor is shared, we might not want to stop it here.
      // If it's instantiated per AutoQualityController, then stop it.
      this.networkMonitor.stopMonitoring(); // Or a more specific removeListener
      this.networkMonitor = null;
    }
    console.log('[AutoQualityController] Destroyed.');
  }
}

export { AutoQualityController };
