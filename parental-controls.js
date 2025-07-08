// parental-controls.js
import { ErrorHandler } from './error-handler.js';
// import { fetchWithRetry } from './api-utils.js'; // If needed for fetchVideoMetadata

class ParentalControls {
  constructor() {
    this.defaultRestrictions = {
      isEnabled: false,
      pin: null,
      ageRating: null,
      maxDailyWatchTimeSeconds: null,
      restrictedHours: { start: null, end: null },
      blockedCategories: []
    };
    this.restrictions = { ...this.defaultRestrictions };
    this.localStorageKey = 'tizentube_parental_restrictions';
    this.watchTimeTodayKey = 'tizentube_watch_time_today';
    this.watchTimeTodaySeconds = 0;

    this.uiContainer = null;
    this.sessionPinVerified = false;
    this.pinEntryForToggleDiv = null;
    this.settingsSectionDiv = null;
    this.categoryInput = null;
    this.blockedCategoriesListDiv = null;

    this._loadState();

    if (this.restrictions.isEnabled) {
        this.startWatchTimeTracking();
        this.startRestrictedHoursMonitoring();
    }
    console.log('[ParentalControls] Initialized. Restrictions loaded:', JSON.stringify(this.restrictions));
  }

  _createElement(tag, options = {}) {
    const el = document.createElement(tag);
    if (options.className) el.className = options.className;
    if (options.id) el.id = options.id;
    if (options.type) el.type = options.type;
    if (options.textContent) el.textContent = options.textContent;
    if (options.innerHTML) el.innerHTML = options.innerHTML;
    if (options.value !== undefined) el.value = options.value;
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
            el.addEventListener(event, listener.bind(this));
        }
    }
    return el;
  }

  renderUI(containerElement) {
    if (!containerElement || !(containerElement instanceof HTMLElement)) {
      ErrorHandler.handle(new Error("Invalid container for Parental Controls UI"), "ParentalControls.renderUI", "Không thể hiển thị giao diện kiểm soát của cha mẹ.");
      return;
    }
    this.uiContainer = containerElement;
    this.uiContainer.innerHTML = '';
    this.uiContainer.classList.add('parental-controls-ui-host');

    const wrapper = this._createElement('div', { className: 'parental-controls-wrapper' });
    wrapper.appendChild(this._createElement('h2', { textContent: 'Kiểm soát của Phụ huynh' }));

    const masterSection = this._createElement('fieldset', { className: 'pc-section pc-master-section' });
    masterSection.appendChild(this._createElement('legend', { textContent: 'Trạng thái Kiểm soát' }));
    const enableToggleInput = this._createElement('input', {
        id: 'pc-enable-toggle', type: 'checkbox', checked: this.restrictions.isEnabled,
        eventListeners: { change: this._handleMasterToggleChange }
    });
    masterSection.appendChild(this._createElement('label', {
        className: 'pc-toggle-label', htmlFor: 'pc-enable-toggle',
        children: [enableToggleInput, this._createElement('span', {textContent: 'Bật Kiểm soát của Cha mẹ'})]
    }));
    this.pinEntryForToggleDiv = this._createElement('div', { className: 'pc-pin-entry-toggle pc-pin-prompt', style: { display: 'none'} });
    masterSection.appendChild(this.pinEntryForToggleDiv);
    wrapper.appendChild(masterSection);

    this.settingsSectionDiv = this._createElement('div', { className: 'pc-settings-section', style: { display: 'none' } });

    const pinSection = this._createElement('fieldset', { className: 'pc-section pc-pin-management-section' });
    pinSection.appendChild(this._createElement('legend', { textContent: 'Quản lý PIN' }));
    pinSection.appendChild(this._createElement('label', { htmlFor: 'pc-current-pin', textContent: 'PIN hiện tại (cần để thay đổi cài đặt hoặc đổi PIN):' }));
    pinSection.appendChild(this._createElement('input', { type: 'password', id: 'pc-current-pin', placeholder: 'PIN hiện tại (4+ ký tự)' }));
    pinSection.appendChild(this._createElement('label', { htmlFor: 'pc-new-pin', textContent: 'PIN mới (để trống nếu không đổi):' }));
    pinSection.appendChild(this._createElement('input', { type: 'password', id: 'pc-new-pin', placeholder: 'PIN mới (4+ ký tự)' }));
    pinSection.appendChild(this._createElement('label', { htmlFor: 'pc-confirm-new-pin', textContent: 'Xác nhận PIN mới:' }));
    pinSection.appendChild(this._createElement('input', { type: 'password', id: 'pc-confirm-new-pin', placeholder: 'Xác nhận PIN mới' }));
    pinSection.appendChild(this._createElement('button', { id: 'pc-set-pin-btn', textContent: 'Đặt/Đổi PIN', eventListeners: { click: this._handleSetPinClick } }));
    this.settingsSectionDiv.appendChild(pinSection);

    const ageSection = this._createElement('fieldset', { className: 'pc-section pc-age-rating-section' });
    ageSection.appendChild(this._createElement('legend', { textContent: 'Giới hạn Độ tuổi' }));
    ageSection.appendChild(this._createElement('label', { htmlFor: 'pc-age-rating', textContent: 'Độ tuổi tối đa cho phép:' }));
    const ageSelect = this._createElement('select', { id: 'pc-age-rating' });
    const ageRatings = { '': 'Không giới hạn', 'G': 'G (Mọi lứa tuổi)', 'PG': 'PG (Cần hướng dẫn)', '12': '12+', '15': '15+', '18': '18+' };
    for(const [value, text] of Object.entries(ageRatings)) {
        ageSelect.appendChild(this._createElement('option', { value: value, textContent: text }));
    }
    ageSection.appendChild(ageSelect);
    this.settingsSectionDiv.appendChild(ageSection);

    const watchTimeSection = this._createElement('fieldset', { className: 'pc-section pc-watch-time-section' });
    watchTimeSection.appendChild(this._createElement('legend', { textContent: 'Giới hạn Thời gian Xem Hàng ngày' }));
    watchTimeSection.appendChild(this._createElement('label', { htmlFor: 'pc-watch-time-hours', textContent: 'Số giờ (0-23, để trống = không giới hạn):' }));
    watchTimeSection.appendChild(this._createElement('input', { type: 'number', id: 'pc-watch-time-hours', min: '0', max: '23', step: '1', placeholder: 'Giờ' }));
    watchTimeSection.appendChild(this._createElement('label', { htmlFor: 'pc-watch-time-minutes', textContent: 'Số phút (0-59):' }));
    watchTimeSection.appendChild(this._createElement('input', { type: 'number', id: 'pc-watch-time-minutes', min: '0', max: '59', step: '1', placeholder: 'Phút' }));
    this.settingsSectionDiv.appendChild(watchTimeSection);

    const restrictedHoursSection = this._createElement('fieldset', { className: 'pc-section pc-restricted-hours-section' });
    restrictedHoursSection.appendChild(this._createElement('legend', { textContent: 'Khung Giờ Hạn Chế' }));
    restrictedHoursSection.appendChild(this._createElement('label', { htmlFor: 'pc-restricted-start', textContent: 'Bắt đầu (để trống = không hạn chế):' }));
    restrictedHoursSection.appendChild(this._createElement('input', { type: 'time', id: 'pc-restricted-start' }));
    restrictedHoursSection.appendChild(this._createElement('label', { htmlFor: 'pc-restricted-end', textContent: 'Kết thúc (để trống = không hạn chế):' }));
    restrictedHoursSection.appendChild(this._createElement('input', { type: 'time', id: 'pc-restricted-end' }));
    this.settingsSectionDiv.appendChild(restrictedHoursSection);

    const categoriesSection = this._createElement('fieldset', { className: 'pc-section pc-categories-section' });
    categoriesSection.appendChild(this._createElement('legend', { textContent: 'Chặn Danh mục' }));
    categoriesSection.appendChild(this._createElement('label', { htmlFor: 'pc-add-category', textContent: 'Thêm danh mục để chặn:' }));
    this.categoryInput = this._createElement('input', { type: 'text', id: 'pc-add-category', placeholder: 'Tên danh mục' });
    categoriesSection.appendChild(this.categoryInput);
    categoriesSection.appendChild(this._createElement('button', { textContent: 'Thêm', eventListeners: { click: this._handleAddCategory }}));
    this.blockedCategoriesListDiv = this._createElement('div', { id: 'pc-blocked-categories-list', className: 'pc-categories-list' });
    categoriesSection.appendChild(this.blockedCategoriesListDiv);
    this.settingsSectionDiv.appendChild(categoriesSection);

    this.settingsSectionDiv.appendChild(this._createElement('button', {
        id: 'pc-save-settings-btn', textContent: 'Lưu Tất Cả Cài Đặt', className: 'pc-save-button',
        eventListeners: { click: this._handleSaveAllSettingsClick }
    }));
    wrapper.appendChild(this.settingsSectionDiv);
    this.uiContainer.appendChild(wrapper);

    this._updateSettingsSectionVisibility();
    if (this.restrictions.isEnabled) this.applyRestrictions();
    console.log('[ParentalControls] Detailed UI rendered.');
  }

  _updateSettingsSectionVisibility() {
    if (!this.settingsSectionDiv || !this.pinEntryForToggleDiv || !document.getElementById('pc-enable-toggle')) return;
    const isEnabled = document.getElementById('pc-enable-toggle').checked;
    if (isEnabled) {
        if (this.sessionPinVerified) {
            this.settingsSectionDiv.style.display = 'block';
            this.pinEntryForToggleDiv.innerHTML = '';
            this.pinEntryForToggleDiv.style.display = 'none';
            this._populateSettingsFields();
        } else {
            this.settingsSectionDiv.style.display = 'none';
            this._showPinPromptForToggle('Để xem và thay đổi cài đặt, vui lòng nhập PIN:', 'Xác nhận PIN', this._verifyPinForSettingsAccess);
        }
    } else {
        this.settingsSectionDiv.style.display = 'none';
        this.pinEntryForToggleDiv.innerHTML = '';
        this.pinEntryForToggleDiv.style.display = 'none';
        this.sessionPinVerified = false;
    }
  }

  _populateSettingsFields() {
    if(!document.getElementById('pc-age-rating')) return;
    try {
        const currentPinInput = document.getElementById('pc-current-pin');
        if (currentPinInput) currentPinInput.value = '';
        const newPinInput = document.getElementById('pc-new-pin');
        if (newPinInput) newPinInput.value = '';
        const confirmNewPinInput = document.getElementById('pc-confirm-new-pin');
        if (confirmNewPinInput) confirmNewPinInput.value = '';

        document.getElementById('pc-age-rating').value = this.restrictions.ageRating || '';
        const hours = this.restrictions.maxDailyWatchTimeSeconds != null ? Math.floor(this.restrictions.maxDailyWatchTimeSeconds / 3600) : '';
        const minutes = this.restrictions.maxDailyWatchTimeSeconds != null ? Math.floor((this.restrictions.maxDailyWatchTimeSeconds % 3600) / 60) : '';
        document.getElementById('pc-watch-time-hours').value = hours;
        document.getElementById('pc-watch-time-minutes').value = minutes;
        document.getElementById('pc-restricted-start').value = this.restrictions.restrictedHours.start || '';
        document.getElementById('pc-restricted-end').value = this.restrictions.restrictedHours.end || '';
        this._renderBlockedCategories();
        console.log("[ParentalControls] Settings fields populated.");
    } catch (error) {
        ErrorHandler.handle(error, "ParentalControls._populateSettingsFields", "Lỗi hiển thị cài đặt hiện tại.");
    }
  }

  _verifyPinForSettingsAccess(pinFromPrompt) {
      if (this.verifyPin(pinFromPrompt)) {
          this.sessionPinVerified = true;
          this.showUINotification('PIN chính xác. Bạn có thể xem và thay đổi cài đặt.');
          this._updateSettingsSectionVisibility();
      } else {
          ErrorHandler.handle(new Error("Incorrect PIN"), "ParentalControls.VerifySettingsAccess", "Mã PIN không đúng để truy cập cài đặt.");
      }
      const pinInputField = document.getElementById('pc-pin-toggle-input'); // Assuming this is the ID used by _showPinPromptForToggle
      if (pinInputField) pinInputField.value = '';

      if(!this.sessionPinVerified && this.pinEntryForToggleDiv) {
          this.pinEntryForToggleDiv.style.display = 'none'; // Hide if still not verified to avoid confusion
          this.pinEntryForToggleDiv.innerHTML = '';
      }
  }

  _handleMasterToggleChange(event) {
    const isEnablingIntent = event.target.checked;
    const isCurrentlyEnabled = this.restrictions.isEnabled;
    if (isEnablingIntent === isCurrentlyEnabled) {
        if(this.pinEntryForToggleDiv) {
            this.pinEntryForToggleDiv.style.display = 'none';
            this.pinEntryForToggleDiv.innerHTML = '';
        }
        return;
    }
    if (isEnablingIntent) {
        if (!this.restrictions.pin) {
             this._showPinPromptForToggle('Đặt PIN mới để bật (ít nhất 4 ký tự):', 'Đặt PIN & Bật', this._confirmEnableAndSetInitialPin);
        } else {
             this._showPinPromptForToggle('Nhập PIN để bật Kiểm soát:', 'Bật', this._confirmEnableWithExistingPin);
        }
    } else {
        if (this.restrictions.pin) {
            this._showPinPromptForToggle('Nhập PIN để tắt Kiểm soát:', 'Tắt', this._confirmDisable);
        } else {
            this._performToggleActions(false);
        }
    }
    const toggleCheckbox = document.getElementById('pc-enable-toggle');
    if(toggleCheckbox) toggleCheckbox.checked = isCurrentlyEnabled;
  }

  _showPinPromptForToggle(labelText, buttonText, confirmActionCallback) {
    if (!this.pinEntryForToggleDiv) return;
    this.pinEntryForToggleDiv.innerHTML = '';
    this.pinEntryForToggleDiv.appendChild(this._createElement('label', { htmlFor: 'pc-pin-toggle-input', textContent: labelText }));
    const pinInput = this._createElement('input', { type: 'password', id: 'pc-pin-toggle-input', placeholder: 'Mã PIN (4+ ký tự)' });
    this.pinEntryForToggleDiv.appendChild(pinInput);
    this.pinEntryForToggleDiv.appendChild(this._createElement('button', {
        textContent: buttonText,
        eventListeners: { click: () => confirmActionCallback(pinInput.value) }
    }));
    this.pinEntryForToggleDiv.style.display = 'block';
    pinInput.focus();
  }

  _performToggleActions(newStateIsEnabled) {
    this.restrictions.isEnabled = newStateIsEnabled;
    this._saveRestrictions();
    this.showUINotification(`Kiểm soát của phụ huynh đã ${this.restrictions.isEnabled ? 'bật' : 'tắt'}.`);
    const toggleCheckbox = document.getElementById('pc-enable-toggle');
    if(toggleCheckbox) toggleCheckbox.checked = this.restrictions.isEnabled;

    if (this.restrictions.isEnabled) {
        this.sessionPinVerified = true;
        this.startWatchTimeTracking();
        this.startRestrictedHoursMonitoring();
        this.applyRestrictions();
    } else {
        this.sessionPinVerified = false;
        this.stopWatchTimeTracking();
        this.stopRestrictedHoursMonitoring();
        this._unfilterAllContent();
    }
    if (this.pinEntryForToggleDiv) {
        this.pinEntryForToggleDiv.innerHTML = '';
        this.pinEntryForToggleDiv.style.display = 'none';
    }
    this._updateSettingsSectionVisibility();
  }

  _confirmEnableAndSetInitialPin(pinFromPrompt) {
    if (this.setPin(pinFromPrompt)) {
        this._performToggleActions(true);
    } else {
        const toggleCheckbox = document.getElementById('pc-enable-toggle');
        if(toggleCheckbox) toggleCheckbox.checked = false;
    }
  }

  _confirmEnableWithExistingPin(pinFromPrompt) {
    if (this.verifyPin(pinFromPrompt)) {
        this._performToggleActions(true);
    } else {
        ErrorHandler.handle(new Error("Incorrect PIN"), "ParentalControls.EnableExisting", "Mã PIN không đúng.");
        const toggleCheckbox = document.getElementById('pc-enable-toggle');
        if(toggleCheckbox) toggleCheckbox.checked = false;
    }
  }

  _confirmDisable(pinFromPrompt) {
    if (this.verifyPin(pinFromPrompt)) {
        this._performToggleActions(false);
    } else {
        ErrorHandler.handle(new Error("Incorrect PIN"), "ParentalControls.Disable", "Mã PIN không đúng.");
        const toggleCheckbox = document.getElementById('pc-enable-toggle');
        if(toggleCheckbox) toggleCheckbox.checked = true;
    }
  }

  _handleSetPinClick() {
    const currentPinInput = document.getElementById('pc-current-pin');
    const newPinInput = document.getElementById('pc-new-pin');
    const confirmNewPinInput = document.getElementById('pc-confirm-new-pin');

    if (!currentPinInput || !newPinInput || !confirmNewPinInput) {
        ErrorHandler.handle(new Error("PIN input fields not found"), "ParentalControls.SetPinUI", "Lỗi giao diện: không tìm thấy ô nhập PIN.");
        return;
    }
    const currentPin = currentPinInput.value;
    const newPin = newPinInput.value;
    const confirmNewPin = confirmNewPinInput.value;

    if (this.restrictions.pin && !this.verifyPin(currentPin)) {
      ErrorHandler.handle(new Error("Incorrect current PIN"), "ParentalControls.SetPinUI", "PIN hiện tại không đúng. Không thể thay đổi PIN.");
      currentPinInput.focus();
      return;
    }
    if (this.restrictions.pin && !currentPin && newPin) { // Trying to change PIN without current PIN
        ErrorHandler.handle(new Error("Current PIN required to change to a new PIN."), "ParentalControls.SetPinUI", "Vui lòng nhập PIN hiện tại để đặt PIN mới.");
        currentPinInput.focus();
        return;
    }
    if (!this.restrictions.pin && currentPin) { // No PIN set, but user entered something in current PIN
        ErrorHandler.handle(new Error("No current PIN is set. Leave 'Current PIN' empty if setting for the first time."), "ParentalControls.SetPinUI", "Hiện chưa có PIN. Để trống PIN hiện tại và nhập vào ô 'PIN mới'.");
        currentPinInput.value = '';
        newPinInput.focus();
        return;
    }

    if (newPin.length > 0) {
        if (newPin.length < 4) {
          ErrorHandler.handle(new Error("New PIN too short"), "ParentalControls.SetPinUI", "PIN mới phải có ít nhất 4 ký tự.");
          newPinInput.focus();
          return;
        }
        if (newPin !== confirmNewPin) {
          ErrorHandler.handle(new Error("New PINs do not match"), "ParentalControls.SetPinUI", "PIN mới và xác nhận PIN không khớp.");
          confirmNewPinInput.focus();
          return;
        }
        if (this.setPin(newPin)) {
          this.sessionPinVerified = true;
          currentPinInput.value = '';
          newPinInput.value = '';
          confirmNewPinInput.value = '';
        }
    } else if (currentPin && this.verifyPin(currentPin)) {
        this.showUINotification("PIN hiện tại chính xác. Để thay đổi, vui lòng nhập PIN mới.");
        this.sessionPinVerified = true;
        this._updateSettingsSectionVisibility();
    } else if (!newPin && !confirmNewPin && !currentPin && !this.restrictions.pin) {
        ErrorHandler.handle(new Error("New PIN cannot be empty for initial setup."), "ParentalControls.SetPinUI", "Vui lòng nhập PIN mới để đặt lần đầu.");
        newPinInput.focus();
    }
  }

  _handleAddCategory() {
    if (!this.categoryInput) return;
    const category = this.categoryInput.value.trim();
    if (category) {
      if (!this.restrictions.blockedCategories.includes(category)) {
        this.restrictions.blockedCategories.push(category);
        this._renderBlockedCategories();
        this.categoryInput.value = '';
      } else {
        ErrorHandler.handle(new Error("Category already blocked"), "ParentalControls.AddCategoryUI", "Danh mục này đã có trong danh sách chặn.");
      }
    } else {
        ErrorHandler.handle(new Error("Empty category"), "ParentalControls.AddCategoryUI", "Tên danh mục không được để trống.");
    }
    this.categoryInput.focus();
  }

  _removeBlockedCategory(categoryToRemove) {
    this.restrictions.blockedCategories = this.restrictions.blockedCategories.filter(cat => cat !== categoryToRemove);
    this._renderBlockedCategories();
  }

  _renderBlockedCategories() {
    if (!this.blockedCategoriesListDiv) return;
    this.blockedCategoriesListDiv.innerHTML = '';
    if (this.restrictions.blockedCategories.length === 0) {
      this.blockedCategoriesListDiv.appendChild(this._createElement('p', { textContent: 'Chưa có danh mục nào bị chặn.'}));
      return;
    }
    const ul = this._createElement('ul', {className: 'pc-categories-ul'});
    this.restrictions.blockedCategories.forEach(cat => {
      const removeBtn = this._createElement('button', {
          textContent: 'Xoá',
          className: 'pc-remove-category-btn',
          eventListeners: { click: () => this._removeBlockedCategory(cat) }
      });
      const categorySpan = this._createElement('span', {textContent: cat, className: 'pc-category-name'});
      const li = this._createElement('li', { children: [categorySpan, removeBtn] });
      ul.appendChild(li);
    });
    this.blockedCategoriesListDiv.appendChild(ul);
  }

  _handleSaveAllSettingsClick() {
    try {
        if (!this.restrictions.isEnabled) {
            ErrorHandler.handle(new Error("Cannot save settings"), "ParentalControls.SaveSettingsUI", "Kiểm soát của cha mẹ đang tắt. Không thể lưu.");
            return;
        }
         if (!this.sessionPinVerified) {
            ErrorHandler.handle(new Error("PIN not verified for session"), "ParentalControls.SaveSettingsUI", "Vui lòng nhập PIN hiện tại (trong mục Quản lý PIN) để xác thực trước khi lưu cài đặt.");
            const currentPinInput = document.getElementById('pc-current-pin');
            if (currentPinInput) {
                currentPinInput.focus();
            } else {
                this._updateSettingsSectionVisibility(); // Re-trigger PIN prompt for settings access
            }
            return;
        }

        const ageRatingSelect = document.getElementById('pc-age-rating');
        const watchTimeHoursInput = document.getElementById('pc-watch-time-hours');
        const watchTimeMinutesInput = document.getElementById('pc-watch-time-minutes');
        const restrictedStartInput = document.getElementById('pc-restricted-start');
        const restrictedEndInput = document.getElementById('pc-restricted-end');

        if (!ageRatingSelect || !watchTimeHoursInput || !watchTimeMinutesInput || !restrictedStartInput || !restrictedEndInput) {
            ErrorHandler.handle(new Error("UI elements for settings not found."), "ParentalControls.SaveSettingsUI", "Lỗi giao diện: Không tìm thấy đầy đủ các trường cài đặt.");
            return;
        }

        const hoursStr = watchTimeHoursInput.value;
        const minutesStr = watchTimeMinutesInput.value;
        let maxTimeSeconds = null;
        if (hoursStr || minutesStr) {
            const hours = parseInt(hoursStr) || 0;
            const minutes = parseInt(minutesStr) || 0;
            if (hours >= 0 && hours <=23 && minutes >=0 && minutes <=59) {
                 maxTimeSeconds = (hours * 3600) + (minutes * 60);
                 if (maxTimeSeconds === 0 && !(hoursStr === '0' && minutesStr === '0') && (hoursStr !== '' || minutesStr !== '') ) {
                     if(hoursStr === '' && minutesStr === '') maxTimeSeconds = null;
                 }
            } else {
                ErrorHandler.handle(new Error("Invalid watch time values"), "ParentalControls.SaveSettingsUI", "Giá trị giờ (0-23) hoặc phút (0-59) không hợp lệ.");
                return;
            }
        }

        const restrictedStartTime = restrictedStartInput.value || null;
        const restrictedEndTime = restrictedEndInput.value || null;
        const timeRegex = /^([01]\d|2[0-3]):([0-5]\d)$/;
        if (restrictedStartTime && !timeRegex.test(restrictedStartTime)) {
            ErrorHandler.handle(new Error("Invalid start time format."), "ParentalControls.SaveSettingsUI", "Định dạng giờ bắt đầu không hợp lệ (HH:MM).");
            restrictedStartInput.focus();
            return;
        }
        if (restrictedEndTime && !timeRegex.test(restrictedEndTime)) {
            ErrorHandler.handle(new Error("Invalid end time format."), "ParentalControls.SaveSettingsUI", "Định dạng giờ kết thúc không hợp lệ (HH:MM).");
            restrictedEndInput.focus();
            return;
        }
        if ((restrictedStartTime && !restrictedEndTime) || (!restrictedStartTime && restrictedEndTime)) {
            ErrorHandler.handle(new Error("Both restricted start and end times must be set, or both empty."), "ParentalControls.SaveSettingsUI", "Cả giờ bắt đầu và kết thúc hạn chế phải được đặt, hoặc để trống cả hai.");
            return;
        }

        const newSettingsData = {
            ageRating: ageRatingSelect.value || null,
            maxDailyWatchTimeSeconds: maxTimeSeconds,
            restrictedHours: { start: restrictedStartTime, end: restrictedEndTime },
            blockedCategories: [...this.restrictions.blockedCategories]
        };

        const currentPinForAuth = document.getElementById('pc-current-pin')?.value;
        if (!currentPinForAuth) {
            ErrorHandler.handle(new Error("PIN required to save settings."), "ParentalControls.SaveSettingsUI", "Vui lòng nhập PIN hiện tại (trong mục Quản lý PIN) để lưu cài đặt.");
            document.getElementById('pc-current-pin')?.focus();
            return;
        }
        if (this.setRestrictions(newSettingsData, currentPinForAuth)) {
            document.getElementById('pc-current-pin').value = ''; // Clear authorizing PIN field
        }
    } catch (error) {
        ErrorHandler.handle(error, "ParentalControls.SaveSettingsUI_General", "Lỗi không mong muốn khi cố gắng lưu cài đặt.");
    }
  }

  saveRestrictionsFromUI() {
    try {
      this._saveRestrictions();
      this.showUINotification('Đã lưu cài đặt kiểm soát phụ huynh!');
    } catch (error) {
      ErrorHandler.handle(error, 'ParentalControls.saveRestrictionsFromUI', 'Không thể lưu cài đặt kiểm soát phụ huynh.');
    }
  }

  // --- Core Logic Methods (adapted from previous version and user's new snippet) ---

  setPin(newPin) {
    if (!newPin || typeof newPin !== 'string' || newPin.length < 4) {
        ErrorHandler.handle(new Error('PIN must be a string of at least 4 characters.'), 'ParentalControls.setPin', 'Mã PIN phải có ít nhất 4 ký tự.');
        return false;
    }
    try {
      this.restrictions.pin = btoa(newPin);
      this._saveRestrictions();
      console.log('[ParentalControls] PIN updated.');
      this.showUINotification('Mã PIN đã được đặt/thay đổi thành công.');
      return true;
    } catch (error) {
      ErrorHandler.handle(error, 'ParentalControls.setPin', 'Không thể đặt mã PIN.');
      return false;
    }
  }

  verifyPin(enteredPin) {
    if (!this.restrictions.pin) {
      console.warn('[ParentalControls.verifyPin] No PIN set to verify against.');
      return false;
    }
    if (typeof enteredPin !== 'string' || !enteredPin) {
        return false;
    }
    try {
      return this.restrictions.pin === btoa(enteredPin);
    } catch (error) {
      ErrorHandler.handle(error, 'ParentalControls.verifyPin', 'Lỗi xác thực mã PIN do định dạng không hợp lệ.');
      return false;
    }
  }

  setRestrictions({ ageRating, maxDailyWatchTimeSeconds, restrictedHours, blockedCategories }, enteredPinToAuthorize) {
    // Note: isEnabled and pin are set via their own dedicated UI flows (enableControls/disableControls, _handleSetPinClick)
    // This method only sets the content restrictions after PIN authorization.
    if (!this.restrictions.isEnabled) { // Should ideally be checked by caller UI logic too
        ErrorHandler.handle(new Error('Controls must be enabled to set restrictions.'), 'ParentalControls.setRestrictions', 'Vui lòng bật kiểm soát của cha mẹ trước khi đặt giới hạn.');
        return false;
    }
    if (!this.verifyPin(enteredPinToAuthorize)) {
        ErrorHandler.handle(new Error('Incorrect PIN'), 'ParentalControls.setRestrictions', 'Sai mã PIN. Không thể thay đổi cài đặt.');
        return false;
    }

    try {
      // Create a new object for restrictions to ensure no direct mutation before validation
      const updatedRestrictions = { ...this.restrictions };

      if (ageRating !== undefined) updatedRestrictions.ageRating = ageRating;

      if (maxDailyWatchTimeSeconds !== undefined) {
          updatedRestrictions.maxDailyWatchTimeSeconds = (typeof maxDailyWatchTimeSeconds === 'number' && maxDailyWatchTimeSeconds >= 0) ? maxDailyWatchTimeSeconds : null;
      }

      if (restrictedHours) {
          updatedRestrictions.restrictedHours.start = restrictedHours.start || null;
          updatedRestrictions.restrictedHours.end = restrictedHours.end || null;
          if ((updatedRestrictions.restrictedHours.start && !updatedRestrictions.restrictedHours.end) || (!updatedRestrictions.restrictedHours.start && updatedRestrictions.restrictedHours.end)) {
              ErrorHandler.handle(new Error('Both start and end times for restricted hours must be provided or neither.'), 'ParentalControls.setRestrictions', 'Cả giờ bắt đầu và kết thúc hạn chế phải được cung cấp, hoặc để trống cả hai.');
              return false; // Stop update if validation fails
          }
      }

      if (Array.isArray(blockedCategories)) {
        updatedRestrictions.blockedCategories = [...new Set(blockedCategories.map(cat => String(cat).trim()).filter(Boolean))];
      }

      this.restrictions = updatedRestrictions; // Commit changes
      this._saveRestrictions();
      this.showUINotification('Cài đặt kiểm soát của cha mẹ đã được cập nhật.');

      this.applyRestrictions(); // Re-apply all current restrictions
      return true;
    } catch (error) {
      ErrorHandler.handle(error, 'ParentalControls.setRestrictions', 'Không thể thiết lập giới hạn.');
      return false;
    }
  }

  filterContent(videoMetadata) {
    try {
      if (!this.restrictions.isEnabled) return true;

      if (this.restrictions.ageRating && videoMetadata['data-rating'] &&
          this._compareAgeRatings(videoMetadata['data-rating'], this.restrictions.ageRating) > 0) {
        console.log(`[PC] Blocking by age: ${videoMetadata['data-rating']} > ${this.restrictions.ageRating}`);
        return false;
      }
      if (this.restrictions.blockedCategories.some(cat => videoMetadata['data-category']?.includes(cat))) {
        console.log(`[PC] Blocking by category: ${videoMetadata['data-category']}`);
        return false;
      }
      if (this.restrictions.maxDailyWatchTimeSeconds !== null && this.watchTimeTodaySeconds >= this.restrictions.maxDailyWatchTimeSeconds) {
        console.log(`[PC] Blocking due to watch time limit.`);
        return false;
      }
      if (this._isCurrentlyInRestrictedHours()) {
        console.log(`[PC] Blocking due to restricted hours.`);
        return false;
      }
      return true;
    } catch (error) {
      ErrorHandler.handle(error, 'ParentalControls.filterContent', 'Không thể lọc nội dung.');
      return false;
    }
  }

  _compareAgeRatings(videoRating, restrictedRating) {
      const ratingOrder = ['G', 'PG', '6', '7', '10', '12', '13', '15', '16', '18'];
      const videoRatingVal = isNaN(parseInt(videoRating)) ? ratingOrder.indexOf(String(videoRating).toUpperCase()) : parseInt(videoRating);
      const restrictedRatingVal = isNaN(parseInt(restrictedRating)) ? ratingOrder.indexOf(String(restrictedRating).toUpperCase()) : parseInt(restrictedRating);
      if (videoRatingVal === -1 || restrictedRatingVal === -1) return 0;
      return videoRatingVal - restrictedRatingVal;
  }

  _isCurrentlyInRestrictedHours() {
    if (!this.restrictions.isEnabled || !this.restrictions.restrictedHours.start || !this.restrictions.restrictedHours.end) {
      return false;
    }
    try {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const [startHour, startMinute] = this.restrictions.restrictedHours.start.split(':').map(Number);
      const startTotalMinutes = startHour * 60 + startMinute;
      const [endHour, endMinute] = this.restrictions.restrictedHours.end.split(':').map(Number);
      let endTotalMinutes = endHour * 60 + endMinute;
      if (startTotalMinutes <= endTotalMinutes) {
        return currentMinutes >= startTotalMinutes && currentMinutes < endTotalMinutes;
      } else {
        return currentMinutes >= startTotalMinutes || currentMinutes < endTotalMinutes;
      }
    } catch (e) {
        console.error("[ParentalControls._isCurrentlyInRestrictedHours] Error parsing time:", e);
        return false;
    }
  }

  trackWatchTime(seconds) {
    if (!this.restrictions.isEnabled || this.restrictions.maxDailyWatchTimeSeconds === null) return;
    try {
      this.watchTimeTodaySeconds += seconds;
      this._saveWatchTime();
      this.enforceWatchTimeLimit();
    } catch (error) {
      console.error('[ParentalControls.trackWatchTime] Error:', error);
    }
  }

  _resetToDefaultsAndSave() {
    this.restrictions = { ...this.defaultRestrictions };
    this.restrictions.restrictedHours = {...this.defaultRestrictions.restrictedHours};
    this.restrictions.blockedCategories = [];
    this.watchTimeTodaySeconds = 0;
    this._saveRestrictions();
    this._saveWatchTime();
  }

  enableControls(pinToSet) {
    if (!pinToSet || pinToSet.length < 4) {
      ErrorHandler.handle(new Error("PIN is too short"), "ParentalControls.enableControls", "Mã PIN phải có ít nhất 4 ký tự.");
      return false;
    }
    if (!this.setPin(pinToSet)) return false;
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
    this._unfilterAllContent();
    this.showUINotification('Kiểm soát của cha mẹ đã được tắt.');
    console.log('[ParentalControls] Controls disabled.');
    this.sessionPinVerified = false;
    return true;
  }

  applyRestrictions() {
    if (!this.restrictions.isEnabled) {
      this._unfilterAllContent();
      return;
    }
    console.log('[ParentalControls] Applying all restrictions...');
    this.filterContentByDataAttributes();
    this.enforceWatchTimeLimit();
    this.enforceRestrictedHours();
  }

  async filterContentByDataAttributes() {
    if (!this.restrictions.isEnabled) return;
    const videos = document.querySelectorAll('.video-item');
    videos.forEach(videoElement => {
      try {
        const rating = videoElement.dataset.rating || null;
        const category = videoElement.dataset.category || '';
        let isBlocked = false;
        if (this.restrictions.ageRating && rating && this._compareAgeRatings(rating, this.restrictions.ageRating) > 0) {
          isBlocked = true;
        }
        if (!isBlocked && this.restrictions.blockedCategories.length > 0 && this.restrictions.blockedCategories.includes(category)) {
          isBlocked = true;
        }
        videoElement.style.display = isBlocked ? 'none' : '';
      } catch (error) {
        console.error(`[ParentalControls] Error filtering video item ${videoElement.dataset.videoId || ''}:`, error);
        videoElement.style.display = '';
      }
    });
  }

  _unfilterAllContent() {
    console.log('[ParentalControls] Unfiltering all content.');
    document.querySelectorAll('.video-item').forEach(videoElement => {
      videoElement.style.display = '';
    });
  }

  startWatchTimeTracking() {
    if (this.watchTimeIntervalId || !this.restrictions.isEnabled || this.restrictions.maxDailyWatchTimeSeconds === null) {
      return;
    }
    this.watchTimeIntervalId = setInterval(() => {
      try {
        const video = document.querySelector('video:not([paused])');
        if (video) {
          this.trackWatchTime(1);
        }
      } catch (error) {
        console.error('[ParentalControls.watchTimeTrackingInterval] Error:', error);
      }
    }, 1000);
  }

  stopWatchTimeTracking() {
    if (this.watchTimeIntervalId) {
      clearInterval(this.watchTimeIntervalId);
      this.watchTimeIntervalId = null;
    }
  }

  enforceWatchTimeLimit() {
    if (!this.restrictions.isEnabled || this.restrictions.maxDailyWatchTimeSeconds === null) return;
    if (this.watchTimeTodaySeconds >= this.restrictions.maxDailyWatchTimeSeconds) {
      this.pauseAllVideos();
      this.showUINotification('Đã đạt giới hạn thời gian xem hôm nay. Video đã được tạm dừng.');
    }
  }

  startRestrictedHoursMonitoring() {
    if (this.restrictedHoursIntervalId || !this.restrictions.isEnabled) return;
    this.restrictedHoursIntervalId = setInterval(() => this.enforceRestrictedHours(), 60000);
    this.enforceRestrictedHours();
  }

  stopRestrictedHoursMonitoring() {
     if (this.restrictedHoursIntervalId) {
      clearInterval(this.restrictedHoursIntervalId);
      this.restrictedHoursIntervalId = null;
    }
  }

  enforceRestrictedHours() {
    if (this._isCurrentlyInRestrictedHours()) {
        this.pauseAllVideos();
        this.showUINotification(`Không thể xem trong khung giờ hạn chế (${this.restrictions.restrictedHours.start} - ${this.restrictions.restrictedHours.end}). Video đã tạm dừng.`);
    }
  }

  pauseAllVideos() {
    document.querySelectorAll('video').forEach(video => {
      if (!video.paused) video.pause();
    });
  }

  showUINotification(message, type = 'info') {
    console.log(`[ParentalControls] UI Notification (${type}): ${message}`);
    if (typeof ErrorHandler !== 'undefined' && ErrorHandler.showUserFeedback) {
        const notification = this._createElement('div',{
            className: `notification parental-control-notice pc-notice-${type}`,
            textContent: message
        });
        notification.style.position = 'fixed';
        notification.style.bottom = '80px';
        notification.style.right = '20px';
        notification.style.padding = '10px 20px';
        notification.style.color = 'white';
        notification.style.borderRadius = '5px';
        notification.style.zIndex = '1998';
        notification.style.background = type === 'error' ? 'rgba(220,53,69,0.9)' :
                                      type === 'success' ? 'rgba(25,135,84,0.9)' :
                                      'rgba(13,202,240,0.9)';
        document.body.appendChild(notification);
        setTimeout(() => {
            if (notification.parentNode) notification.remove();
        }, 3000);
    } else {
        alert(message);
    }
  }

  destroy() {
    this.stopWatchTimeTracking();
    this.stopRestrictedHoursMonitoring();
    if (this.uiContainer) {
        this.uiContainer.innerHTML = '';
        this.uiContainer = null;
    }
    console.log('[ParentalControls] Destroyed.');
  }
}

export { ParentalControls };
>>>>>>> REPLACE
