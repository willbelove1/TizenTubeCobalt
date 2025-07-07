// language-manager.js
import { ErrorHandler } from './error-handler.js';
import { fetchWithRetry } from './api-utils.js';

class LanguageManager {
  constructor(options = {}) {
    this.defaultLang = options.defaultLang || 'vi-VN';
    this.currentLang = this.defaultLang;
    this.translations = new Map(); // lang -> { key: value }
    this.supportedLangs = options.supportedLangs || ['vi-VN', 'en-US', 'ja-JP', 'ko-KR', 'zh-CN'];
    this.localesBasePath = options.localesBasePath || '/locales'; // Base path for translation files
    this.translationApiEndpoint = options.translationApiEndpoint || 'https://api.tizentube.com/v1/translate';
    this.localStorageKey = 'tizentube_lang';

    this._initialize();
    console.log('[LanguageManager] Initialized.');
  }

  async _initialize() {
    try {
      const savedLang = localStorage.getItem(this.localStorageKey);
      if (savedLang && this.supportedLangs.includes(savedLang)) {
        this.currentLang = savedLang;
      }
      console.log(`[LanguageManager] Current language set to: ${this.currentLang}`);
      await this.loadTranslationsForLang(this.currentLang); // Load current language first
      this.updateUI(); // Update UI after initial load
      // Optionally, load all other supported languages in the background
      // this.loadAllSupportedTranslationsInBackground();
    } catch (error) {
      ErrorHandler.handle(error, 'LanguageManager._initialize', 'Lỗi khởi tạo trình quản lý ngôn ngữ.');
    }
  }

  async loadTranslationsForLang(lang) {
    if (!this.supportedLangs.includes(lang)) {
      console.warn(`[LanguageManager] Attempted to load unsupported language: ${lang}`);
      return;
    }
    if (this.translations.has(lang)) {
      console.log(`[LanguageManager] Translations for ${lang} already loaded.`);
      return; // Already loaded
    }

    const filePath = `${this.localesBasePath}/${lang}.json`;
    console.log(`[LanguageManager] Loading translations for ${lang} from ${filePath}`);
    try {
      const translationData = await fetchWithRetry(filePath);
      if (translationData) {
        this.translations.set(lang, translationData);
        console.log(`[LanguageManager] Successfully loaded translations for ${lang}.`);
      } else {
        // fetchWithRetry would have thrown an error if file not found or parsing failed.
        // This case might be if fetchWithRetry returns null for an empty valid JSON (e.g. "{}").
        console.warn(`[LanguageManager] No translation data returned for ${lang}, setting empty map.`);
        this.translations.set(lang, {});
      }
    } catch (error) {
      // ErrorHandler.handle is called by fetchWithRetry for network/parse errors.
      // We might want a specific message here if the file is critical.
      console.error(`[LanguageManager] Failed to load translations for ${lang} from ${filePath}: ${error.message}`);
      // Don't show user-facing error for every missing language file, could be noisy.
      // Only critical language load failure should alert user, e.g. default language.
      if (lang === this.defaultLang && !this.translations.has(lang)) {
          ErrorHandler.handle(error, 'LanguageManager.loadTranslationsForLang', `Không thể tải tệp ngôn ngữ mặc định (${lang}).`);
      }
      // Set an empty map to prevent repeated load attempts for this failed lang
      if (!this.translations.has(lang)) {
          this.translations.set(lang, {});
      }
    }
  }

  async loadAllSupportedTranslationsInBackground() {
    console.log('[LanguageManager] Loading all supported translations in background...');
    for (const lang of this.supportedLangs) {
      if (!this.translations.has(lang)) {
        await this.loadTranslationsForLang(lang); // await to load one by one to not overwhelm network
      }
    }
    console.log('[LanguageManager] Background loading of all translations complete.');
  }

  async setLanguage(lang) {
    if (!this.supportedLangs.includes(lang)) {
      ErrorHandler.handle(new Error(`Unsupported language: ${lang}`), 'LanguageManager.setLanguage', 'Ngôn ngữ không được hỗ trợ.');
      return;
    }
    if (lang === this.currentLang && this.translations.has(lang)) {
      console.log(`[LanguageManager] Language ${lang} is already current and loaded.`);
      this.updateUI(); // Still update UI in case DOM changed
      return;
    }

    console.log(`[LanguageManager] Setting language to: ${lang}`);
    this.currentLang = lang;
    try {
      localStorage.setItem(this.localStorageKey, lang);
    } catch (error) {
      ErrorHandler.handle(error, 'LanguageManager.setLanguage.localStorage', 'Không thể lưu lựa chọn ngôn ngữ.');
    }

    if (!this.translations.has(lang)) {
      await this.loadTranslationsForLang(lang);
    }

    // Check if loading failed for the new language
    if (!this.translations.get(lang) || Object.keys(this.translations.get(lang)).length === 0) {
        console.warn(`[LanguageManager] Translations for ${lang} are empty or failed to load. UI might not fully update.`);
        // Potentially revert to defaultLang or previous valid lang if critical
    }

    this.updateUI();
  }

  updateUI() {
    console.log(`[LanguageManager] Updating UI for language: ${this.currentLang}`);
    try {
      const elements = document.querySelectorAll('[data-i18n]');
      elements.forEach(element => {
        const key = element.dataset.i18n;
        if (key) {
          const translation = this.getTranslation(key);
          // Check for specific attributes to update, e.g., placeholder, title, or textContent
          if (element.hasAttribute('data-i18n-target')) {
            const targetAttr = element.dataset.i18nTarget;
            if (targetAttr === 'placeholder' && element.placeholder !== undefined) {
              element.placeholder = translation;
            } else if (targetAttr === 'title' && element.title !== undefined) {
              element.title = translation;
            } else { // Default to textContent or specific handling
              element.textContent = translation;
            }
          } else {
            element.textContent = translation; // Default to textContent
          }
        }
      });
      // Dispatch a custom event to notify components that language has changed
      document.dispatchEvent(new CustomEvent('languagechange', { detail: { lang: this.currentLang } }));
      console.log('[LanguageManager] UI update complete.');
    } catch (error) {
      ErrorHandler.handle(error, 'LanguageManager.updateUI', 'Lỗi cập nhật giao diện theo ngôn ngữ.');
    }
  }

  getTranslation(key, fallbackString = null) {
    if (!key) return fallbackString || '';

    const currentLangTranslations = this.translations.get(this.currentLang);
    if (currentLangTranslations && typeof currentLangTranslations[key] === 'string') {
      return currentLangTranslations[key];
    }

    // Fallback to default language if key not found in current language
    if (this.currentLang !== this.defaultLang) {
      const defaultLangTranslations = this.translations.get(this.defaultLang);
      if (defaultLangTranslations && typeof defaultLangTranslations[key] === 'string') {
        console.warn(`[LanguageManager] Key '${key}' not found in '${this.currentLang}', using default '${this.defaultLang}'.`);
        return defaultLangTranslations[key];
      }
    }

    console.warn(`[LanguageManager] Translation key '${key}' not found in '${this.currentLang}' or default language.`);
    return fallbackString || key; // Return the key itself or provided fallback if not found
  }

  async translateElement(element, textToTranslate, targetLang) {
    if (!(element instanceof HTMLElement)) {
        ErrorHandler.handle(new Error('Invalid element provided for translateElement'), 'LanguageManager.translateElement', 'Element không hợp lệ để dịch.');
        return;
    }
    const text = textToTranslate || element.textContent;
    const effectiveTargetLang = targetLang || this.currentLang;

    if (!text) {
        console.warn('[LanguageManager.translateElement] No text provided or found on element to translate.');
        return;
    }

    console.log(`[LanguageManager] Translating element content to ${effectiveTargetLang}: "${text.substring(0, 50)}..."`);
    const apiKey = 'YOUR_GEMINI_API_KEY'; // Placeholder, should be managed securely
    if (apiKey === 'YOUR_GEMINI_API_KEY') {
        const keyError = new Error('Gemini API key not configured for LanguageManager element translation.');
        ErrorHandler.handle(keyError, 'LanguageManager.translateElement', 'API Key cho dịch thuật chưa được cấu hình.');
        // Do not throw, just update element with error message or original text
        element.textContent = `${text} (Lỗi dịch: API key không hợp lệ)`;
        return;
    }

    try {
      const responseData = await fetchWithRetry(this.translationApiEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}` // Use actual token if needed for TizenTube API
        },
        body: JSON.stringify({ text, targetLang: effectiveTargetLang })
      });

      if (responseData && responseData.translatedText) {
        element.textContent = responseData.translatedText;
        console.log('[LanguageManager] Element content translated successfully.');
      } else {
        throw new Error('Invalid or empty response from on-the-fly translation API.');
      }
    } catch (error) {
      // fetchWithRetry calls ErrorHandler.handle, but we might want a more specific message on the element.
      console.error(`[LanguageManager.translateElement] On-the-fly translation failed: ${error.message}`);
      element.textContent = `${text} (Lỗi dịch)`;
      // ErrorHandler.handle(error, 'LanguageManager.translateElement', 'Không thể dịch nội dung.'); // This might be redundant
    }
  }

  getAuthToken() {
    // This is for the TizenTube API, if different from Gemini API key
    return localStorage.getItem('tizentube_token') || '';
  }

  destroy() {
    // Cleanup if needed, e.g., remove event listeners if any were added by this manager
    this.translations.clear();
    console.log('[LanguageManager] Destroyed.');
  }
}

export { LanguageManager };
