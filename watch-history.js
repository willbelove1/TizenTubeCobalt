// watch-history.js
import { ErrorHandler } from './error-handler.js';
import { openDB } from 'idb'; // Import openDB from idb library

class WatchHistory {
  constructor() {
    this.dbName = 'watch-history';
    this.storeName = 'history';
    this.dbVersion = 1;
    this.maxEntries = 10000;

    this.dbPromise = this._initDB().catch(error => {
        console.error('[WatchHistory.constructor] Critical DB initialization failed:', error);
        ErrorHandler.handle(error, 'WatchHistory.constructor.critical', 'Không thể khởi tạo database lịch sử xem. Tính năng lịch sử xem sẽ bị vô hiệu hóa.');
        return null;
    });
    console.log('[WatchHistory] Initialized, attempting to open IndexedDB.');
  }

  async _initDB() {
    try {
      return await openDB(this.dbName, this.dbVersion, {
        upgrade(db, oldVersion, newVersion, transaction) {
          console.log(`[WatchHistory] Upgrading DB from v${oldVersion} to v${newVersion}`);
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
            // Create indexes for efficient querying and cleanup
            store.createIndex('timestamp', 'timestamp', { unique: false });
            store.createIndex('videoId', 'videoId', { unique: false });
            store.createIndex('completionRate', 'completionRate', { unique: false });
            console.log(`[WatchHistory] Object store '${this.storeName}' created with indexes: timestamp, videoId, completionRate.`);
          }
          // Handle other version upgrades here
        },
        blocked() {
            ErrorHandler.handle(new Error('IndexedDB blocked for WatchHistory'), 'WatchHistory._initDB.blocked', 'Cơ sở dữ liệu lịch sử xem bị chặn, vui lòng đóng các tab khác của ứng dụng.');
        },
        blocking() {
            ErrorHandler.handle(new Error('IndexedDB blocking for WatchHistory'), 'WatchHistory._initDB.blocking', 'Cơ sở dữ liệu lịch sử xem đang chờ được đóng ở tab khác.');
        },
        terminated() {
            ErrorHandler.handle(new Error('IndexedDB terminated for WatchHistory'), 'WatchHistory._initDB.terminated', 'Kết nối cơ sở dữ liệu lịch sử xem đã bị chấm dứt đột ngột.');
        }
      });
    } catch (error) {
      ErrorHandler.handle(error, 'WatchHistory._initDB', 'Lỗi nghiêm trọng khi mở IndexedDB cho lịch sử xem.');
      throw error;
    }
  }

  async _getDB() {
    const db = await this.dbPromise;
    if (!db) {
      throw new Error("WatchHistory DB not available or initialization failed.");
    }
    return db;
  }

  /**
   * Records a video view event.
   * @param {object} videoData - Object containing video details.
   * Expected: { id, title, thumbnail, duration, watchTime, quality }
   */
  async recordView(videoData) {
    if (!this.dbPromise) return;
    if (!videoData || !videoData.id || typeof videoData.duration !== 'number' || typeof videoData.watchTime !== 'number') {
        ErrorHandler.handle(new Error('Invalid videoData for recordView'), 'WatchHistory.recordView', 'Dữ liệu video không hợp lệ để ghi lịch sử.');
        return;
    }

    const entryId = `${videoData.id}_${Date.now()}`; // Ensure unique ID for each view record
    const entry = {
      id: entryId, // Unique key for the record
      videoId: videoData.id,
      title: videoData.title || 'N/A',
      thumbnail: videoData.thumbnail || null,
      duration: videoData.duration,
      watchTime: videoData.watchTime,
      timestamp: Date.now(),
      device: this.getDeviceInfo(),
      quality: videoData.quality || 'N/A',
      completionRate: videoData.duration > 0 ? (videoData.watchTime / videoData.duration) : 0
    };

    console.log(`[WatchHistory] Recording view for videoId: ${videoData.id}`);
    try {
      const db = await this._getDB();
      await db.put(this.storeName, entry); // SimpleIndexedDBWrapper uses entry.id as key
      console.log(`[WatchHistory] View recorded: ${entry.id}`);
      this.cleanup(); // No await, let it run in background
    } catch (error) {
      ErrorHandler.handle(error, 'WatchHistory.recordView', 'Không thể ghi lịch sử xem video.');
    }
  }

  /**
   * Retrieves watch history with optional filters.
   * @param {object} [filters={}] - Optional filters.
   * Example: { dateRange: { start: timestamp, end: timestamp }, completionRate: 0.8 }
   * @returns {Promise<Array<object>>} Sorted array of history entries.
   */
  async getHistory(filters = {}) {
    if (!this.dbPromise) return [];
    console.log('[WatchHistory] Getting history with filters:', filters);
    try {
      const db = await this._getDB();
      let historyItems = await db.getAll(this.storeName);

      if (filters.dateRange && filters.dateRange.start && filters.dateRange.end) {
        historyItems = historyItems.filter(entry =>
          entry.timestamp >= filters.dateRange.start &&
          entry.timestamp <= filters.dateRange.end
        );
      }

      if (typeof filters.completionRate === 'number') {
        historyItems = historyItems.filter(entry =>
          entry.completionRate >= filters.completionRate
        );
      }

      // Sort by most recent first
      historyItems.sort((a, b) => b.timestamp - a.timestamp);
      console.log(`[WatchHistory] Found ${historyItems.length} history items matching filters.`);
      return historyItems;
    } catch (error) {
      ErrorHandler.handle(error, 'WatchHistory.getHistory', 'Không thể lấy lịch sử xem.');
      return [];
    }
  }

  /**
   * Retrieves watch statistics.
   * @returns {Promise<object|null>} An object with watch statistics or null on error.
   */
  async getWatchStats() {
    if (!this.dbPromise) return null;
    console.log('[WatchHistory] Calculating watch stats.');
    try {
      const db = await this._getDB();
      const historyItems = await db.getAll(this.storeName);

      if (!historyItems || historyItems.length === 0) {
        return {
          totalWatchTime: 0,
          averageCompletionRate: 0,
          mostWatchedGenres: [],
          watchingPatterns: []
        };
      }

      const totalWatchTime = historyItems.reduce((sum, entry) => sum + (entry.watchTime || 0), 0);
      const totalCompletionRateSum = historyItems.reduce((sum, entry) => sum + (entry.completionRate || 0), 0);
      const averageCompletionRate = historyItems.length > 0 ? totalCompletionRateSum / historyItems.length : 0;

      const stats = {
        totalWatchTime,
        averageCompletionRate,
        mostWatchedGenres: this.calculateGenreStats(historyItems), // Assumes genre is in entry
        watchingPatterns: this.calculateTimePatterns(historyItems)
      };
      console.log('[WatchHistory] Watch stats calculated:', stats);
      return stats;
    } catch (error) {
      ErrorHandler.handle(error, 'WatchHistory.getWatchStats', 'Không thể tính toán thống kê lịch sử xem.');
      return null;
    }
  }

  /**
   * Cleans up old history entries if the total count exceeds maxEntries.
   */
  async cleanup() {
    if (!this.dbPromise) return;
    console.log('[WatchHistory] Starting history cleanup check.');
    try {
      const db = await this._getDB();
      const currentCount = await db.count(this.storeName);
      console.log(`[WatchHistory] Current history entries: ${currentCount}. Max entries: ${this.maxEntries}.`);

      if (currentCount > this.maxEntries) {
        console.log('[WatchHistory] History entries exceed maximum. Cleaning up oldest items.');
        let items = await db.getAll(this.storeName);
        items.sort((a, b) => a.timestamp - b.timestamp); // Sort by oldest first

        const itemsToDeleteCount = currentCount - this.maxEntries;
        const itemsToDelete = items.slice(0, itemsToDeleteCount);
        let deletedCount = 0;

        for (const item of itemsToDelete) {
          // The original spec used item.videoId for deletion.
          // If 'id' (videoId_timestamp) is the keyPath, we use item.id.
          await db.delete(this.storeName, item.id);
          deletedCount++;
          console.log(`[WatchHistory] Deleted old history entry: ${item.id}`);
        }
        console.log(`[WatchHistory] History cleanup finished. Deleted ${deletedCount} items.`);
      } else {
        console.log('[WatchHistory] History entries within limits. No cleanup needed.');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'WatchHistory.cleanup', 'Lỗi trong quá trình dọn dẹp lịch sử xem.');
    }
  }

  getDeviceInfo() {
    try {
      return {
        userAgent: navigator.userAgent,
        screen: {
          width: window.screen?.width || 0,
          height: window.screen?.height || 0,
          pixelRatio: window.devicePixelRatio || 1
        },
        language: navigator.language
      };
    } catch (error) {
      // Don't use ErrorHandler for this, just return a default or partial info.
      console.warn('[WatchHistory.getDeviceInfo] Error getting device info:', error.message);
      return { userAgent: 'Unknown', screen: {}, language: 'Unknown' };
    }
  }

  calculateGenreStats(historyItems) {
    if (!Array.isArray(historyItems)) return [];
    const genres = {};
    historyItems.forEach(entry => {
      // Assuming entry.genre exists. If not, this part needs video metadata.
      if (entry.genre && typeof entry.genre === 'string') {
        genres[entry.genre] = (genres[entry.genre] || 0) + 1;
      } else if (Array.isArray(entry.genres)) { // Handle if genres is an array
        entry.genres.forEach(g => {
          if (g && typeof g === 'string') genres[g] = (genres[g] || 0) + 1;
        });
      }
    });
    return Object.entries(genres)
      .sort((a, b) => b[1] - a[1]) // Sort by count descending
      .slice(0, 5) // Top 5
      .map(([genre, count]) => ({ genre, count }));
  }

  calculateTimePatterns(historyItems) {
    if (!Array.isArray(historyItems)) return [];
    const patternsByHour = {}; // Hour of day (0-23)
    const patternsByDay = {};  // Day of week (0=Sun, 1=Mon, ...)

    historyItems.forEach(entry => {
      if (entry.timestamp) {
        const date = new Date(entry.timestamp);
        const hour = date.getHours();
        const day = date.getDay();
        patternsByHour[hour] = (patternsByHour[hour] || 0) + 1;
        patternsByDay[day] = (patternsByDay[day] || 0) + 1;
      }
    });

    const topHours = Object.entries(patternsByHour)
      .sort((a, b) => b[1] - a[1])
      // .slice(0, 5) // Optionally limit
      .map(([hour, count]) => ({ hour: parseInt(hour), count }));

    const topDays = Object.entries(patternsByDay)
      .sort((a, b) => b[1] - a[1])
      .map(([day, count]) => ({ day: parseInt(day), count }));

    return { hours: topHours, days: topDays };
  }
}

export { WatchHistory };
