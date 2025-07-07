// parental-controls.js
import { ErrorHandler } from './error-handler.js';
// fetchWithRetry might be needed if fetchVideoMetadata is implemented to fetch from an API
import { fetchWithRetry } from './api-utils.js';

class ParentalControls {
  constructor(options = {}) {
    this.localStorageKey = 'tizentube_restrictions';
    this.restrictions = {
      ageRating: null, // e.g., 'PG', '12', null means no age restriction
      maxDailyWatchTimeSeconds: null, // in seconds, null means no limit
      restrictedHours: { start: null, end: null }, // e.g., { start: '22:00', end: '06:00' }, nulls mean no time restriction
      blockedCategories: [], // Array of strings
      pin: null, // Stores the encoded PIN
      isEnabled: false, // Overall toggle for parental controls
    };
    this.watchTimeTodaySeconds = 0; // Tracks watch time for the current day
    this.watchTimeIntervalId = null;
    this.restrictedHoursIntervalId = null;
    this.uiContainer = null; // To store the main UI container element
    this.sessionPinVerified = false; // Track if PIN was verified in current UI interaction session

    this._loadState(); // Load saved restrictions and today's watch time

    if (this.restrictions.isEnabled) {
        // Defer applyRestrictions until UI is potentially rendered or if called explicitly
        // this.applyRestrictions();
        this.startWatchTimeTracking();
        this.startRestrictedHoursMonitoring();
    }
    console.log('[ParentalControls] Initialized. Current restrictions:', this.restrictions);
  }

  // DOM Element creator helper
  _createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.id) el.id = options.id;
    if (options.type) el.type = options.type;
    if (options.textContent) el.textContent = options.textContent;
    if (options.innerHTML) el.innerHTML = options.innerHTML;
    if (options.value !== undefined) el.value = options.value; // Check for undefined to allow empty string value
    if (options.placeholder) el.placeholder = options.placeholder;
    if (options.checked !== undefined) el.checked = options.checked;
    if (options.disabled !== undefined) el.disabled = options.disabled;
    if (options.min) el.min = options.min;
    if (options.max) el.max = options.max;
    if (options.step) el.step = options.step;
    if (options.htmlFor) el.htmlFor = options.htmlFor;


    if (options.attributes) {
        for (const [attr, value] of Object.entries(options.attributes)) {
            el.setAttribute(attr, value);
        }
    }
    if (options.children) {
        options.children.forEach(child => child && el.appendChild(child));
    }
    if (options.eventListeners) {
        for (const [event, listener] of Object.entries(options.eventListeners)) {
            el.addEventListener(event, listener.bind(this)); // Bind 'this' context
        }
    }
    return el;
  }

  _loadState() {
    try {
      const savedRestrictions = localStorage.getItem(this.localStorageKey);
      if (savedRestrictions) {
        const parsed = JSON.parse(savedRestrictions);
        // Merge saved settings, ensuring all keys are present from default
        this.restrictions = { ...this.restrictions, ...parsed };
        console.log('[ParentalControls] Loaded restrictions from localStorage.');
      }

      const savedWatchTimeData = localStorage.getItem('tizentube_watch_time_today');
      if (savedWatchTimeData) {
        const data = JSON.parse(savedWatchTimeData);
        const today = new Date().toDateString();
        if (data.date === today) {
          this.watchTimeTodaySeconds = data.time || 0;
        } else {
          // Different day, reset watch time
          this.watchTimeTodaySeconds = 0;
          this._saveWatchTime(); // Save reset time for new day
        }
      }
    } catch (error) {
      ErrorHandler.handle(error, 'ParentalControls._loadState', 'Không thể tải cài đặt kiểm soát của cha mẹ.');
      // Reset to defaults on load error to be safe
      this._resetToDefaultsAndSave();
    }
  }

  _saveRestrictions() {
    try {
      localStorage.setItem(this.localStorageKey, JSON.stringify(this.restrictions));
      console.log('[ParentalControls] Restrictions saved to localStorage.');
    } catch (error) {
      ErrorHandler.handle(error, 'ParentalControls._saveRestrictions', 'Không thể lưu cài đặt kiểm soát của cha mẹ.');
    }
  }

  _saveWatchTime() {
    try {
      const data = {
        date: new Date().toDateString(),
        time: this.watchTimeTodaySeconds,
      };
      localStorage.setItem('tizentube_watch_time_today', JSON.stringify(data));
    } catch (error) {
      // Don't show user-facing error for this, just log.
      console.error('[ParentalControls._saveWatchTime] Error saving watch time:', error);
    }
  }

  _resetToDefaultsAndSave() {
    this.restrictions = { /* initial default values */ isEnabled: false, pin: null, /* etc */ };
    this.watchTimeTodaySeconds = 0;
    this._saveRestrictions();
    this._saveWatchTime();
  }

  enableControls(pinToSet) {
    if (!pinToSet || pinToSet.length < 4) {
      ErrorHandler.handle(new Error("PIN is too short"), "ParentalControls.enableControls", "Mã PIN phải có ít nhất 4 ký tự.");
      return false;
    }
    this.setPin(pinToSet); // This will save
    this.restrictions.isEnabled = true;
    this._saveRestrictions();
    this.applyRestrictions();
    this.startWatchTimeTracking();
    this.startRestrictedHoursMonitoring();
    this.showUINotification('Kiểm soát của cha mẹ đã được bật.');
    console.log('[ParentalControls] Controls enabled.');
    return true;
  }

  disableControls(enteredPin) {
    if (!this.verifyPin(enteredPin)) {
      ErrorHandler.handle(new Error("Incorrect PIN"), "ParentalControls.disableControls", "Mã PIN không đúng.");
      return false;
    }
    this.restrictions.isEnabled = false;
    this._saveRestrictions();
    this.stopWatchTimeTracking();
    this.stopRestrictedHoursMonitoring();
    // Optionally, clear other restrictions or keep them for when it's re-enabled
    // this.restrictions.ageRating = null;
    // this.restrictions.maxDailyWatchTimeSeconds = null;
    this.showUINotification('Kiểm soát của cha mẹ đã được tắt.');
    console.log('[ParentalControls] Controls disabled.');
    return true;
  }


  setPin(newPin) {
    if (!newPin || newPin.length < 4) {
        ErrorHandler.handle(new Error('PIN must be at least 4 characters.'), 'ParentalControls.setPin', 'Mã PIN phải có ít nhất 4 ký tự.');
        return false;
    }
    try {
      this.restrictions.pin = btoa(newPin); // Base64 encode
      this._saveRestrictions();
      console.log('[ParentalControls] PIN updated.');
      return true;
    } catch (error) {
      ErrorHandler.handle(error, 'ParentalControls.setPin', 'Không thể đặt mã PIN.');
      return false;
    }
  }

  verifyPin(enteredPin) {
    if (!this.restrictions.pin) {
      // No PIN set, verification fails or could be interpreted as "access allowed" if controls not fully set up.
      // For changing settings, a PIN should exist.
      console.warn('[ParentalControls.verifyPin] No PIN set to verify against.');
      return false;
    }
    if (!enteredPin) return false;
    try {
      return this.restrictions.pin === btoa(enteredPin);
    } catch (error) {
      // Error during btoa (unlikely for typical strings but possible)
      ErrorHandler.handle(error, 'ParentalControls.verifyPin', 'Lỗi xác thực mã PIN.');
      return false;
    }
  }

  setRestrictions(settings, enteredPin) {
    if (!this.restrictions.isEnabled) {
        ErrorHandler.handle(new Error("Parental controls are disabled."), "ParentalControls.setRestrictions", "Kiểm soát của cha mẹ đang tắt. Hãy bật trước khi cài đặt.");
        return false;
    }
    if (!this.verifyPin(enteredPin)) {
      ErrorHandler.handle(new Error('Incorrect PIN for setting restrictions.'), 'ParentalControls.setRestrictions', 'Sai mã PIN. Không thể thay đổi cài đặt.');
      return false;
    }
    try {
      // Validate and merge settings
      if (settings.ageRating !== undefined) this.restrictions.ageRating = settings.ageRating; // Could be null
      if (typeof settings.maxDailyWatchTimeSeconds === 'number' && settings.maxDailyWatchTimeSeconds >= 0) {
        this.restrictions.maxDailyWatchTimeSeconds = settings.maxDailyWatchTimeSeconds;
      } else if (settings.maxDailyWatchTimeSeconds === null) {
        this.restrictions.maxDailyWatchTimeSeconds = null;
      }
      // Add more validation for restrictedHours format (HH:MM)
      if (settings.restrictedHours) {
          this.restrictions.restrictedHours.start = settings.restrictedHours.start || null;
          this.restrictions.restrictedHours.end = settings.restrictedHours.end || null;
      }
      if (Array.isArray(settings.blockedCategories)) {
        this.restrictions.blockedCategories = settings.blockedCategories;
      }

      this._saveRestrictions();
      this.applyRestrictions(); // Re-apply new restrictions immediately
      console.log('[ParentalControls] Restrictions updated:', this.restrictions);
      this.showUINotification('Cài đặt kiểm soát của cha mẹ đã được cập nhật.');
      return true;
    } catch (error) {
      ErrorHandler.handle(error, 'ParentalControls.setRestrictions', 'Không thể lưu cài đặt hạn chế.');
      return false;
    }
  }

  applyRestrictions() {
    if (!this.restrictions.isEnabled) {
      console.log('[ParentalControls.applyRestrictions] Controls disabled, no restrictions applied.');
      // Potentially un-hide all content if it was previously hidden
      this._unfilterAllContent();
      return;
    }
    console.log('[ParentalControls] Applying all restrictions...');
    this.filterContentByMetadata(); // Renamed for clarity
    this.enforceWatchTimeLimit();    // Check current limits immediately
    this.enforceRestrictedHours();
  }

  // Example: Filter items based on data attributes (rating, category)
  // This is highly dependent on how video items are rendered and what metadata is available.
  async filterContentByMetadata() {
    if (!this.restrictions.isEnabled) return;
    console.log('[ParentalControls] Filtering content by metadata...');
    const videos = document.querySelectorAll('.video-item'); // Assuming videos have this class

    for (const videoElement of videos) {
      try {
        const videoId = videoElement.dataset.videoId; // Assume video ID is available
        if (!videoId) {
          videoElement.style.display = ''; // Show if no ID to check
          continue;
        }

        // Fetch or get metadata (rating, category) for the videoId
        // This is a placeholder. In a real app, metadata might come from an API or be embedded.
        // const metadata = await this.fetchVideoMetadata(videoId);
        // For now, use data attributes directly as per original spec:
        const rating = videoElement.dataset.rating || null;
        const category = videoElement.dataset.category || '';

        let isBlocked = false;
        // Age rating check (simplified: assumes higher number/string means more restrictive)
        if (this.restrictions.ageRating && rating && rating > this.restrictions.ageRating) {
          isBlocked = true;
        }
        // Category check
        if (!isBlocked && this.restrictions.blockedCategories.length > 0 && this.restrictions.blockedCategories.includes(category)) {
          isBlocked = true;
        }

        videoElement.style.display = isBlocked ? 'none' : '';
      } catch (error) {
        console.error(`[ParentalControls] Error filtering video item ${videoElement.dataset.videoId}:`, error);
        // Don't hide item on error, default to visible
        videoElement.style.display = '';
      }
    }
  }

  _unfilterAllContent() {
    console.log('[ParentalControls] Unfiltering all content.');
    const videos = document.querySelectorAll('.video-item');
    videos.forEach(videoElement => {
      videoElement.style.display = '';
    });
  }

  // Placeholder for fetching metadata if not available on data attributes
  // async fetchVideoMetadata(videoId) {
  //   try {
  //     console.log(`[ParentalControls] Fetching metadata for videoId: ${videoId}`);
  //     const response = await fetchWithRetry(`https://api.tizentube.com/v1/videos/${videoId}/metadata`, {
  //       headers: { 'Authorization': `Bearer ${localStorage.getItem('tizentube_token')}` }
  //     });
  //     return response; // Expected: { id, rating, category, ... }
  //   } catch (error) {
  //     // ErrorHandler.handle is called by fetchWithRetry
  //     console.error(`[ParentalControls.fetchVideoMetadata] Failed for ${videoId}: ${error.message}`);
  //     throw error; // Let filterContentByMetadata handle display
  //   }
  // }

  startWatchTimeTracking() {
    if (this.watchTimeIntervalId || !this.restrictions.isEnabled || this.restrictions.maxDailyWatchTimeSeconds === null) {
      return;
    }
    console.log('[ParentalControls] Starting watch time tracking.');
    this.watchTimeIntervalId = setInterval(() => {
      try {
        const video = document.querySelector('video:not([paused])'); // Find any playing video
        if (video) {
          this.watchTimeTodaySeconds += 1;
          this._saveWatchTime(); // Save periodically
          this.enforceWatchTimeLimit();
        }
      } catch (error) {
        // Log this error, but don't use ErrorHandler to show UI message for a background tick.
        console.error('[ParentalControls.watchTimeTracking] Error in interval:', error);
      }
    }, 1000); // Increment every second
  }

  stopWatchTimeTracking() {
    if (this.watchTimeIntervalId) {
      clearInterval(this.watchTimeIntervalId);
      this.watchTimeIntervalId = null;
      console.log('[ParentalControls] Watch time tracking stopped.');
    }
  }

  enforceWatchTimeLimit() {
    if (!this.restrictions.isEnabled || this.restrictions.maxDailyWatchTimeSeconds === null) return;

    if (this.watchTimeTodaySeconds >= this.restrictions.maxDailyWatchTimeSeconds) {
      this.pauseAllVideos();
      this.showUINotification('Đã đạt giới hạn thời gian xem hôm nay. Video đã được tạm dừng.');
      console.log('[ParentalControls] Daily watch time limit reached.');
    }
  }

  startRestrictedHoursMonitoring() {
    if (this.restrictedHoursIntervalId || !this.restrictions.isEnabled) return;
    console.log('[ParentalControls] Starting restricted hours monitoring.');
    this.restrictedHoursIntervalId = setInterval(() => {
        this.enforceRestrictedHours();
    }, 60000); // Check every minute
    this.enforceRestrictedHours(); // Initial check
  }

  stopRestrictedHoursMonitoring() {
     if (this.restrictedHoursIntervalId) {
      clearInterval(this.restrictedHoursIntervalId);
      this.restrictedHoursIntervalId = null;
      console.log('[ParentalControls] Restricted hours monitoring stopped.');
    }
  }

  enforceRestrictedHours() {
    if (!this.restrictions.isEnabled || !this.restrictions.restrictedHours.start || !this.restrictions.restrictedHours.end) {
      return;
    }
    try {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();

      const [startHour, startMinute] = this.restrictions.restrictedHours.start.split(':').map(Number);
      const startTotalMinutes = startHour * 60 + startMinute;

      const [endHour, endMinute] = this.restrictions.restrictedHours.end.split(':').map(Number);
      let endTotalMinutes = endHour * 60 + endMinute;

      let isRestrictedTime = false;
      if (startTotalMinutes <= endTotalMinutes) { // Same day restriction (e.g., 09:00 - 17:00)
        isRestrictedTime = currentMinutes >= startTotalMinutes && currentMinutes < endTotalMinutes;
      } else { // Overnight restriction (e.g., 22:00 - 06:00)
        isRestrictedTime = currentMinutes >= startTotalMinutes || currentMinutes < endTotalMinutes;
      }

      if (isRestrictedTime) {
        this.pauseAllVideos();
        this.showUINotification(`Không thể xem trong khung giờ hạn chế (${this.restrictions.restrictedHours.start} - ${this.restrictions.restrictedHours.end}). Video đã tạm dừng.`);
        console.log('[ParentalControls] Currently in restricted hours. Playback paused.');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'ParentalControls.enforceRestrictedHours', 'Lỗi kiểm tra khung giờ hạn chế.');
    }
  }

  pauseAllVideos() {
    console.log('[ParentalControls] Pausing all videos due to restriction.');
    document.querySelectorAll('video').forEach(video => {
      if (!video.paused) video.pause();
    });
  }

  showUINotification(message) {
    // Using a general notification method, could be part of a shared UIManager
    // For now, adapting the one from SleepTimer or ErrorHandler for simplicity
    console.log(`[ParentalControls] Notification: ${message}`);
    if (typeof ErrorHandler !== 'undefined' && ErrorHandler.showUserFeedback) {
        const notification = document.createElement('div');
        notification.className = 'notification parental-control-notice'; // Specific class for styling
        notification.textContent = message;

        notification.style.position = 'fixed';
        notification.style.bottom = '80px'; // Position distinct from errors/sleep timer
        notification.style.right = '20px';
        notification.style.padding = '10px 20px';
        notification.style.background = 'rgba(255, 152, 0, 0.9)'; // Amber/Orange color
        notification.style.color = 'white';
        notification.style.borderRadius = '5px';
        notification.style.zIndex = '1998';
        document.body.appendChild(notification);
        setTimeout(() => {
            if (notification.parentNode) notification.remove();
        }, 5000);
    } else {
        alert(message);
    }
  }

  // Call this when the main application/component is destroyed
  destroy() {
    this.stopWatchTimeTracking();
    this.stopRestrictedHoursMonitoring();
    console.log('[ParentalControls] Destroyed.');
  }
}

export { ParentalControls };
