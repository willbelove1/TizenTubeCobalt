// voice-search.js
import { ErrorHandler } from './error-handler.js';
import { fetchWithRetry } from './api-utils.js';

class VoiceSearch {
  constructor() {
    this.recognition = null;
    this.isListening = false;
    this.commands = new Map();
    // Attempt to set up speech recognition, handle error if it fails.
    // No user-facing error message here as it's constructor-time.
    // The app might still function without voice search.
    try {
        this.setupSpeechRecognition();
        this.setupVoiceCommands(); // Only setup commands if recognition is available
    } catch(error) {
        console.error("[VoiceSearch.constructor] Failed to setup speech recognition on init:", error.message);
        // ErrorHandler.handle might be too intrusive here during startup.
        // A flag could be set, or a silent log to analytics.
        // For now, just console log. The setupSpeechRecognition will handle user feedback.
    }
    console.log('[VoiceSearch] Initialized.');
  }

  setupSpeechRecognition() {
    // This method is already wrapped in a try-catch in the constructor.
    // The try-catch here is for internal robustness of this specific method.
    try {
      const SpeechRecognitionAPI = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SpeechRecognitionAPI) {
        throw new Error('SpeechRecognition API not supported in this browser.');
      }
      this.recognition = new SpeechRecognitionAPI();
      this.recognition.continuous = false; // Stop listening after first result
      this.recognition.interimResults = true; // Get interim results
      this.recognition.lang = 'vi-VN'; // Default to Vietnamese

      this.recognition.onresult = (event) => this.handleResult(event);
      this.recognition.onerror = (event) => this.handleError(event); // `event.error` contains the error name
      this.recognition.onend = () => this.handleEnd();
      console.log('[VoiceSearch] Speech recognition setup complete.');
    } catch (error) {
      // This ErrorHandler call is appropriate as it indicates a core feature failure.
      ErrorHandler.handle(error, 'VoiceSearch.setupSpeechRecognition', 'Tìm kiếm bằng giọng nói không được hỗ trợ trên trình duyệt này.');
      this.recognition = null; // Ensure recognition is null if setup fails
    }
  }

  setupVoiceCommands() {
    if (!this.recognition) return; // Don't setup commands if recognition is not available

    // Using the provided flexible command structure
    const commandsByLang = {
      'vi-VN': {
        'tìm kiếm': (query) => this.performSearch(query),
        'phát': () => this.playVideo(),
        'tạm dừng': () => this.pauseVideo(),
        'tăng âm lượng': () => this.adjustVolume(0.1),
        'giảm âm lượng': () => this.adjustVolume(-0.1),
        'video tiếp theo': () => this.nextVideo(),
        'video trước': () => this.previousVideo(),
      },
      'en-US': { // Example for English
        'search': (query) => this.performSearch(query),
        'play': () => this.playVideo(),
        'pause': () => this.pauseVideo(),
        'volume up': () => this.adjustVolume(0.1),
        'volume down': () => this.adjustVolume(-0.1),
        'next video': () => this.nextVideo(),
        'previous video': () => this.previousVideo(),
      }
    };
    // Default to vi-VN if current lang not in map, or if recognition.lang is not set
    const currentLangCommands = commandsByLang[this.recognition.lang] || commandsByLang['vi-VN'];
    this.commands = new Map(Object.entries(currentLangCommands));
    console.log(`[VoiceSearch] Voice commands setup for lang: ${this.recognition.lang || 'vi-VN'}`);
  }

  startListening() {
    if (!this.recognition) {
      ErrorHandler.handle(new Error("Speech recognition not available"), 'VoiceSearch.startListening', 'Tính năng giọng nói không sẵn sàng.');
      return;
    }
    if (this.isListening) {
      console.warn('[VoiceSearch] Already listening.');
      return;
    }
    try {
      this.isListening = true;
      this.recognition.start();
      this.showListeningIndicator();
      console.log('[VoiceSearch] Started listening.');
    } catch (error) {
      this.isListening = false; // Reset state
      ErrorHandler.handle(error, 'VoiceSearch.startListening', 'Không thể bắt đầu nhận diện giọng nói.');
    }
  }

  handleResult(event) {
    if (!event.results) return;
    try {
      let transcript = '';
      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript;
        } else {
          this.updateTranscript(event.results[i][0].transcript);
        }
      }
      transcript = transcript.toLowerCase().trim();

      if (transcript && event.results[event.results.length - 1].isFinal) {
        console.log(`[VoiceSearch] Final transcript: ${transcript}`);
        this.processCommand(transcript);
      }
    } catch (error) {
      ErrorHandler.handle(error, 'VoiceSearch.handleResult', 'Lỗi xử lý kết quả giọng nói.');
    }
  }

  processCommand(transcript) {
    if (!transcript) return;
    console.log(`[VoiceSearch] Processing command: ${transcript}`);
    try {
      for (const [commandKey, action] of this.commands) {
        if (transcript.startsWith(commandKey)) { // Use startsWith for more precise command matching
          const remainingText = transcript.substring(commandKey.length).trim();
          action(remainingText); // Pass query part to action
          console.log(`[VoiceSearch] Executed command: ${commandKey}`);
          return;
        }
      }
      // If no specific command matched, assume the whole transcript is a search query
      console.log(`[VoiceSearch] No specific command matched, performing search for: ${transcript}`);
      this.performSearch(transcript);
    } catch (error) {
      ErrorHandler.handle(error, 'VoiceSearch.processCommand', 'Lỗi xử lý lệnh giọng nói.');
    }
  }

  async performSearch(query) {
    if (!query || query.trim() === '') {
        console.warn('[VoiceSearch.performSearch] Empty query, search aborted.');
        return;
    }
    console.log(`[VoiceSearch] Performing search for: ${query}`);
    this.showSearchIndicator(query);
    try {
      const searchResults = await this.searchAPI(query);
      // displaySearchResults should be a method in this class or called externally
      if (typeof this.displaySearchResults === 'function') {
        this.displaySearchResults(searchResults);
      } else {
        console.warn('[VoiceSearch] displaySearchResults method not implemented.');
        // Fallback or log: console.log("Search results:", searchResults);
      }
    } catch (error) {
      // Error already handled by searchAPI if it's a fetch error.
      // This catch is for other unexpected errors or if searchAPI doesn't re-throw.
      // Since searchAPI is designed to re-throw, this ErrorHandler call might be redundant.
      // ErrorHandler.handle(error, 'VoiceSearch.performSearch', 'Không thể thực hiện tìm kiếm. Vui lòng thử lại.');
      console.error(`[VoiceSearch.performSearch] Search failed for query "${query}": ${error.message}`);
    }
  }

  async searchAPI(query) {
    console.log(`[VoiceSearch] Calling search API for: ${query}`);
    const apiKey = 'YOUR_GEMINI_API_KEY'; // Placeholder
    if (apiKey === 'YOUR_GEMINI_API_KEY') {
        const keyError = new Error('Gemini API key not configured.');
        ErrorHandler.handle(keyError, 'VoiceSearch.searchAPI', 'API Key cho tìm kiếm chưa được cấu hình.');
        throw keyError;
    }

    try {
      const responseData = await fetchWithRetry(`https://api.gemini.com/v1/search?q=${encodeURIComponent(query)}`, {
        method: 'POST', // Assuming POST as per typical Gemini API patterns if body is sent
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}` // Corrected to use apiKey
        },
        // Body might be needed depending on Gemini API spec, e.g., language
        body: JSON.stringify({ query, lang: this.recognition?.lang || 'vi-VN' })
      });
      // fetchWithRetry returns parsed JSON or throws.
      // If it returns null (e.g. 204 or after handling error itself), treat as no results or error.
      if (responseData === null || !responseData.results) {
        console.warn('[VoiceSearch.searchAPI] No results or invalid data from search API.');
        return []; // Return empty array for no results
      }
      return responseData.results;
    } catch (error) {
      // fetchWithRetry will call ErrorHandler.handle on final failure.
      // This catch is to allow logging or specific actions here before re-throwing.
      console.error(`[VoiceSearch.searchAPI] Error connecting to search API: ${error.message}`);
      // ErrorHandler.handle(error, 'VoiceSearch.searchAPI', 'Lỗi kết nối API tìm kiếm.'); // Redundant if fetchWithRetry handles it.
      throw error; // Re-throw to allow performSearch to also catch if needed.
    }
  }

  // Placeholder - actual implementation would render results to UI
  displaySearchResults(results) {
    console.log('[VoiceSearch] Displaying search results:', results);
    // Example:
    // const resultsContainer = document.getElementById('search-results');
    // if (!resultsContainer) return;
    // resultsContainer.innerHTML = ''; // Clear previous
    // if (!results || results.length === 0) {
    //   resultsContainer.textContent = 'Không tìm thấy kết quả nào.';
    //   return;
    // }
    // results.forEach(result => {
    //   const item = document.createElement('div');
    //   item.textContent = result.title; // Adjust based on actual result structure
    //   resultsContainer.appendChild(item);
    // });
  }

  showSearchIndicator(query) {
    this._removeIndicator('.search-indicator'); // Remove previous if any
    const indicator = document.createElement('div');
    indicator.className = 'search-indicator';
    indicator.textContent = `Đang tìm kiếm: "${query}"...`;
    document.body.appendChild(indicator);
    setTimeout(() => this._removeIndicator(indicator), 3000);
  }

  showListeningIndicator() {
    this._removeIndicator('.listening-indicator'); // Remove previous if any
    const indicator = document.createElement('div');
    indicator.className = 'listening-indicator';
    indicator.textContent = 'Đang nghe...';
    document.body.appendChild(indicator);
  }

  updateTranscript(transcript) {
    const indicator = document.querySelector('.listening-indicator');
    if (indicator) {
      indicator.textContent = `Đang nghe: ${transcript}...`;
    }
  }

  // Generic method to remove an indicator
  _removeIndicator(selectorOrElement) {
    const element = typeof selectorOrElement === 'string' ? document.querySelector(selectorOrElement) : selectorOrElement;
    if (element && element.parentNode) {
      element.remove();
    }
  }

  // showError method was in original spec, but ErrorHandler.showUserFeedback is now preferred.
  // Keeping for reference or if specific non-ErrorHandler messages are needed.
  // showError(message) {
  //   ErrorHandler.handle(new Error(message), 'VoiceSearch.showError', message);
  // }

  playVideo() {
    try {
      const video = document.querySelector('video');
      if (video) video.play();
      else console.warn('[VoiceSearch.playVideo] No video element found.');
    } catch (error) {
      ErrorHandler.handle(error, 'VoiceSearch.playVideo', 'Không thể phát video.');
    }
  }

  pauseVideo() {
    try {
      const video = document.querySelector('video');
      if (video) video.pause();
      else console.warn('[VoiceSearch.pauseVideo] No video element found.');
    } catch (error) {
      ErrorHandler.handle(error, 'VoiceSearch.pauseVideo', 'Không thể tạm dừng video.');
    }
  }

  adjustVolume(change) {
    try {
      const video = document.querySelector('video');
      if (video) {
        let newVolume = video.volume + change;
        video.volume = Math.max(0, Math.min(1, newVolume)); // Clamp between 0 and 1
        console.log(`[VoiceSearch] Volume adjusted to ${video.volume}`);
      } else {
        console.warn('[VoiceSearch.adjustVolume] No video element found.');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'VoiceSearch.adjustVolume', 'Không thể điều chỉnh âm lượng.');
    }
  }

  nextVideo() {
    try {
      console.log('[VoiceSearch] nextVideo command received.');
      // Assuming a global stateManager or a more specific playlist manager
      if (window.stateManager && typeof window.stateManager.getState === 'function' && typeof window.stateManager.setState === 'function') {
        const currentIndex = window.stateManager.getState('currentVideoIndex') || 0;
        window.stateManager.setState('currentVideoIndex', currentIndex + 1);
      } else {
        console.warn('[VoiceSearch.nextVideo] stateManager not available for playlist navigation.');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'VoiceSearch.nextVideo', 'Không thể chuyển video tiếp theo.');
    }
  }

  previousVideo() {
    try {
      console.log('[VoiceSearch] previousVideo command received.');
      if (window.stateManager && typeof window.stateManager.getState === 'function' && typeof window.stateManager.setState === 'function') {
        const currentIndex = window.stateManager.getState('currentVideoIndex') || 0;
        if (currentIndex > 0) {
          window.stateManager.setState('currentVideoIndex', currentIndex - 1);
        }
      } else {
        console.warn('[VoiceSearch.previousVideo] stateManager not available for playlist navigation.');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'VoiceSearch.previousVideo', 'Không thể chuyển video trước.');
    }
  }

  getAuthToken() {
    // This should ideally use AuthManager if it's available globally
    // For now, sticking to localStorage as per original spec for this class
    return localStorage.getItem('tizentube_token') || '';
  }

  handleError(event) {
    // event.error contains the error type, e.g., 'network', 'no-speech', 'audio-capture', 'not-allowed', etc.
    const errorMessage = `Lỗi nhận diện giọng nói: ${event.error}`;
    ErrorHandler.handle(new Error(event.error), 'VoiceSearch.recognitionError', errorMessage);
    this.isListening = false;
    this._removeIndicator('.listening-indicator');
  }

  handleEnd() {
    this.isListening = false;
    this._removeIndicator('.listening-indicator');
    console.log('[VoiceSearch] Listening ended.');
  }
}

export { VoiceSearch };
