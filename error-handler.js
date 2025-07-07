// error-handler.js
class ErrorHandler {
  static handle(error, context, userMessage) {
    console.error(`[${context}] Error:`, error.message, error.stack); // Log message and stack
    this.logToAnalytics(context, error);
    this.showUserFeedback(userMessage || 'Đã xảy ra lỗi. Vui lòng thử lại.');
  }

  static logToAnalytics(context, error) {
    // Check if analytics is available on the window object
    if (window.analytics && typeof window.analytics.trackEvent === 'function') {
      window.analytics.trackEvent('error', {
        context: context,
        message: error.message,
        // Optionally, include more error details if appropriate
        // stack: error.stack, // Be cautious about PII in stack traces
        // errorName: error.name
      });
    } else {
      console.warn('[ErrorHandler] window.analytics or window.analytics.trackEvent is not available. Skipping analytics logging.');
    }
  }

  static showUserFeedback(message) {
    const MAX_NOTIFICATIONS = 3;
    const NOTIFICATION_CLASS = 'error-notification'; // Used to count existing notifications
    const notificationId = 'tizentube-error-notification-singleton'; // ID for the reusable notification element

    // Limit the number of visible notifications to avoid cluttering the UI
    const existingNotifications = document.querySelectorAll(`.${NOTIFICATION_CLASS}`);
    if (existingNotifications.length >= MAX_NOTIFICATIONS && !document.getElementById(notificationId)) {
      // If max is reached and we are about to create a new one (not update the singleton),
      // remove the oldest one that is not the singleton.
      let oldestNonSingleton = null;
      for (let i = 0; i < existingNotifications.length; i++) {
          if (existingNotifications[i].id !== notificationId) {
              oldestNonSingleton = existingNotifications[i];
              break;
          }
      }
      if (oldestNonSingleton) oldestNonSingleton.remove();
      // If all existing are singletons (should not happen if ID is unique), or if we want a hard limit,
      // we could also just return here:
      // if (document.querySelectorAll(`.${NOTIFICATION_CLASS}`).length > MAX_NOTIFICATIONS) return;
    }

    let notification = document.getElementById(notificationId);

    if (notification) {
      // Reuse existing notification element
      notification.textContent = message;
      if (notification.timerId) {
        clearTimeout(notification.timerId);
      }
    } else {
      // Create new notification element if it doesn't exist
      notification = document.createElement('div');
      notification.id = notificationId;
      notification.className = NOTIFICATION_CLASS; // General class for styling and counting
      notification.textContent = message;
      document.body.appendChild(notification);
    }

    // Apply basic styles (ideally, most styling comes from styles.css)
    notification.style.position = 'fixed';
    notification.style.bottom = '20px';
    notification.style.right = '20px';
    notification.style.padding = '10px 20px';
    notification.style.background = 'rgba(200, 0, 0, 0.9)';
    notification.style.color = 'white';
    notification.style.borderRadius = '5px';
    notification.style.zIndex = '2000';
    notification.style.boxShadow = '0 0 10px rgba(0,0,0,0.5)';
    // Ensure it's visible
    notification.style.display = 'block';


    notification.timerId = setTimeout(() => {
      // Check if the element is still in the DOM before trying to remove
      if (notification.parentNode) {
        notification.remove();
      }
    }, 5000);
  }
}

// Make ErrorHandler globally available if not using ES6 modules.
// For ES6 modules, ensure 'export class ErrorHandler ...' and import where needed.
// window.ErrorHandler = ErrorHandler;
export { ErrorHandler };
