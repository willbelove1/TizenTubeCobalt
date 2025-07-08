// subtitle-manager.js
import { ErrorHandler } from './error-handler.js';
import { fetchWithRetry } from './api-utils.js';

class SubtitleManager {
  constructor(videoElement) {
    if (!videoElement || !(videoElement instanceof HTMLVideoElement)) {
      const error = new Error('SubtitleManager requires a valid HTMLVideoElement.');
      // No ErrorHandler here as it's a programming error during instantiation.
      console.error('[SubtitleManager.constructor]', error.message);
      throw error;
    }
    this.video = videoElement;
    // The user's latest spec for Gemini integration in SubtitleManager:
    this.apiEndpoint = 'https://api.gemini.com/v1/translate'; // Using Gemini
    this.currentTrack = null;
    this.activeStyleElement = null; // To keep track of the injected style element
    this.settings = {
      fontSize: 16, // px
      position: 'bottom', // 'bottom', 'top', 'middle' (simplified for ::cue)
      color: '#FFFFFF',
      background: 'rgba(0,0,0,0.7)',
      // Additional settings from original doc, not directly mappable to simple ::cue
      // customFont: null,
      // textOutline: null,
    };
    console.log('[SubtitleManager] Initialized.');
    this.applyStyles(); // Apply initial styles

    // Cache for translateText results
    this.translationCache = new Map();
    this.MAX_CACHE_SIZE = 50; // Store up to 50 translations
  }

  async autoTranslate(targetLang) {
    if (!targetLang) {
      ErrorHandler.handle(new Error('Target language not specified for autoTranslate.'), 'SubtitleManager.autoTranslate', 'Vui lòng chọn ngôn ngữ dịch.');
      return;
    }
    console.log(`[SubtitleManager] Auto-translating to ${targetLang}`);
    try {
      const currentTime = this.video.currentTime;
      const transcript = this.getCurrentTranscript(); // Changed from async as per user spec

      if (!transcript || !transcript.text) {
        throw new Error('No active or valid transcript found to translate.');
      }

      console.log(`[SubtitleManager] Current transcript for translation: "${transcript.text}" starting at ${transcript.startTime}`);
      const translatedData = await this.translateText(transcript.text, targetLang);

      if (!translatedData || !translatedData.translatedText || !Array.isArray(translatedData.segments)) {
         throw new Error('Invalid response from translation API.');
      }

      // applyTranslatedSubtitles expects { lang: 'xx', segments: [{text: "..."}] }
      // Gemini might return { translatedText: "full text", lang: "xx" } or similar.
      // We need to adapt this. The user spec for Gemini in SubtitleManager was:
      // `body: JSON.stringify({ text, targetLang })` and `return response;`
      // Let's assume `response` (now `translatedData`) from Gemini is an object like:
      // { translatedText: "...", lang: "targetLang", segments: [{text: "...", startTime: S, endTime: S}] }
      // If Gemini only returns full text, segments need to be created.
      // The user spec for parseTranslatedCues implies segments exist in translatedText.

      this.applyTranslatedSubtitles(translatedData, transcript.startTime); // Pass original transcript start time
      console.log(`[SubtitleManager] Successfully applied translated subtitles for ${targetLang}.`);

    } catch (error) {
      ErrorHandler.handle(error, 'SubtitleManager.autoTranslate', 'Không thể tự động dịch phụ đề.');
    }
  }

  async translateText(text, targetLang) {
    const cacheKey = `${targetLang}::${text}`;
    if (this.translationCache.has(cacheKey)) {
      const cachedEntry = this.translationCache.get(cacheKey);
      // If storing promises, return the promise. If storing resolved data, return that.
      // For simplicity, let's assume we store resolved data and update timestamp for LRU.
      cachedEntry.lastAccessed = Date.now();
      this.translationCache.set(cacheKey, cachedEntry); // Update position for LRU if implemented that way
      console.log(`[SubtitleManager] Translation cache HIT for: "${text.substring(0,30)}..." -> ${targetLang}`);
      return cachedEntry.data;
    }
    console.log(`[SubtitleManager] Translation cache MISS. Calling API for text: "${text.substring(0,30)}..." -> ${targetLang}`);

    const apiKey = 'YOUR_GEMINI_API_KEY'; // Placeholder
    if (apiKey === 'YOUR_GEMINI_API_KEY') {
        const keyError = new Error('Gemini API key not configured for SubtitleManager.');
        ErrorHandler.handle(keyError, 'SubtitleManager.translateText', 'API Key cho dịch thuật chưa được cấu hình.');
        throw keyError;
    }

    try {
      const translationPromise = fetchWithRetry(this.apiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({ text, targetLang })
      });

      // Optional: Store promise in cache immediately to handle concurrent requests
      // this.translationCache.set(cacheKey, { promise: translationPromise, timestamp: Date.now() });

      const responseData = await translationPromise;

      if (responseData === null) {
        // this.translationCache.delete(cacheKey); // Remove failed promise entry
        throw new Error('Translation API returned an empty response.');
      }

      console.log('[SubtitleManager] Translation API response:', responseData);

      // Cache the successful result before returning
      if (this.translationCache.size >= this.MAX_CACHE_SIZE) {
        // Simple LRU: find and delete the oldest entry (smallest timestamp)
        let oldestKey = null;
        let oldestTimestamp = Infinity;
        for (const [key, value] of this.translationCache.entries()) {
          if (value.timestamp < oldestTimestamp) {
            oldestTimestamp = value.timestamp;
            oldestKey = key;
          }
        }
        if (oldestKey) this.translationCache.delete(oldestKey);
      }
      this.translationCache.set(cacheKey, { data: responseData, timestamp: Date.now(), lastAccessed: Date.now() });

      return responseData;
    } catch (error) {
      // this.translationCache.delete(cacheKey); // Remove failed promise entry if that strategy was used
      console.error(`[SubtitleManager.translateText] Error connecting to translation API: ${error.message}`);
      throw error;
    }
  }

  applyTranslatedSubtitles(translatedData, originalStartTime) {
    if (!this.video.textTracks) {
        console.warn('[SubtitleManager] TextTracks API not available on video element.');
        return;
    }
    if (!translatedData || !translatedData.lang || !Array.isArray(translatedData.segments)) {
        ErrorHandler.handle(new Error('Invalid translated data for subtitles'), 'SubtitleManager.applyTranslatedSubtitles', 'Dữ liệu dịch không hợp lệ.');
        return;
    }

    // Remove any existing translated track to avoid duplicates
    if (this.currentTrack) {
      this.currentTrack.mode = 'disabled';
      // Natively, you can't truly "remove" a track once added, just disable it.
      // Some libraries might offer removal, or we could manage tracks in an array.
    }

    const trackLabel = `Translated (${translatedData.lang})`;
    const newTrack = this.video.addTextTrack('subtitles', trackLabel, translatedData.lang);
    newTrack.mode = 'showing'; // Make it visible

    const cues = this.parseTranslatedCues(translatedData, originalStartTime);
    cues.forEach(cue => {
      if (cue) newTrack.addCue(cue);
    });

    this.currentTrack = newTrack;
    console.log(`[SubtitleManager] Applied translated subtitles. Track: ${trackLabel}, Cues: ${cues.length}`);
  }

  updateSettings(newSettings) {
    this.settings = { ...this.settings, ...newSettings };
    console.log('[SubtitleManager] Settings updated:', this.settings);
    this.applyStyles();
  }

  applyStyles() {
    // Remove old style element if it exists
    if (this.activeStyleElement && this.activeStyleElement.parentNode) {
      this.activeStyleElement.parentNode.removeChild(this.activeStyleElement);
    }

    const style = document.createElement('style');
    style.id = 'tizentube-subtitle-styles'; // Add an ID for easier removal/management

    // Constructing position. A simple percentage from bottom is common.
    // For more complex positioning (top, middle), ::cue might be limited.
    // CSS `vertical-align` on ::cue is not standard. `line` property is more common.
    // We'll simplify 'position' to affect ::cue line property.
    let positionStyle = 'line: auto;'; // Default browser positioning
    if (this.settings.position === 'bottom') {
        positionStyle = 'line: 90%;'; // Example: 90% from top (near bottom)
    } else if (this.settings.position === 'top') {
        positionStyle = 'line: 10%;'; // Example: 10% from top
    } else if (this.settings.position === 'middle') {
        positionStyle = 'line: 50%;';
    }


    style.textContent = `
      ::cue {
        font-size: ${this.settings.fontSize}px !important;
        color: ${this.settings.color} !important;
        background-color: ${this.settings.background} !important; /* Use background-color for ::cue */
        /* text-shadow, font-family can also be applied here */
        ${positionStyle}
      }
    `;
    document.head.appendChild(style);
    this.activeStyleElement = style;
    console.log('[SubtitleManager] Subtitle styles applied.');
  }

  parseTranslatedCues(translatedDataObject, baseStartTime) {
    // User spec: translatedDataObject has { segments: [{text: "...", startTime: S, endTime: S}] }
    // baseStartTime is the start time of the original (untranslated) transcript segment.
    if (!translatedDataObject || !Array.isArray(translatedDataObject.segments)) return [];

    return translatedDataObject.segments.map((segment, index) => {
      if (!segment || typeof segment.text === 'undefined') return null;

      // Use segment's own startTime/endTime if provided by Gemini, relative to the input text.
      // If not, fall back to the original logic (2s duration per segment).
      const start = typeof segment.startTime === 'number' ? baseStartTime + segment.startTime : baseStartTime + (index * 2);
      const end = typeof segment.endTime === 'number' ? baseStartTime + segment.endTime : start + 2;

      if (start >= end) { // Basic validation for cue timings
          console.warn(`[SubtitleManager] Invalid cue timing for segment "${segment.text}": start ${start}, end ${end}`);
          return null;
      }
      try {
        return new VTTCue(start, end, segment.text);
      } catch(e) {
        console.error(`[SubtitleManager] Failed to create VTTCue: ${e.message}`, {start, end, text: segment.text});
        return null;
      }
    }).filter(cue => cue !== null); // Filter out any null cues from invalid segments
  }

  getCurrentTranscript() {
    // User spec: `const track = Array.from(this.video.textTracks).find(t => t.kind === 'subtitles' && t.mode === 'showing'); return track?.activeCues?.[0] || null;`
    // This finds the *first* active cue in the *first* showing subtitles track.
    if (!this.video.textTracks || this.video.textTracks.length === 0) {
      console.warn('[SubtitleManager.getCurrentTranscript] No text tracks found on video.');
      return null;
    }

    const showingTracks = Array.from(this.video.textTracks).filter(t => t.mode === 'showing' && t.kind === 'subtitles');

    if (showingTracks.length === 0) {
      // console.log('[SubtitleManager.getCurrentTranscript] No subtitle track is currently showing.');
      return null;
    }

    // Prefer the track that was set as 'this.currentTrack' if it's still showing,
    // otherwise, pick the first one. This helps if multiple subtitle tracks are 'showing'.
    let activeTrack = this.currentTrack && this.currentTrack.mode === 'showing' ? this.currentTrack : showingTracks[0];

    if (!activeTrack || !activeTrack.activeCues) {
      // console.log('[SubtitleManager.getCurrentTranscript] No active cues in the showing track.');
      return null;
    }

    const firstActiveCue = activeTrack.activeCues[0];
    if (firstActiveCue) {
      // console.log('[SubtitleManager.getCurrentTranscript] Found active cue:', firstActiveCue.text);
      return { text: firstActiveCue.text, startTime: firstActiveCue.startTime, endTime: firstActiveCue.endTime };
    }
    // console.log('[SubtitleManager.getCurrentTranscript] No active cue found at current time.');
    return null;
  }

  getAuthToken() {
    // This should ideally use AuthManager if it's available globally
    return localStorage.getItem('tizentube_token') || '';
  }

  // showError method was in original spec, now handled by ErrorHandler
  // showError(message) {
  //   ErrorHandler.handle(new Error(message), 'SubtitleManager.showError', message);
  // }
}

export { SubtitleManager };
