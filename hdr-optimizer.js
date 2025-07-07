// hdr-optimizer.js
import { ErrorHandler } from './error-handler.js';
import { fetchWithRetry } from './api-utils.js'; // Needed for testNetworkSpeed

class HDROptimizer {
  constructor() {
    this.capabilities = null; // Initialize as null, detect on demand or in an async init method
    this.adaptiveSettings = new Map(); // To store settings per video or content ID if needed
    this.gl = null; // Cached WebGL context

    // Detect capabilities upon instantiation or provide an async init method
    try {
        this.capabilities = this.detectCapabilities();
    } catch (error) {
        ErrorHandler.handle(error, 'HDROptimizer.constructor', 'Không thể xác định khả năng HDR của thiết bị.');
        // Fallback capabilities if detection fails
        this.capabilities = {
            hdr10: '', // Empty string indicates 'maybe' or untested
            hdr10Plus: '',
            dolbyVision: '',
            maxResolution: 1080, // Default to 1080p
            colorGamut: 'srgb', // Default to srgb
            isDetectionComplete: false,
        };
    }
    console.log('[HDROptimizer] Initialized. Capabilities:', this.capabilities);
  }

  detectCapabilities() {
    console.log('[HDROptimizer] Detecting device HDR capabilities...');
    let video;
    try {
      video = document.createElement('video');
    } catch (error) {
      // This can happen in environments without a DOM (e.g. Node.js tests if not careful)
      console.error("[HDROptimizer.detectCapabilities] Failed to create video element.", error);
      throw new Error("Failed to create video element for capability detection.");
    }

    // Note: canPlayType results ('probably', 'maybe', '') are not definitive for HDR formats.
    // More robust detection often involves specific platform APIs or testing with actual content.
    // These are basic checks.
    const caps = {
      hdr10: video.canPlayType('video/mp4; codecs="hev1.2.4.L153.B0"'), // Example for HEVC HDR10
      hdr10Plus: video.canPlayType('video/mp4; codecs="hvp1.2.4.L153.B0"'), // Placeholder for HDR10+
      dolbyVision: video.canPlayType('video/mp4; codecs="dvh1.08.07"'), // Example for Dolby Vision Profile 8.4
      maxResolution: this.getMaxResolution(),
      colorGamut: this.getColorGamut(),
      isDetectionComplete: true,
    };
    console.log('[HDROptimizer] Detected capabilities:', caps);
    return caps;
  }

  /**
   * Optimizes video playback settings based on content metadata and device capabilities.
   * @param {HTMLVideoElement} videoElement - The video element to optimize.
   * @param {object} metadata - Metadata about the video content.
   *                           Expected: { hdr: boolean, maxResolution: number, availableBitrates: number[] }
   */
  async optimizeForContent(videoElement, metadata) {
    if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
      ErrorHandler.handle(new Error('Invalid videoElement for optimizeForContent'), 'HDROptimizer.optimizeForContent', 'Video element không hợp lệ.');
      return;
    }
    if (!metadata || typeof metadata.maxResolution !== 'number' || !Array.isArray(metadata.availableBitrates)) {
      ErrorHandler.handle(new Error('Invalid metadata for optimizeForContent'), 'HDROptimizer.optimizeForContent', 'Metadata video không hợp lệ.');
      return;
    }
    if (!this.capabilities || !this.capabilities.isDetectionComplete) {
        ErrorHandler.handle(new Error('Device capabilities not yet detected.'), 'HDROptimizer.optimizeForContent', 'Chưa xác định được khả năng của thiết bị.');
        return;
    }

    console.log('[HDROptimizer] Optimizing for content:', metadata);
    try {
      const optimalSettings = await this.calculateOptimalSettings(metadata);
      console.log('[HDROptimizer] Calculated optimal settings:', optimalSettings);

      // Tone mapping if HDR content on non-HDR capable display (simplified check)
      // A more accurate check would be if the specific HDR format (e.g. HDR10) is supported.
      const deviceSupportsContentHDR = (metadata.hdrFormat === 'hdr10' && this.capabilities.hdr10) ||
                                     (metadata.hdrFormat === 'hdr10plus' && this.capabilities.hdr10Plus) ||
                                     (metadata.hdrFormat === 'dolbyvision' && this.capabilities.dolbyVision);

      if (metadata.hdr && !deviceSupportsContentHDR && !this.capabilities.hdr10 && !this.capabilities.dolbyVision) { // Simplified: if content is HDR and device doesn't broadly support common HDR
        console.log('[HDROptimizer] HDR content on non-HDR display. Applying tone mapping (placeholder).');
        this.applyToneMapping(videoElement, optimalSettings);
      }

      this.optimizeResolution(videoElement, optimalSettings, metadata);
      this.applyColorSpaceConversion(videoElement, optimalSettings); // Placeholder

    } catch (error) {
      ErrorHandler.handle(error, 'HDROptimizer.optimizeForContent', 'Lỗi tối ưu hóa nội dung HDR/4K.');
    }
  }

  applyToneMapping(videoElement, settings) {
    // Placeholder for actual tone mapping via WebGL shaders or other methods.
    console.log('[HDROptimizer] Applying tone mapping (simulated). Settings:', settings);
    // Example: this.applyShader(videoElement, toneMappingShader, settings);
    // For now, we just log. The original code had a shader string but no implementation.
  }

  applyShader(videoElement, shaderSource, settings) {
    // Placeholder for WebGL shader application.
    if (!this.gl) {
      try {
        const canvas = document.createElement('canvas');
        this.gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      } catch (error) {
        ErrorHandler.handle(error, 'HDROptimizer.applyShader', 'Không thể khởi tạo WebGL context.');
        return;
      }
    }

    if (!this.gl) {
      console.warn('[HDROptimizer.applyShader] WebGL not supported, cannot apply shader.');
      return;
    }
    console.log('[HDROptimizer] Applying shader (simulated). Shader:', shaderSource, 'Settings:', settings);
    // Full WebGL setup (program, buffers, textures, drawing) is complex and omitted here.
    // const program = this.gl.createProgram();
    // ... (compile shaders, link program, set up geometry, texture from video, uniforms from settings)
    // this.gl.drawArrays(...);
  }

  optimizeResolution(videoElement, optimalSettings, contentMetadata) {
    console.log('[HDROptimizer] Optimizing resolution. Optimal:', optimalSettings.resolution);
    try {
      // This assumes getOptimalSource returns a URL for the given resolution.
      const sourceUrl = this.getOptimalSource(optimalSettings, contentMetadata);

      if (sourceUrl && videoElement.src !== sourceUrl) {
        console.log(`[HDROptimizer] Changing video source to: ${sourceUrl}`);
        const currentTime = videoElement.currentTime;
        const wasPaused = videoElement.paused;

        videoElement.src = sourceUrl;
        // Set currentTime after metadata loaded, or on 'loadedmetadata' or 'canplay'
        const onLoadedMetadata = () => {
            videoElement.currentTime = currentTime;
            if (!wasPaused) {
                videoElement.play().catch(e => ErrorHandler.handle(e, 'HDROptimizer.optimizeResolution.play', 'Lỗi phát video sau khi đổi nguồn.'));
            }
            videoElement.removeEventListener('loadedmetadata', onLoadedMetadata);
        };
        videoElement.addEventListener('loadedmetadata', onLoadedMetadata);
        videoElement.load(); // Important to load the new source
      } else if (!sourceUrl) {
        console.warn('[HDROptimizer] Could not determine optimal source for resolution.', optimalSettings.resolution);
      }
    } catch (error) {
      ErrorHandler.handle(error, 'HDROptimizer.optimizeResolution', 'Lỗi tối ưu hóa độ phân giải.');
    }
  }

  getOptimalSource(optimalSettings, contentMetadata) {
    // Placeholder: Implement actual source fetching logic based on resolution.
    // This might involve looking up a manifest or constructing a URL.
    // The original spec just returned a template string.
    // We need contentMetadata to know available sources.
    if (!contentMetadata || !contentMetadata.sourcesByResolution) {
        // Example: contentMetadata.sourcesByResolution = { 720: "url1.mp4", 1080: "url2.mp4" }
        console.warn('[HDROptimizer.getOptimalSource] sourcesByResolution not in contentMetadata.');
        return `/videos/source_${optimalSettings.resolution}p.mp4`; // Fallback to original pattern
    }
    return contentMetadata.sourcesByResolution[optimalSettings.resolution] || `/videos/source_${optimalSettings.resolution}p.mp4`;
  }


  applyColorSpaceConversion(videoElement, settings) {
    // Placeholder for color space conversion logic.
    console.log('[HDROptimizer] Applying color space conversion (simulated). Settings:', settings);
  }

  getMaxResolution() {
    try {
      // Use screen.height as a proxy. More accurate checks might involve platform APIs.
      return Math.max(window.screen?.height || 1080, window.screen?.width || 1920) * (window.devicePixelRatio || 1);
    } catch (error) {
      console.warn('[HDROptimizer.getMaxResolution] Error detecting max resolution:', error.message);
      return 1080; // Default fallback
    }
  }

  getColorGamut() {
    try {
      if (window.matchMedia && window.matchMedia('(color-gamut: p3)').matches) {
        return 'p3';
      }
      if (window.matchMedia && window.matchMedia('(color-gamut: rec2020)').matches) {
        return 'rec2020';
      }
    } catch (error) {
      console.warn('[HDROptimizer.getColorGamut] Error detecting color gamut:', error.message);
    }
    return 'srgb'; // Default fallback
  }

  async calculateOptimalSettings(metadata) {
    // metadata: { maxResolution (content), availableBitrates: number[], sourcesByResolution: {720: url, ...} }
    let optimalResolution = metadata.maxResolution; // Start with content's max
    if (this.capabilities.maxResolution < metadata.maxResolution) {
      // Find the highest resolution supported by device that's available for the content
      const deviceMaxRes = this.capabilities.maxResolution;
      const availableResolutions = Object.keys(metadata.sourcesByResolution || {}).map(Number).sort((a,b) => b-a);
      optimalResolution = availableResolutions.find(res => res <= deviceMaxRes) || availableResolutions[availableResolutions.length -1] || 720;
    }


    let optimalBitrate;
    try {
        optimalBitrate = await this.calculateOptimalBitrate(metadata);
    } catch (error) {
        ErrorHandler.handle(error, 'HDROptimizer.calculateOptimalSettings', 'Lỗi tính toán bitrate tối ưu.');
        optimalBitrate = metadata.availableBitrates[0]; // Fallback to lowest
    }

    return {
      resolution: Math.min(optimalResolution, this.capabilities.maxResolution),
      colorSpace: this.capabilities.colorGamut, // Simplified, actual choice depends on content and display
      bitrate: optimalBitrate,
      // For applyShader:
      exposure: metadata.exposure || 1.0,
      gamma: metadata.gamma || 2.2,
    };
  }

  async calculateOptimalBitrate(metadata) {
    // metadata.availableBitrates should be sorted (e.g. ascending) by convention for this logic
    if (!metadata.availableBitrates || metadata.availableBitrates.length === 0) {
        throw new Error("No available bitrates in metadata.");
    }

    let availableBandwidthMbps;
    try {
        availableBandwidthMbps = await this.getAvailableBandwidth(); // This is in Mbps
    } catch (error) {
        ErrorHandler.handle(error, 'HDROptimizer.calculateOptimalBitrate', 'Không thể lấy băng thông hiện tại.');
        // Fallback to a safe default bandwidth if detection fails
        availableBandwidthMbps = 5; // 5 Mbps default
    }

    const availableBandwidthKbps = availableBandwidthMbps * 1000;

    // Find the highest bitrate that is less than or equal to 80% of available bandwidth
    const safeBandwidthKbps = availableBandwidthKbps * 0.8;
    let chosenBitrate = metadata.availableBitrates[0]; // Default to lowest

    // Assuming availableBitrates are in Kbps and sorted ascending
    for (let i = metadata.availableBitrates.length - 1; i >= 0; i--) {
      if (metadata.availableBitrates[i] <= safeBandwidthKbps) {
        chosenBitrate = metadata.availableBitrates[i];
        break;
      }
    }
    return chosenBitrate;
  }

  async getAvailableBandwidth() { // Returns Mbps
    // Use NetworkMonitor's testSpeed logic, adapted
    if (navigator.connection && navigator.connection.downlink) {
        // downlink is in Mbps.
        // This is often a good starting point but can be inaccurate or not frequently updated.
        const estimatedSpeed = navigator.connection.downlink;
        // console.log(`[HDROptimizer] Bandwidth from navigator.connection: ${estimatedSpeed} Mbps`);
        // Optionally combine with active test:
        // const activeTestSpeed = await this.testNetworkSpeed();
        // return Math.min(estimatedSpeed, activeTestSpeed); // Be conservative
        return estimatedSpeed;
    }
    // Fallback to active test if navigator.connection.downlink is not available
    return await this.testNetworkSpeed();
  }

  async testNetworkSpeed() { // Returns Mbps
    const startTime = performance.now();
    const testFileSizeKB = 100; // Small file for quick test, 100KB
    try {
      // Using fetchWithRetry for robustness
      // Note: fetchWithRetry expects JSON. If /test is not JSON, this needs adjustment
      // or use raw fetch for this specific non-JSON endpoint.
      // For now, assuming /test is a dummy endpoint and we are timing the request itself.
      // The original spec for NetworkMonitor used fetch, let's stick to that here for simplicity
      // unless fetchWithRetry is adapted for non-JSON or HEAD.
      await fetch('https://api.tizentube.com/test', { method: 'HEAD', cache: 'no-store' });
      const durationMs = performance.now() - startTime;
      if (durationMs <= 0) return 5; // Default on bad timing

      const sizeInBits = testFileSizeKB * 1024 * 8;
      const durationInSeconds = durationMs / 1000;
      let speedMbps = (sizeInBits / durationInSeconds) / 1000000;
      speedMbps = Math.min(Math.max(speedMbps, 0.1), 1000); // Cap between 0.1 Mbps and 1 Gbps
      // console.log(`[HDROptimizer] Active speed test result: ${speedMbps.toFixed(2)} Mbps`);
      return speedMbps;
    } catch (error) {
      // ErrorHandler.handle(error, 'HDROptimizer.testNetworkSpeed', 'Lỗi kiểm tra tốc độ mạng.'); // fetchWithRetry would do this
      console.warn('[HDROptimizer.testNetworkSpeed] Active speed test failed, using default 5Mbps.', error.message);
      return 5; // Default on error
    }
  }

  destroy() {
    // Cleanup WebGL context if created
    if (this.gl) {
        const loseContextExt = this.gl.getExtension('WEBGL_lose_context');
        if (loseContextExt) {
            loseContextExt.loseContext();
        }
        this.gl = null;
    }
    this.capabilities = null;
    this.adaptiveSettings.clear();
    console.log('[HDROptimizer] Destroyed.');
  }
}

export { HDROptimizer };
