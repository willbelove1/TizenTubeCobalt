// sleep-timer.js
import { ErrorHandler } from './error-handler.js';

class SleepTimer {
  constructor() {
    this.timers = new Map(); // Stores active timers: timerId -> timerObject
    this.notifications = []; // Could be used to manage displayed notifications if needed beyond ErrorHandler
    console.log('[SleepTimer] Initialized.');
  }

  /**
   * Sets a new sleep timer.
   * @param {number} durationMs - Duration in milliseconds until the timer fires.
   * @param {Array<string>} [actions=['pause', 'close']] - Actions to perform when timer fires.
   * @returns {number} The ID of the newly created timer.
   */
  setSleepTimer(durationMs, actions = ['pause', 'close']) {
    if (typeof durationMs !== 'number' || durationMs <= 0) {
      ErrorHandler.handle(new Error('Invalid duration for sleep timer.'), 'SleepTimer.setSleepTimer', 'Thời gian hẹn giờ không hợp lệ.');
      return null;
    }
    if (!Array.isArray(actions) || actions.length === 0) {
      ErrorHandler.handle(new Error('No actions specified for sleep timer.'), 'SleepTimer.setSleepTimer', 'Không có hành động nào được chỉ định cho hẹn giờ ngủ.');
      return null;
    }

    const timerId = Date.now(); // Use timestamp as a simple unique ID
    const endTime = Date.now() + durationMs;

    // Define warning times relative to endTime or durationMs
    const warnings = [];
    if (durationMs > 300000) { // Only add 5 min warning if duration is > 5 mins
        warnings.push({ time: endTime - 300000, message: 'Ứng dụng sẽ thực hiện hành động sau 5 phút.', shown: false });
    }
    if (durationMs > 60000) { // Only add 1 min warning if duration is > 1 min
        warnings.push({ time: endTime - 60000, message: 'Ứng dụng sẽ thực hiện hành động sau 1 phút.', shown: false });
    }
    // A very short warning
    if (durationMs > 10000 && durationMs <= 60000) {
        warnings.push({ time: endTime - 10000, message: 'Ứng dụng sẽ thực hiện hành động sau 10 giây.', shown: false });
    }


    const timer = {
      id: timerId,
      durationMs,
      endTime,
      actions,
      warnings,
      intervalId: setInterval(() => this.checkTimer(timerId), 1000) // Check every second
    };

    this.timers.set(timerId, timer);
    console.log(`[SleepTimer] Timer ${timerId} set for ${durationMs / 1000}s. Actions: ${actions.join(', ')}`);
    this.showNotification(`Hẹn giờ ngủ đã được đặt trong ${this._formatDuration(durationMs)}.`);
    return timerId;
  }

  _formatDuration(ms) {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);
    let str = "";
    if (hours > 0) str += `${hours} giờ `;
    if (minutes > 0) str += `${minutes} phút `;
    if (seconds > 0 || (!hours && !minutes)) str += `${seconds} giây`; // Show seconds if it's the only unit
    return str.trim();
  }

  checkTimer(timerId) {
    const timer = this.timers.get(timerId);
    if (!timer) {
      // Timer might have been cancelled, or ID is invalid. Silently stop interval if it exists by some mistake.
      // This should not happen if cancelTimer correctly clears intervals.
      // Looping over all intervals to find one matching timerId is not efficient.
      // This check is mostly for robustness if an interval continues after timer removal.
      return;
    }

    const now = Date.now();

    // Check warnings
    timer.warnings.forEach(warning => {
      if (!warning.shown && now >= warning.time) {
        this.showNotification(warning.message, 'warning'); // Differentiate warning notifications
        warning.shown = true;
        console.log(`[SleepTimer] Warning for timer ${timerId}: ${warning.message}`);
      }
    });

    // Check if timer should fire
    if (now >= timer.endTime) {
      console.log(`[SleepTimer] Timer ${timerId} fired. Executing actions.`);
      this.executeTimerActions(timer.actions);
      this.cancelTimer(timerId); // Clean up the timer
    }
  }

  executeTimerActions(actions) {
    console.log('[SleepTimer] Executing actions:', actions);
    actions.forEach(action => {
      try {
        switch (action) {
          case 'pause':
            this.pauseAllVideos();
            break;
          case 'close':
            this.closeApplication();
            break;
          case 'lower_volume':
            this.lowerVolumeGradually(); // Changed to gradual lowering
            break;
          case 'show_message':
            this.showSleepMessage();
            break;
          default:
            console.warn(`[SleepTimer] Unknown timer action: ${action}`);
        }
      } catch (error) {
        // ErrorHandler.handle for specific action failures.
        ErrorHandler.handle(error, `SleepTimer.executeTimerActions.${action}`, `Lỗi khi thực hiện hành động hẹn giờ: ${action}.`);
      }
    });
  }

  pauseAllVideos() {
    console.log('[SleepTimer] Pausing all videos.');
    const videos = document.querySelectorAll('video');
    videos.forEach(video => {
      if (!video.paused) video.pause();
    });
  }

  lowerVolumeGradually(steps = 5, intervalMs = 500) {
    console.log('[SleepTimer] Lowering volume gradually.');
    const videos = document.querySelectorAll('video');
    if (videos.length === 0) return;

    videos.forEach(video => {
        if (video.volume === 0) return; // Already muted

        const initialVolume = video.volume;
        const decrement = initialVolume / steps;
        let currentStep = 0;

        const intervalId = setInterval(() => {
            if (currentStep >= steps || video.volume === 0) {
                clearInterval(intervalId);
                video.volume = 0; // Ensure it's fully muted
                return;
            }
            video.volume = Math.max(0, video.volume - decrement);
            currentStep++;
        }, intervalMs);
    });
  }

  showSleepMessage() {
    console.log('[SleepTimer] Showing sleep message.');
    // Using ErrorHandler's feedback mechanism for consistency, but as a 'notification' type
    this.showNotification('Ứng dụng sẽ sớm thực hiện hành động hẹn giờ ngủ.', 'info');
  }

  closeApplication() {
    console.log('[SleepTimer] Attempting to close application.');
    try {
      if (window.tizen && typeof tizen.application.getCurrentApplication === 'function') {
        const currentApp = tizen.application.getCurrentApplication();
        if (currentApp && typeof currentApp.exit === 'function') {
          currentApp.exit();
        } else {
          throw new Error('Tizen exit function not available on currentApplication.');
        }
      } else if (typeof window.close === 'function' && !window.closed) {
        // Standard window.close(), often blocked by browsers unless script opened the window.
        window.close();
        if(window.closed) {
            console.log("[SleepTimer] window.close() called and window is now closed.");
        } else {
            console.warn("[SleepTimer] window.close() called, but window did not close. This is common due to browser restrictions.");
            ErrorHandler.handle(new Error('Standard window.close() did not work.'), 'SleepTimer.closeApplication', 'Không thể tự động đóng ứng dụng (trình duyệt có thể chặn).');
        }
      } else {
        throw new Error('No known method to close application programmatically.');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'SleepTimer.closeApplication', 'Không thể tự động đóng ứng dụng.');
    }
  }

  showNotification(message, type = 'info') { // type can be 'info', 'warning', 'error'
    // This is a specific notification for SleepTimer, not necessarily an error.
    // We can use a similar DOM creation as ErrorHandler but with different styling or a common notification manager.
    // For now, let's adapt ErrorHandler's showUserFeedback for general notifications if ErrorHandler is global.
    console.log(`[SleepTimer] Notification (${type}): ${message}`);
    if (typeof ErrorHandler !== 'undefined' && ErrorHandler.showUserFeedback) {
        // Modify the message or class if ErrorHandler's styling is too error-specific
        const notification = document.createElement('div');
        // Use a general 'notification' class and a type-specific class for styling
        notification.className = `notification sleep-timer-${type}`;
        notification.textContent = message;

        // Basic styling (should be in styles.css)
        notification.style.position = 'fixed';
        notification.style.bottom = '60px'; // Position slightly above error notifications
        notification.style.right = '20px';
        notification.style.padding = '10px 20px';
        notification.style.color = 'white';
        notification.style.borderRadius = '5px';
        notification.style.zIndex = '1999'; // Below error notifications potentially
        if (type === 'warning') {
            notification.style.background = 'rgba(255, 193, 7, 0.9)'; // Yellowish
            notification.style.color = '#333';
        } else { // info
            notification.style.background = 'rgba(13, 202, 240, 0.9)'; // Bluish
        }
        document.body.appendChild(notification);
        setTimeout(() => {
            if (notification.parentNode) notification.remove();
        }, 4000); // Notifications last a bit longer
    } else {
        alert(`SleepTimer: ${message}`); // Fallback
    }
  }

  cancelTimer(timerId) {
    const timer = this.timers.get(timerId);
    if (timer) {
      clearInterval(timer.intervalId);
      this.timers.delete(timerId);
      console.log(`[SleepTimer] Timer ${timerId} cancelled.`);
      this.showNotification('Hẹn giờ ngủ đã được hủy.', 'info');
      return true;
    }
    console.warn(`[SleepTimer] Attempted to cancel non-existent timer: ${timerId}`);
    return false;
  }

  getActiveTimers() {
    return Array.from(this.timers.values()).map(t => ({
        id: t.id,
        remainingMs: Math.max(0, t.endTime - Date.now()),
        actions: t.actions
    }));
  }

  destroy() {
    // Clear all active timers
    this.timers.forEach(timer => clearInterval(timer.intervalId));
    this.timers.clear();
    console.log('[SleepTimer] All timers cleared. Destroyed.');
  }
}

export { SleepTimer };
