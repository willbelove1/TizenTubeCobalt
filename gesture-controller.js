// gesture-controller.js
import { ErrorHandler } from './error-handler.js';
// Assuming HammerJS is installed and can be imported.
// In a real project: npm install hammerjs --save; then webpack/other bundler handles it.
import Hammer from 'hammerjs';

class GestureController {
  constructor(videoContainer) {
    if (!videoContainer || !(videoContainer instanceof HTMLElement)) {
      const error = new Error('GestureController requires a valid HTMLElement for the video container.');
      console.error('[GestureController.constructor]', error.message);
      throw error; // Critical setup error
    }
    this.container = videoContainer;
    this.video = videoContainer.querySelector('video');

    if (!this.video) {
      const error = new Error('GestureController: No <video> element found within the provided container.');
      console.error('[GestureController.constructor]', error.message);
      // Not throwing here, as ErrorHandler can inform the user, and the app might still partially function.
      ErrorHandler.handle(error, 'GestureController.constructor', 'Không tìm thấy trình phát video để điều khiển bằng cử chỉ.');
      return; // Stop further setup if no video element
    }

    this.hammer = null;
    this.initialScale = 1;
    this.setupGestures();
    console.log('[GestureController] Initialized.');
  }

  setupGestures() {
    if (!this.video) return; // Don't setup if video element wasn't found

    try {
      this.hammer = new Hammer(this.container);

      // Swipe for seeking
      this.hammer.get('swipe').set({ direction: Hammer.DIRECTION_HORIZONTAL });
      this.hammer.on('swipeleft', () => this.seek(-10)); // Seek back 10s
      this.hammer.on('swiperight', () => this.seek(10)); // Seek forward 10s

      // Pinch for zooming
      this.hammer.get('pinch').set({ enable: true });
      this.hammer.on('pinchstart', (e) => this.startZoom(e));
      this.hammer.on('pinchmove', (e) => this.updateZoom(e));
      // No 'pinchend' needed explicitly unless we want to finalize scale or something.

      // Double tap for skip
      this.hammer.get('tap').set({ taps: 2 });
      this.hammer.on('doubletap', (e) => this.handleDoubleTap(e));

      console.log('[GestureController] Gestures setup complete.');

    } catch (error) {
      ErrorHandler.handle(error, 'GestureController.setupGestures', 'Không thể cài đặt điều khiển bằng cử chỉ.');
      if (this.hammer) {
        this.hammer.destroy(); // Clean up Hammer instance if partially created
        this.hammer = null;
      }
    }
  }

  seek(seconds) {
    if (!this.video || typeof this.video.currentTime !== 'number') return;
    try {
      const newTime = this.video.currentTime + seconds;
      this.video.currentTime = Math.max(0, Math.min(newTime, this.video.duration || Infinity));
      this.showSeekFeedback(seconds);
      console.log(`[GestureController] Seeked by ${seconds}s. New time: ${this.video.currentTime}`);
    } catch (error) {
      ErrorHandler.handle(error, 'GestureController.seek', 'Lỗi khi tua video.');
    }
  }

  startZoom(event) {
    if (!this.video) return;
    try {
      // Get current scale from transform property, default to 1
      const currentTransform = this.video.style.transform;
      if (currentTransform && currentTransform.includes('scale')) {
        const match = currentTransform.match(/scale\(([^)]+)\)/);
        this.initialScale = match ? parseFloat(match[1]) : 1;
      } else {
        this.initialScale = 1;
      }
      console.log(`[GestureController] Pinch zoom started. Initial scale: ${this.initialScale}`);
    } catch (error) {
      ErrorHandler.handle(error, 'GestureController.startZoom', 'Lỗi khi bắt đầu phóng to/thu nhỏ.');
      this.initialScale = 1; // Reset on error
    }
  }

  updateZoom(event) {
    if (!this.video) return;
    try {
      // Calculate new scale, clamped between 1x and 3x
      const targetScale = this.initialScale * event.scale;
      const newScale = Math.max(1, Math.min(targetScale, 3));

      this.video.style.transform = `scale(${newScale})`;
      // console.log(`[GestureController] Pinch zoom update. New scale: ${newScale}`);
    } catch (error) {
      ErrorHandler.handle(error, 'GestureController.updateZoom', 'Lỗi khi cập nhật phóng to/thu nhỏ.');
    }
  }

  handleDoubleTap(event) {
    if (!this.video || !this.container) return;
    try {
      const rect = this.container.getBoundingClientRect();
      // event.center.x is relative to the viewport, so adjust by rect.left
      const tapXInContainer = event.center.x - rect.left;

      // Determine skip direction based on tap position relative to container width
      const skipAmount = tapXInContainer > rect.width / 2 ? 10 : -10; // Skip 10s forward/backward
      this.seek(skipAmount);
      console.log(`[GestureController] Double tap processed. Skip amount: ${skipAmount}s`);
    } catch (error) {
      ErrorHandler.handle(error, 'GestureController.handleDoubleTap', 'Lỗi xử lý chạm hai lần.');
    }
  }

  showSeekFeedback(seconds) {
    if (!this.container) return;
    try {
      // Remove existing feedback if any
      const existingFeedback = this.container.querySelector('.seek-feedback');
      if (existingFeedback) {
        existingFeedback.remove();
      }

      const feedback = document.createElement('div');
      feedback.textContent = `${seconds > 0 ? '+' : ''}${seconds}s`;
      feedback.className = 'seek-feedback'; // Ensure this class is styled in styles.css

      // Basic styling for visibility, should be primarily handled by CSS
      feedback.style.position = 'absolute';
      feedback.style.top = '50%';
      feedback.style.left = '50%';
      feedback.style.transform = 'translate(-50%, -50%)';
      feedback.style.padding = '8px 16px';
      feedback.style.background = 'rgba(0, 0, 0, 0.75)';
      feedback.style.color = 'white';
      feedback.style.borderRadius = '4px';
      feedback.style.zIndex = '100'; // Above video, below other UI
      feedback.style.pointerEvents = 'none'; // Don't intercept pointer events

      this.container.appendChild(feedback);

      setTimeout(() => {
        if (feedback.parentNode) { // Check if still in DOM
          feedback.remove();
        }
      }, 1000); // Remove after 1 second
    } catch (error) {
      // Don't use ErrorHandler for UI feedback failure, just log it.
      console.error('[GestureController.showSeekFeedback] Error displaying seek feedback:', error);
    }
  }

  // Call this to clean up when the controller is no longer needed
  destroy() {
    if (this.hammer) {
      try {
        this.hammer.destroy();
        console.log('[GestureController] Hammer instance destroyed.');
      } catch (error) {
        // Don't use ErrorHandler for destroy failures, just log.
        console.error('[GestureController.destroy] Error destroying Hammer instance:', error);
      }
      this.hammer = null;
    }
    // Remove any lingering seek feedback if necessary, though setTimeout should handle it.
    const existingFeedback = this.container?.querySelector('.seek-feedback');
    if (existingFeedback) {
      existingFeedback.remove();
    }
    console.log('[GestureController] Destroyed.');
  }
}

export { GestureController };
