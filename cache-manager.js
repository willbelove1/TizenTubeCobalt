// cache-manager.js
import { ErrorHandler } from './error-handler.js';

// Placeholder for IndexedDB operations until a proper wrapper (like 'idb') is integrated.
// This is a simplified mock to allow the class structure to be defined.
// For actual 'idb' usage, the methods would be async and return Promises.
class SimpleIndexedDBWrapper {
  constructor(dbName, version, upgradeCallback) {
    this.dbName = dbName;
    this.version = version;
    this.stores = new Map(); // storeName -> Map(key -> value)

    // Simulate upgrade
    if (upgradeCallback) {
      const simulatedDB = {
        createObjectStore: (storeName, options) => {
          if (!this.stores.has(storeName)) {
            this.stores.set(storeName, new Map());
            console.log(`[SimpleIndexedDBWrapper] Mock store created: ${storeName} with options`, options);
          }
        }
      };
      upgradeCallback(simulatedDB);
    }
    console.log(`[SimpleIndexedDBWrapper] Mock DB initialized for ${dbName} v${version}`);
  }

  async _getStore(storeName) {
    if (!this.stores.has(storeName)) {
      // This case should ideally be handled by the upgrade callback ensuring stores exist.
      // If called before a store is "created", it's an issue.
      throw new Error(`Store ${storeName} does not exist in mock DB.`);
    }
    return this.stores.get(storeName);
  }

  async get(storeName, key) {
    try {
      const store = await this._getStore(storeName);
      return store.get(key);
    } catch (error) {
      ErrorHandler.handle(error, `SimpleIndexedDBWrapper.get.${storeName}`, `Lỗi đọc dữ liệu từ mock DB: ${key}`);
      throw error;
    }
  }

  async put(storeName, value, key) { // 'idb' uses (storeName, value, optionalKey)
    try {
      const store = await this._getStore(storeName);
      const effectiveKey = key || value.id; // Assuming 'idb' like keyPath or explicit key
      if (typeof effectiveKey === 'undefined') {
          throw new Error('Cannot put value without a key or id property into mock DB.');
      }
      store.set(effectiveKey, value);
    } catch (error) {
      ErrorHandler.handle(error, `SimpleIndexedDBWrapper.put.${storeName}`, 'Lỗi ghi dữ liệu vào mock DB.');
      throw error;
    }
  }

  async delete(storeName, key) {
    try {
      const store = await this._getStore(storeName);
      store.delete(key);
    } catch (error) {
      ErrorHandler.handle(error, `SimpleIndexedDBWrapper.delete.${storeName}`, `Lỗi xoá dữ liệu khỏi mock DB: ${key}`);
      throw error;
    }
  }

  async getAll(storeName) {
    try {
      const store = await this._getStore(storeName);
      return Array.from(store.values());
    } catch (error) {
      ErrorHandler.handle(error, `SimpleIndexedDBWrapper.getAll.${storeName}`, 'Lỗi đọc tất cả dữ liệu từ mock DB.');
      throw error;
    }
  }

  async count(storeName) {
    try {
      const store = await this._getStore(storeName);
      return store.size;
    } catch (error) {
      ErrorHandler.handle(error, `SimpleIndexedDBWrapper.count.${storeName}`, 'Lỗi đếm dữ liệu trong mock DB.');
      throw error;
    }
  }
}


class VideoCache {
  constructor() {
    this.dbName = 'tizentube-cache';
    this.storeName = 'segments';
    // Using the SimpleIndexedDBWrapper mock for now.
    // When 'idb' is integrated, this will change to `openDB(...)`.
    try {
        this.dbPromise = new SimpleIndexedDBWrapper(this.dbName, 1, (db) => {
            if (!db.objectStoreNames || !db.objectStoreNames.contains(this.storeName)) {
                 db.createObjectStore(this.storeName, { keyPath: 'id' });
            }
        });
    } catch (error) {
        ErrorHandler.handle(error, 'VideoCache.constructor', 'Không thể khởi tạo database cache.');
        // Prevent further operations if DB init fails catastrophically
        this.dbPromise = null;
    }

    this.maxSizeBytes = 2 * 1024 * 1024 * 1024; // 2GB

    // Assign instance to window.cacheManager as per requirement
    if (typeof window !== 'undefined') {
        window.cacheManager = this;
    }
    console.log('[VideoCache] Initialized.');
  }

  async _getDB() {
      if (!this.dbPromise) {
          throw new Error("VideoCache DB not initialized.");
      }
      // In a real 'idb' scenario, this.dbPromise is the promise from openDB()
      // and it resolves to the db instance.
      return this.dbPromise;
  }

  async cacheSegment(videoId, segmentIndex, data) {
    if (!this.dbPromise) return;
    const key = `${videoId}_${segmentIndex}`;
    console.log(`[VideoCache] Caching segment: ${key}`);
    try {
      const db = await this._getDB();
      const segmentEntry = {
        id: key,
        data: data, // This could be ArrayBuffer or Blob
        timestamp: Date.now(),
        size: data.byteLength || data.size || 0 // Handle ArrayBuffer or Blob
      };
      await db.put(this.storeName, segmentEntry);
      console.log(`[VideoCache] Segment ${key} cached. Size: ${segmentEntry.size}`);
      this.cleanupOldCache(); // No await, let it run in background
    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache.cacheSegment', `Không thể cache segment ${key}.`);
      // Optionally rethrow if the caller needs to know about the failure specifically
    }
  }

  async getSegment(videoId, segmentIndex) {
    if (!this.dbPromise) return null;
    const key = `${videoId}_${segmentIndex}`;
    try {
      const db = await this._getDB();
      const segmentEntry = await db.get(this.storeName, key);
      if (segmentEntry) {
        console.log(`[VideoCache] Segment ${key} retrieved from cache.`);
        return segmentEntry; // Contains {id, data, timestamp, size}
      }
      console.log(`[VideoCache] Segment ${key} not found in cache.`);
      return null;
    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache.getSegment', `Không thể lấy segment ${key} từ cache.`);
      return null; // Return null on error to indicate segment not available
    }
  }

  async cleanupOldCache() {
    if (!this.dbPromise) return;
    console.log('[VideoCache] Starting cache cleanup check.');
    try {
      const currentSize = await this.getCurrentCacheSize();
      console.log(`[VideoCache] Current cache size: ${currentSize} bytes. Max size: ${this.maxSizeBytes} bytes.`);
      if (currentSize > this.maxSizeBytes) {
        console.log('[VideoCache] Cache size exceeds maximum. Cleaning up oldest items.');
        const db = await this._getDB();
        let items = await db.getAll(this.storeName);
        items.sort((a, b) => a.timestamp - b.timestamp); // Sort by oldest first

        let sizeToFree = currentSize - this.maxSizeBytes;
        let itemsDeleted = 0;

        for (const item of items) {
          if (sizeToFree <= 0) break;
          await db.delete(this.storeName, item.id);
          sizeToFree -= item.size;
          itemsDeleted++;
          console.log(`[VideoCache] Deleted old segment: ${item.id}, Size: ${item.size}`);
        }
        console.log(`[VideoCache] Cache cleanup finished. Deleted ${itemsDeleted} items.`);
      } else {
        console.log('[VideoCache] Cache size is within limits. No cleanup needed.');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache.cleanupOldCache', 'Lỗi trong quá trình dọn dẹp cache.');
    }
  }

  // Renamed from cleanupOldEntries for clarity with original VideoCache spec
  async cleanupOldEntries() {
    return this.cleanupOldCache();
  }


  async getCurrentCacheSize() {
    if (!this.dbPromise) return 0;
    try {
      const db = await this._getDB();
      const items = await db.getAll(this.storeName);
      return items.reduce((sum, item) => sum + (item.size || 0), 0);
    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache.getCurrentCacheSize', 'Không thể tính toán kích thước cache hiện tại.');
      return 0; // Return 0 on error to prevent misguided cleanup
    }
  }

  // getOldestItems was part of the original spec, now integrated into cleanupOldCache logic.
  // If needed separately:
  /*
  async getOldestItems(count = 10) { // Get a certain number of oldest items
    if (!this.dbPromise) return [];
    try {
      const db = await this._getDB();
      let items = await db.getAll(this.storeName);
      items.sort((a, b) => a.timestamp - b.timestamp);
      return items.slice(0, count);
    } catch (error) {
      ErrorHandler.handle(error, 'VideoCache.getOldestItems', 'Không thể lấy các mục cache cũ nhất.');
      return [];
    }
  }
  */

   // Added methods based on typical cache needs and SimpleIndexedDBWrapper capabilities
  async deleteSegment(videoId, segmentIndex) {
    if (!this.dbPromise) return;
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
    if (!this.dbPromise) return;
    console.log('[VideoCache] Clearing all segments.');
    try {
        const db = await this._getDB();
        const items = await db.getAll(this.storeName);
        for (const item of items) {
            await db.delete(this.storeName, item.id);
        }
        console.log('[VideoCache] All segments cleared.');
    } catch (error) {
        ErrorHandler.handle(error, 'VideoCache.clearAllSegments', 'Không thể xoá toàn bộ cache segment.');
    }
  }
}

export { VideoCache };
