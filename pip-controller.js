// pip-controller.js
import { ErrorHandler } from './error-handler.js';

class PIPController {
  constructor(videoElement) {
    if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
      const error = new Error('PIPController requires a valid HTMLVideoElement.');
      // This is a programming error, direct console error is fine, ErrorHandler might be too much for instantiation.
      console.error('[PIPController.constructor]', error.message);
      throw error;
    }
    this.video = videoElement;
    this.pipWindow = null;
    this.isSupported = 'pictureInPictureEnabled' in document && document.pictureInPictureEnabled;

    // Event listeners for PiP state changes
    this._onEnterPIP = this._onEnterPIP.bind(this);
    this._onLeavePIP = this._onLeavePIP.bind(this);

    if (this.isSupported) {
      this.video.addEventListener('enterpictureinpicture', this._onEnterPIP);
      this.video.addEventListener('leavepictureinpicture', this._onLeavePIP);
    } else {
      console.warn('[PIPController] Picture-in-Picture API is not supported or not enabled in this browser.');
    }
    console.log('[PIPController] Initialized.');
  }

  async enterPIP() {
    if (!this.isSupported) {
      ErrorHandler.handle(new Error('PiP not supported'), 'PIPController.enterPIP', 'Chế độ Hình trong hình không được hỗ trợ.');
      return false;
    }
    if (document.pictureInPictureElement) {
      // Already in PiP with another element or this one
      if (document.pictureInPictureElement === this.video) {
        console.log('[PIPController] Video is already in Picture-in-Picture mode.');
        return true;
      } else {
        ErrorHandler.handle(new Error('Another element is already in PiP'), 'PIPController.enterPIP', 'Một video khác đang ở chế độ Hình trong hình.');
        return false;
      }
    }

    try {
      console.log('[PIPController] Requesting Picture-in-Picture...');
      // The requestPictureInPicture method returns a Promise that resolves with a PictureInPictureWindow
      this.pipWindow = await this.video.requestPictureInPicture();
      console.log('[PIPController] Entered Picture-in-Picture mode successfully.');
      // setupPIPControls is called via the 'enterpictureinpicture' event listener (_onEnterPIP)
      return true;
    } catch (error) {
      ErrorHandler.handle(error, 'PIPController.enterPIP', 'Không thể vào chế độ Hình trong hình.');
      this.pipWindow = null; // Ensure pipWindow is reset on failure
      return false;
    }
  }

  _onEnterPIP(event) {
    // The event target for 'enterpictureinpicture' on the video element is the video element itself.
    // The pipWindow is accessible via event.pictureInPictureWindow.
    this.pipWindow = event.pictureInPictureWindow;
    console.log('[PIPController] Video element entered Picture-in-Picture mode.', this.pipWindow);
    this.setupPIPControls();

    if (this.pipWindow) {
        // Optional: Add listeners to the PiP window itself if needed (e.g., resize)
        // this.pipWindow.addEventListener('resize', () => {
        //   console.log('[PIPController] PiP window resized.');
        // });
    }
  }

  _onLeavePIP() {
    console.log('[PIPController] Video element left Picture-in-Picture mode.');
    this.pipWindow = null;
    // Media session action handlers are typically global, but if they were specific to PiP state,
    // they could be cleared here. For now, we assume they remain or are managed elsewhere if needed.
    // this.clearPIPControls(); // Example if cleanup was needed
  }

  setupPIPControls() {
    if (!('mediaSession' in navigator)) {
      console.warn('[PIPController.setupPIPControls] MediaSession API not available.');
      return;
    }
    console.log('[PIPController] Setting up PiP media session controls.');
    try {
      navigator.mediaSession.setActionHandler('play', () => {
        console.log('[PIPController] PiP Play action triggered.');
        this.video.play().catch(e => ErrorHandler.handle(e, 'PIPController.mediaSession.play', 'Lỗi khi phát từ PiP.'));
      });

      navigator.mediaSession.setActionHandler('pause', () => {
        console.log('[PIPController] PiP Pause action triggered.');
        this.video.pause(); // Pause doesn't typically throw an error needing a catch
      });

      navigator.mediaSession.setActionHandler('seekbackward', (details) => {
        const skipTime = details.seekOffset || 10;
        console.log(`[PIPController] PiP Seek Backward action triggered by ${skipTime}s.`);
        this.video.currentTime = Math.max(0, this.video.currentTime - skipTime);
      });

      navigator.mediaSession.setActionHandler('seekforward', (details) => {
        const skipTime = details.seekOffset || 10;
        console.log(`[PIPController] PiP Seek Forward action triggered by ${skipTime}s.`);
        this.video.currentTime = Math.min(this.video.duration, this.video.currentTime + skipTime);
      });

      // Example of other handlers if needed
      // navigator.mediaSession.setActionHandler('stop', () => { this.exitPIP(); });
      // navigator.mediaSession.setActionHandler('previoustrack', () => { /* ... */ });
      // navigator.mediaSession.setActionHandler('nexttrack', () => { /* ... */ });

    } catch (error) {
      // This catch is for synchronous errors during setActionHandler calls, which are rare.
      ErrorHandler.handle(error, 'PIPController.setupPIPControls', 'Lỗi cài đặt điều khiển cho Hình trong hình.');
    }
  }

  // Optional: Method to clear action handlers if they should only be active during PiP.
  // clearPIPControls() {
  //   if (!('mediaSession' in navigator)) return;
  //   try {
  //     navigator.mediaSession.setActionHandler('play', null);
  //     navigator.mediaSession.setActionHandler('pause', null);
  //     navigator.mediaSession.setActionHandler('seekbackward', null);
  //     navigator.mediaSession.setActionHandler('seekforward', null);
  //     console.log('[PIPController] Cleared PiP media session controls.');
  //   } catch (error) {
  //     ErrorHandler.handle(error, 'PIPController.clearPIPControls', 'Lỗi dọn dẹp điều khiển PiP.');
  //   }
  // }

  async exitPIP() {
    if (!this.isSupported) {
      // Should not happen if enterPIP checks this, but good for robustness.
      console.warn('[PIPController.exitPIP] PiP not supported.');
      return false;
    }
    if (document.pictureInPictureElement === this.video) {
      try {
        console.log('[PIPController] Requesting to exit Picture-in-Picture mode...');
        await document.exitPictureInPicture();
        // _onLeavePIP event will handle resetting this.pipWindow
        console.log('[PIPController] Exited Picture-in-Picture mode successfully.');
        return true;
      } catch (error) {
        ErrorHandler.handle(error, 'PIPController.exitPIP', 'Không thể thoát chế độ Hình trong hình.');
        return false;
      }
    } else {
      console.log('[PIPController] Video is not in Picture-in-Picture mode, or another element is.');
      // Ensure our internal state is consistent if PiP was exited by other means
      if (this.pipWindow) this.pipWindow = null;
      return true; // Effectively, it's not in PiP from this controller's perspective.
    }
  }

  // Call this when the PIPController instance is no longer needed to clean up listeners.
  destroy() {
    if (this.isSupported) {
      this.video.removeEventListener('enterpictureinpicture', this._onEnterPIP);
      this.video.removeEventListener('leavepictureinpicture', this._onLeavePIP);
    }
    // Clear media session handlers if they were set by this instance and should be cleaned up.
    // This is important if multiple PIPControllers could exist or if default behavior should be restored.
    // For simplicity, if they are global and managed by the app lifecycle, this might not be needed here.
    // this.clearPIPControls();
    this.pipWindow = null;
    console.log('[PIPController] Destroyed.');
  }
}

export { PIPController };
