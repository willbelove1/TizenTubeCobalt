// playlist-sync.js
import { ErrorHandler } from './error-handler.js';
import { fetchWithRetry } from './api-utils.js';
import { openDB } from 'idb';

class PlaylistSync {
  constructor() {
    this.dbName = 'tizentube-playlists'; // Specific DB name
    this.storeName = 'playlists';
    this.dbVersion = 1;
    this.apiEndpoint = 'https://api.tizentube.com/v1';

    this.dbPromise = this._initDB().catch(error => {
        console.error('[PlaylistSync.constructor] Critical DB initialization failed:', error);
        ErrorHandler.handle(error, 'PlaylistSync.constructor.critical', 'Không thể khởi tạo database playlist. Đồng bộ playlist sẽ bị vô hiệu hóa.');
        return null;
    });

    this.syncIntervalMs = 30000;
    this.syncTimerId = null;
    this.startAutoSync(); // Should ideally wait for dbPromise to resolve successfully
    console.log('[PlaylistSync] Initialized, attempting to open IndexedDB.');
  }

  async _initDB() {
    try {
      return await openDB(this.dbName, this.dbVersion, {
        upgrade(db, oldVersion, newVersion, transaction) {
          console.log(`[PlaylistSync] Upgrading DB from v${oldVersion} to v${newVersion}`);
          if (!db.objectStoreNames.contains(this.storeName)) {
            // Playlists are identified by their 'id'.
            const store = db.createObjectStore(this.storeName, { keyPath: 'id' });
            // No additional indexes needed for now, as playlists are fetched by ID.
            console.log(`[PlaylistSync] Object store '${this.storeName}' created.`);
          }
        },
        blocked() { ErrorHandler.handle(new Error('IndexedDB blocked for PlaylistSync'), 'PlaylistSync._initDB.blocked', 'Cơ sở dữ liệu playlist bị chặn.'); },
        blocking() { ErrorHandler.handle(new Error('IndexedDB blocking for PlaylistSync'), 'PlaylistSync._initDB.blocking', 'Cơ sở dữ liệu playlist đang chờ.'); },
        terminated() { ErrorHandler.handle(new Error('IndexedDB terminated for PlaylistSync'), 'PlaylistSync._initDB.terminated', 'Kết nối cơ sở dữ liệu playlist bị chấm dứt.'); }
      });
    } catch (error) {
      ErrorHandler.handle(error, 'PlaylistSync._initDB', 'Lỗi nghiêm trọng khi mở IndexedDB cho playlists.');
      throw error;
    }
  }

  async _getDB() {
    const db = await this.dbPromise;
    if (!db) {
      throw new Error("PlaylistSync DB not available or initialization failed.");
    }
    return db;
  }


  async syncPlaylist(playlistId) {
    if (!playlistId) {
        ErrorHandler.handle(new Error('playlistId is undefined or null'), 'PlaylistSync.syncPlaylist', 'ID Playlist không hợp lệ.');
        throw new Error('playlistId is undefined or null');
    }
    console.log(`[PlaylistSync] Starting sync for playlist: ${playlistId}`);
    try {
      const db = await this._getDB();
      const localPlaylist = await db.get(this.storeName, playlistId);
      const remotePlaylistData = await this.fetchRemotePlaylist(playlistId);

      if (!remotePlaylistData || !Array.isArray(remotePlaylistData.videos)) { // remotePlaylistData itself is the playlist object
        const error = new Error('Invalid remote playlist data received or playlist not found.');
        // ErrorHandler.handle might have been called by fetchRemotePlaylist if it's a network error
        if (!error.handledByFetchWithRetry) { // Check if fetchWithRetry already handled this.
             ErrorHandler.handle(error, 'PlaylistSync.syncPlaylist', 'Dữ liệu playlist từ server không hợp lệ hoặc không tìm thấy.');
        }
        throw error;
      }

      const mergedPlaylist = this.mergePlaylists(localPlaylist || { id: playlistId, videos: [] }, remotePlaylistData);

      await db.put(this.storeName, mergedPlaylist);
      await this.pushToRemote(mergedPlaylist); // pushToRemote returns the response from fetchWithRetry or throws
      console.log(`[PlaylistSync] Successfully synced playlist: ${playlistId}`);
      return mergedPlaylist;
    } catch (error) {
      // Avoid double-handling if sub-functions already called ErrorHandler
      if (!error.handledBySubcall && !error.handledByFetchWithRetry) {
         ErrorHandler.handle(error, 'PlaylistSync.syncPlaylist', `Không thể đồng bộ playlist ${playlistId}.`);
      }
      throw error;
    }
  }

  async fetchRemotePlaylist(playlistId) {
    console.log(`[PlaylistSync] Fetching remote playlist: ${playlistId}`);
    try {
      const responseData = await fetchWithRetry(`${this.apiEndpoint}/playlists/${playlistId}`, {
        headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
      });
      if (responseData === null) { // fetchWithRetry returns null for 204 or if it handled terminal error post-retries
          const err = new Error(`Playlist ${playlistId} not found or empty response from server.`);
          err.handledByFetchWithRetry = true; // To signal syncPlaylist
          throw err;
      }
      return responseData;
    } catch (error) {
      error.handledBySubcall = true;
      throw error;
    }
  }

  async pushToRemote(playlist) {
    if (!playlist || !playlist.id) {
        const err = new Error('Invalid playlist or playlist ID for pushToRemote');
        ErrorHandler.handle(err, 'PlaylistSync.pushToRemote', 'Playlist không hợp lệ để đẩy lên server.');
        throw err;
    }
    console.log(`[PlaylistSync] Pushing playlist to remote: ${playlist.id}`);
    try {
      const responseData = await fetchWithRetry(`${this.apiEndpoint}/playlists/${playlist.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify(playlist)
      });
      // For PUT, a null response (e.g. 204 No Content from fetchWithRetry) is a success.
      console.log(`[PlaylistSync] Successfully pushed playlist: ${playlist.id}`);
      return responseData; // Might be null for 204, or parsed JSON if server returns one.
    } catch (error) {
      error.handledBySubcall = true;
      throw error;
    }
  }

  mergePlaylists(local, remote) {
    // Assuming remote.videos is an array. Add checks if it can be undefined/null.
    if (!remote || !Array.isArray(remote.videos)) {
        console.warn('[PlaylistSync.mergePlaylists] Remote data is invalid or missing videos array. Returning local data.');
        return { ...(local || {}), id: local?.id || remote?.id, videos: (local?.videos || []), lastSync: Date.now() };
    }
    if (!local || !Array.isArray(local.videos)) {
        console.warn('[PlaylistSync.mergePlaylists] Local data is invalid or missing videos array. Using remote data.');
        return { ...(remote || {}), id: remote?.id || local?.id, videos: (remote?.videos || []), lastSync: Date.now() };
    }

    const merged = { ...local };
    merged.id = local.id || remote.id;

    const videoMap = new Map();

    (local.videos || []).forEach(video => {
      if(video && video.id) videoMap.set(video.id, { ...video, source: 'local', lastModified: video.lastModified || 0 });
    });

    (remote.videos || []).forEach(video => {
      if(!video || !video.id) return;

      const existing = videoMap.get(video.id);
      const remoteLastModified = video.lastModified || 0;

      if (!existing || remoteLastModified > existing.lastModified) {
        videoMap.set(video.id, { ...video, source: 'remote', lastModified: remoteLastModified });
      } else if (existing && remoteLastModified === existing.lastModified && existing.source === 'local') {
        videoMap.set(video.id, {
          ...existing,
          title: video.title || existing.title,
          thumbnail: video.thumbnail || existing.thumbnail,
          source: 'merged_prefer_remote_metadata'
        });
      }
    });

    merged.videos = Array.from(videoMap.values());
    merged.lastSync = Date.now();
    return merged;
  }

  async startAutoSync() { // Make it async to await _getDB
    if (this.syncTimerId) {
      console.warn('[PlaylistSync] Auto-sync is already running.');
      return;
    }
    try {
        await this._getDB(); // Ensure DB is ready before starting sync
        console.log('[PlaylistSync] Starting auto-sync.');
        this.syncTimerId = setInterval(async () => {
          console.log('[PlaylistSync] Auto-sync tick.');
          try {
            const db = await this._getDB(); // Get DB instance for each tick too
            const playlists = await db.getAll(this.storeName);
            if (playlists && playlists.length > 0) {
              console.log(`[PlaylistSync] Found ${playlists.length} playlists to auto-sync.`);
              for (const playlist of playlists) {
                if (playlist && playlist.id) {
                  await this.syncPlaylist(playlist.id);
                } else {
                  console.warn('[PlaylistSync.startAutoSync] Found a playlist without an ID during auto-sync.');
                }
              }
            } else {
              console.log('[PlaylistSync] No playlists to auto-sync.');
            }
          } catch (error) {
            if (!error.handledBySubcall && !error.handledByFetchWithRetry) {
                 ErrorHandler.handle(error, 'PlaylistSync.startAutoSync', 'Lỗi trong quá trình đồng bộ tự động.');
            } else {
                console.error('[PlaylistSync.startAutoSync] Error in auto-sync tick (already handled):', error.message);
            }
          }
        }, this.syncIntervalMs);
    } catch (dbError) {
        console.error("[PlaylistSync.startAutoSync] DB not available, auto-sync cannot start.", dbError);
        // ErrorHandler already called by _getDB or _initDB
    }
  }

  stopAutoSync() {
    if (this.syncTimerId) {
      clearInterval(this.syncTimerId);
      this.syncTimerId = null;
      console.log('[PlaylistSync] Auto-sync stopped.');
    }
  }

  getAuthToken() {
    return localStorage.getItem('tizentube_token') || '';
  }
}

export { PlaylistSync };
