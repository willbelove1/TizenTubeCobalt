// cache-manager.js
import { ErrorHandler } from './error-handler.js';
import { openDB } from 'idb'; // Import openDB from idb library

class VideoCache {
  constructor() {
    this.dbName = 'tizentube-cache';
    this.storeName = 'segments';
    this.dbVersion = 1; // It's good practice to have a version number

    // Initialize the database connection promise
    this.dbPromise = this._initDB().catch(error => {
      // ErrorHandler.handle is called inside _initDB for specific init errors.
      // This catch is for any unhandled promise rejection from _initDB itself.
      console.error('[VideoCache.constructor] Critical DB initialization failed:', error);
      ErrorHandler.handle(error, 'VideoCache.constructor.critical', 'Không thể khởi tạo database cache. Các tính năng cache sẽ bị vô hiệu hóa.');
      return null; // Ensure dbPromise is null if init fails catastrophically
    });

    this.maxSizeBytes = 2 * 1024 * 1024 * 1024; // 2GB
    this.cleanupTimeoutId = null;
    this.debounceTimeMs = 2000; // Run cleanup 2 seconds after the last cacheSegment call

    if (typeof window !== 'undefined') {
      window.cacheManager = this;
    }
    console.log('[VideoCache] Initialized, attempting to open IndexedDB.');
  }

  async _initDB() {
    try {
      return await openDB(this.dbName, this.dbVersion, {
        upgrade(db, oldVersion, newVersion, transaction) {
          console.log(`[VideoCache] Upgrading DB from v${oldVersion} to v${newVersion}`);
          if (!db.objectStoreNames.contains(this.storeName)) {
            const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
            // Optionally, create indexes if needed for querying (e.g., by timestamp for cleanup)
            store.createIndex('timestamp', 'timestamp', { unique: false });
            console.log(`[VideoCache] Object store '${this.storeName}' created with index 'timestamp'.`);
          }
          // Handle other version upgrades here if necessary
        },
        blocked() {
            ErrorHandler.handle(new Error('IndexedDB blocked'), 'VideoCache._initDB.blocked', 'Cơ sở dữ liệu cache bị chặn, vui lòng đóng các tab khác của ứng dụng.');
        },
        blocking() {
            ErrorHandler.handle(new Error('IndexedDB blocking'), 'VideoCache._initDB.blocking', 'Cơ sở dữ liệu cache đang chờ được đóng ở tab khác.');
             // Optionally, attempt to close other connections if this instance should take over
        },
        terminated() {
            ErrorHandler.handle(new Error('IndexedDB terminated'), 'VideoCache._initDB.terminated', 'Kết nối cơ sở dữ liệu cache đã bị chấm dứt đột ngột.');
        }
      });
    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache._initDB', 'Lỗi nghiêm trọng khi mở IndexedDB.');
      throw error; // Re-throw to be caught by the constructor's promise handler
    }
  }

  async _getDB() {
    const db = await this.dbPromise; // This will either resolve to the DB instance or null/throw if init failed
    if (!db) {
      throw new Error("VideoCache DB not available or initialization failed.");
    }
    return db;
  }

  async cacheSegment(videoId, segmentIndex, data) {
    const key = `${videoId}_${segmentIndex}`;
    console.log(`[VideoCache] Attempting to cache segment: ${key}`);
    try {
      const db = await this._getDB();
      const segmentEntry = {
        id: key,
        data: data,
        timestamp: Date.now(),
        size: data.byteLength || data.size || 0
      };
      await db.put(this.storeName, segmentEntry);
      console.log(`[VideoCache] Segment ${key} cached. Size: ${segmentEntry.size}`);

      // Debounce cleanupOldCache call
      if (this.cleanupTimeoutId) {
        clearTimeout(this.cleanupTimeoutId);
      }
      this.cleanupTimeoutId = setTimeout(() => {
        this.cleanupOldCache().catch(err => {
            console.error("[VideoCache] Debounced cleanupOldCache failed:", err);
            // Optionally use ErrorHandler for persistent background failures if needed,
            // but be mindful of spamming user notifications for background tasks.
            // ErrorHandler.handle(err, 'VideoCache.debouncedCleanup', 'Lỗi dọn dẹp cache tự động.');
        });
      }, this.debounceTimeMs);

    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache.cacheSegment', `Không thể cache segment ${key}.`);
    }
  }

  async getSegment(videoId, segmentIndex) {
    const key = `${videoId}_${segmentIndex}`;
    try {
      const db = await this._getDB();
      const segmentEntry = await db.get(this.storeName, key);
      if (segmentEntry) {
        console.log(`[VideoCache] Segment ${key} retrieved from cache.`);
        return segmentEntry;
      }
      console.log(`[VideoCache] Segment ${key} not found in cache.`);
      return null;
    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache.getSegment', `Không thể lấy segment ${key} từ cache.`);
      return null;
    }
  }

  async cleanupOldCache() {
    console.log('[VideoCache] Starting cache cleanup check.');
    try {
      const db = await this._getDB();
      const currentSize = await this.getCurrentCacheSize(); // Uses its own _getDB call
      console.log(`[VideoCache] Current cache size: ${currentSize} bytes. Max size: ${this.maxSizeBytes} bytes.`);

      if (currentSize > this.maxSizeBytes) {
        console.log('[VideoCache] Cache size exceeds maximum. Cleaning up oldest items.');
        // Use the 'timestamp' index to get items sorted by oldest first
        const tx = db.transaction(this.storeName, 'readwrite');
        const index = tx.store.index('timestamp');
        let cursor = await index.openCursor(); // Oldest items first

        let sizeToFree = currentSize - this.maxSizeBytes;
        let itemsDeleted = 0;

        while (cursor && sizeToFree > 0) {
          await cursor.delete();
          sizeToFree -= cursor.value.size || 0;
          itemsDeleted++;
          console.log(`[VideoCache] Deleted old segment: ${cursor.value.id}, Size: ${cursor.value.size}`);
          cursor = await cursor.continue();
        }
        await tx.done;
        console.log(`[VideoCache] Cache cleanup finished. Deleted ${itemsDeleted} items.`);
      } else {
        console.log('[VideoCache] Cache size is within limits. No cleanup needed.');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache.cleanupOldCache', 'Lỗi trong quá trình dọn dẹp cache.');
    }
  }

  async cleanupOldEntries() {
    return this.cleanupOldCache();
  }

  async getCurrentCacheSize() {
    try {
      const db = await this._getDB();
      const items = await db.getAll(this.storeName);
      return items.reduce((sum, item) => sum + (item.size || 0), 0);
    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache.getCurrentCacheSize', 'Không thể tính toán kích thước cache hiện tại.');
      return 0;
    }
  }

  async deleteSegment(videoId, segmentIndex) {
    const key = `${videoId}_${segmentIndex}`;
    console.log(`[VideoCache] Deleting segment: ${key}`);
    try {
      const db = await this._getDB();
      await db.delete(this.storeName, key);
      console.log(`[VideoCache] Segment ${key} deleted.`);
    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache.deleteSegment', `Không thể xoá segment ${key}.`);
    }
  }

  async clearAllSegments() {
    console.log('[VideoCache] Clearing all segments.');
    try {
      const db = await this._getDB();
      await db.clear(this.storeName);
      console.log('[VideoCache] All segments cleared from store.');
    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache.clearAllSegments', 'Không thể xoá toàn bộ cache segment.');
    }
  }
}

export { VideoCache };
