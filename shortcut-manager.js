// shortcut-manager.js
import { ErrorHandler } from './error-handler.js';

class ShortcutManager {
  constructor(videoElement) { // Assuming it might need direct access to video for actions
    this.shortcuts = new Map();
    this.videoElement = videoElement; // Optional, but useful for direct actions

    // Bind the event handler to 'this' instance
    this._boundHandleKeyPress = this.handleKeyPress.bind(this);

    this.loadUserShortcuts();
    this.setupEventListeners();
    console.log('[ShortcutManager] Initialized.');
  }

  /**
   * Registers a new shortcut or updates an existing one.
   * @param {string} key - The key combination (e.g., 'ctrl+k', 'arrowup').
   * @param {object} action - The action object (e.g., { type: 'seek', value: 10 }).
   * @param {string} [context='global'] - The context in which the shortcut is active.
   */
  registerShortcut(key, action, context = 'global') {
    if (!key || typeof key !== 'string' || !action || typeof action.type !== 'string') {
      const error = new Error('Invalid arguments for registerShortcut. Key and action.type are required.');
      ErrorHandler.handle(error, 'ShortcutManager.registerShortcut', 'Không thể đăng ký phím tắt không hợp lệ.');
      return;
    }
    const shortcutId = this._getShortcutId(key, context);
    this.shortcuts.set(shortcutId, {
      key: key.toLowerCase(), // Normalize key
      action,
      context,
      timestamp: Date.now() // For potential future management (e.g., conflicts)
    });
    this.saveUserShortcuts();
    console.log(`[ShortcutManager] Shortcut registered/updated: ID=${shortcutId}, Key=${key}, Action=${action.type}`);
  }

  _getShortcutId(key, context) {
    return `${context}_${key.toLowerCase()}`;
  }

  handleKeyPress(event) {
    try {
      const keyString = this.getKeyString(event);
      const context = this.getCurrentContext(event.target);

      // Check context-specific shortcut first
      let shortcut = this.shortcuts.get(this._getShortcutId(keyString, context));

      // If not found, check global context
      if (!shortcut) {
        shortcut = this.shortcuts.get(this._getShortcutId(keyString, 'global'));
      }

      if (shortcut) {
        console.log(`[ShortcutManager] Handling shortcut: Key=${keyString}, Context=${shortcut.context}, Action=${shortcut.action.type}`);
        event.preventDefault(); // Prevent default browser action for this key
        event.stopPropagation(); // Stop propagation to avoid conflicts
        this.executeAction(shortcut.action);
      }
    } catch (error) {
      ErrorHandler.handle(error, 'ShortcutManager.handleKeyPress', 'Lỗi xử lý phím tắt.');
    }
  }

  executeAction(action) {
    if (!this.videoElement && ['seek', 'volume', 'speed', 'quality'].includes(action.type)) {
        ErrorHandler.handle(new Error('Video element not available for action: ' + action.type), 'ShortcutManager.executeAction', 'Không tìm thấy video để thực hiện hành động.');
        return;
    }

    try {
      console.log(`[ShortcutManager] Executing action:`, action);
      switch (action.type) {
        case 'seek':
          if (typeof this.videoElement.currentTime === 'number' && typeof action.value === 'number') {
            this.videoElement.currentTime += action.value;
          }
          break;
        case 'volume':
          if (typeof this.videoElement.volume === 'number' && typeof action.value === 'number') {
            // Value could be absolute (0-1) or relative (+0.1, -0.1)
            if (action.value >= 0 && action.value <= 1) { // Absolute
                 this.videoElement.volume = action.value;
            } else { // Relative
                 this.videoElement.volume = Math.max(0, Math.min(1, this.videoElement.volume + action.value));
            }
          }
          break;
        case 'speed':
          if (typeof this.videoElement.playbackRate === 'number' && typeof action.value === 'number') {
            this.videoElement.playbackRate = action.value;
          }
          break;
        case 'quality':
          // This is more complex and usually involves a player API
          console.log(`[ShortcutManager] Action: Change quality to ${action.value}`);
          // Example: if (window.playerAPI && typeof window.playerAPI.setQuality === 'function') {
          //   window.playerAPI.setQuality(action.value);
          // } else {
          //   ErrorHandler.handle(new Error('Quality change API not available'), 'ShortcutManager.executeAction', 'Không thể thay đổi chất lượng video.');
          // }
          alert(`Shortcut: Change quality to ${action.value} (not fully implemented)`);
          break;
        case 'toggle_play_pause':
            if (this.videoElement.paused) this.videoElement.play().catch(e => ErrorHandler.handle(e, 'ShortcutManager.executeAction.play', 'Lỗi khi phát video.'));
            else this.videoElement.pause();
            break;
        case 'fullscreen':
            if (document.fullscreenElement) document.exitFullscreen().catch(e => ErrorHandler.handle(e, 'ShortcutManager.executeAction.exitFullscreen', 'Lỗi thoát toàn màn hình.'));
            else this.videoElement.requestFullscreen().catch(e => ErrorHandler.handle(e, 'ShortcutManager.executeAction.requestFullscreen', 'Lỗi vào toàn màn hình.'));
            break;
        default:
          console.warn(`[ShortcutManager] Unknown action type: ${action.type}`);
      }
    } catch (error) {
      ErrorHandler.handle(error, 'ShortcutManager.executeAction', `Lỗi thực hiện hành động: ${action.type}.`);
    }
  }

  loadUserShortcuts() {
    try {
      const savedShortcuts = localStorage.getItem('tizentube_shortcuts');
      if (savedShortcuts) {
        const parsed = JSON.parse(savedShortcuts);
        // Ensure it's an array of [key, value] pairs for Map constructor
        if (Array.isArray(parsed)) {
            this.shortcuts = new Map(parsed);
            console.log('[ShortcutManager] User shortcuts loaded from localStorage:', this.shortcuts.size);
        } else {
            console.warn('[ShortcutManager] Invalid shortcut format in localStorage. Ignoring.');
            this.shortcuts = new Map(); // Reset to empty if format is wrong
        }
      } else {
        console.log('[ShortcutManager] No user shortcuts found in localStorage. Using defaults.');
        // Optionally, load default shortcuts here
        // this.registerShortcut('ctrl+shift+p', { type: 'toggle_play_pause' }, 'global');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'ShortcutManager.loadUserShortcuts', 'Không thể tải phím tắt đã lưu.');
      this.shortcuts = new Map(); // Reset to empty on error
    }
  }

  saveUserShortcuts() {
    try {
      // Convert Map to an array of [key, value] pairs for JSON stringification
      const shortcutsArray = Array.from(this.shortcuts.entries());
      localStorage.setItem('tizentube_shortcuts', JSON.stringify(shortcutsArray));
      console.log('[ShortcutManager] User shortcuts saved to localStorage.');
    } catch (error) {
      ErrorHandler.handle(error, 'ShortcutManager.saveUserShortcuts', 'Không thể lưu phím tắt.');
    }
  }

  getKeyString(event) {
    let keyString = '';
    if (event.ctrlKey) keyString += 'ctrl+';
    if (event.altKey) keyString += 'alt+';
    if (event.shiftKey) keyString += 'shift+'; // Added shiftKey support
    if (event.metaKey) keyString += 'meta+';   // Added metaKey (Cmd on Mac, Win key on Windows)

    // Normalize common key names
    let key = event.key.toLowerCase();
    if (key === ' ') key = 'space';
    else if (key.startsWith('arrow')) key = key.replace('arrow', ''); // arrowup -> up
    // Add more normalizations if needed (e.g., 'escape' -> 'esc')

    keyString += key;
    return keyString;
  }

  /**
   * Determines the current context for shortcuts.
   * @param {EventTarget} target - The element that is the target of the key event.
   * @returns {string} The context string (e.g., 'global', 'player', 'input_field').
   */
  getCurrentContext(target) {
    if (target) {
        if (target.dataset && target.dataset.shortcutContext) {
            return target.dataset.shortcutContext;
        }
        if (target.matches && (target.matches('input, textarea, [contenteditable="true"]'))) {
            return 'input_field'; // Example: disable global shortcuts in input fields
        }
        if (this.videoElement && this.videoElement.contains(target)) {
            return 'player'; // If event target is within the video player
        }
    }
    return 'global'; // Default context
  }

  setupEventListeners() {
    // Listen on window to capture events globally, unless stopped by specific handlers.
    // Using keydown as it fires for all keys and allows preventDefault.
    window.addEventListener('keydown', this._boundHandleKeyPress, true); // Use capture phase
    console.log('[ShortcutManager] Global keydown event listener setup.');
  }

  destroy() {
    window.removeEventListener('keydown', this._boundHandleKeyPress, true);
    this.shortcuts.clear();
    console.log('[ShortcutManager] Destroyed and event listeners removed.');
  }
}

export { ShortcutManager };
