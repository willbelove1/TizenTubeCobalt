// state-manager.js

class StateManager {
  constructor() {
    this.state = {};
    this.listeners = new Set();
    console.log('[StateManager] Initialized.');
  }

  /**
   * Sets a value in the state and notifies listeners.
   * @param {string} key - The key for the state property.
   * @param {any} value - The value to set.
   */
  setState(key, value) {
    if (typeof key !== 'string' || key.trim() === '') {
      console.error('[StateManager] setState error: Key must be a non-empty string.');
      return;
    }
    // console.log(`[StateManager] Setting state: ${key} =`, value);
    this.state[key] = value;
    this.notify(key, value);
  }

  /**
   * Gets a value from the state.
   * @param {string} key - The key for the state property.
   * @returns {any} The value from the state, or undefined if the key doesn't exist.
   */
  getState(key) {
    if (typeof key !== 'string') {
      console.warn('[StateManager] getState: Key was not a string, returning undefined.');
      return undefined;
    }
    return this.state[key];
  }

  /**
   * Subscribes a listener function to state changes.
   * The listener will be called with the full state object and the key that changed.
   * @param {function(object, string, any)} listener - The listener function.
   * @returns {function} An unsubscribe function.
   */
  subscribe(listener) {
    if (typeof listener !== 'function') {
      console.error('[StateManager] subscribe error: Listener must be a function.');
      return () => {}; // Return a no-op unsubscribe function
    }
    this.listeners.add(listener);
    // console.log('[StateManager] Listener subscribed. Total listeners:', this.listeners.size);
    return () => {
      this.listeners.delete(listener);
      // console.log('[StateManager] Listener unsubscribed. Total listeners:', this.listeners.size);
    };
  }

  /**
   * Notifies all subscribed listeners about a state change.
   * @param {string} changedKey - The key that was changed.
   * @param {any} newValue - The new value for the changed key.
   * @private
   */
  notify(changedKey, newValue) {
    // console.log(`[StateManager] Notifying ${this.listeners.size} listeners about change to '${changedKey}'.`);
    this.listeners.forEach(listener => {
      try {
        // Pass the full state, the key that changed, and its new value
        listener(this.state, changedKey, newValue);
      } catch (error) {
        console.error('[StateManager] Error in listener during notify:', error);
        // Optionally, use ErrorHandler here if such errors should be globally handled
        // ErrorHandler.handle(error, 'StateManager.notifyListener', 'Lỗi trong quá trình cập nhật giao diện.');
      }
    });
  }
}

// Instantiate and make it globally available as per the provided solution.
// This is a common pattern for simple global state, but for larger applications,
// consider module exports or dependency injection.
if (window.stateManager) {
  console.warn('[StateManager] window.stateManager already exists. Overwriting is generally not recommended unless intentional for HMR or similar.');
}
window.stateManager = new StateManager();

// Example Usage (can be removed or commented out for production)
/*
console.log("StateManager Example Usage:");

// Example listener
const myListener = (currentState, changedKey, newValue) => {
  console.log("Listener notified! Changed key:", changedKey, "New value:", newValue);
  console.log("Current full state:", currentState);
  // Update UI or perform actions based on state change
  if (changedKey === 'currentQuality') {
    // document.getElementById('qualityDisplay').textContent = newValue;
  }
};

// Subscribe the listener
const unsubscribeMyListener = window.stateManager.subscribe(myListener);

// Set some state
window.stateManager.setState('currentVideoId', 'video123');
window.stateManager.setState('currentQuality', '720p');
window.stateManager.setState('userPreferences', { theme: 'dark', volume: 0.8 });

// Get some state
console.log("User volume preference:", window.stateManager.getState('userPreferences')?.volume);

// Change state again
window.stateManager.setState('currentQuality', '1080p');

// Unsubscribe the listener (e.g., when a component unmounts)
// unsubscribeMyListener();
// window.stateManager.setState('currentQuality', '480p'); // This change won't call myListener

*/
