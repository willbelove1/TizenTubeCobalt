// playlist-sync.js
import { ErrorHandler } from './error-handler.js';
import { fetchWithRetry } from './api-utils.js';

// Placeholder for IndexedDB operations until a proper wrapper (like 'idb') is integrated.
// This is a simplified mock to allow the class structure to be defined.
class SimpleIndexedDB {
  constructor(dbName, version) {
    this.dbName = dbName;
    this.version = version;
    this.data = new Map(); // In-memory store for this mock
    console.log(`[SimpleIndexedDB] Mock DB initialized for ${dbName}`);
  }
  async get(storeName, key) {
    // console.log(`[SimpleIndexedDB] Mock GET from ${storeName}: ${key}`);
    return this.data.get(`${storeName}_${key}`);
  }
  async put(storeName, value) {
    // console.log(`[SimpleIndexedDB] Mock PUT to ${storeName}:`, value);
    this.data.set(`${storeName}_${value.id}`, value); // Assumes value has an id
  }
  async getAll(storeName) {
    // console.log(`[SimpleIndexedDB] Mock GETALL from ${storeName}`);
    const storeData = [];
    this.data.forEach((value, key) => {
      if (key.startsWith(`${storeName}_`)) {
        storeData.push(value);
      }
    });
    return storeData;
  }
  // Other methods like delete, count would be needed for a full mock/implementation.
}


class PlaylistSync {
  constructor() {
    this.apiEndpoint = 'https://api.tizentube.com/v1';
    // Using the SimpleIndexedDB mock for now. Replace with actual idb integration later.
    this.localDB = new SimpleIndexedDB('playlists', 1);
    this.syncIntervalMs = 30000; // Renamed for clarity
    this.syncTimerId = null; // To keep track of the interval
    this.startAutoSync();
    console.log('[PlaylistSync] Initialized.');
  }

  async syncPlaylist(playlistId) {
    if (!playlistId) {
        ErrorHandler.handle(new Error('playlistId is undefined or null'), 'PlaylistSync.syncPlaylist', 'ID Playlist không hợp lệ.');
        throw new Error('playlistId is undefined or null');
    }
    console.log(`[PlaylistSync] Starting sync for playlist: ${playlistId}`);
    try {
      const localPlaylist = await this.localDB.get('playlists', playlistId);
      const remotePlaylistData = await this.fetchRemotePlaylist(playlistId);

      // Ensure remotePlaylistData is valid before merging
      if (!remotePlaylistData || !remotePlaylistData.videos) {
        // fetchRemotePlaylist already called ErrorHandler if fetchWithRetry threw.
        // This handles cases where fetch succeeded but data is not as expected.
        const error = new Error('Invalid remote playlist data received.');
        ErrorHandler.handle(error, 'PlaylistSync.syncPlaylist', 'Dữ liệu playlist từ server không hợp lệ.');
        throw error;
      }

      const mergedPlaylist = this.mergePlaylists(localPlaylist || { id: playlistId, videos: [] }, remotePlaylistData);

      await this.localDB.put('playlists', mergedPlaylist);
      await this.pushToRemote(mergedPlaylist);
      console.log(`[PlaylistSync] Successfully synced playlist: ${playlistId}`);
      return mergedPlaylist;
    } catch (error) {
      // ErrorHandler.handle might have been called by fetchRemotePlaylist or pushToRemote already.
      // Only call it here if the error originated within this method's direct logic.
      // To avoid double reporting, check if error already has a specific marker or rely on context.
      // For now, the provided solution re-throws, so ErrorHandler will be called by the top-level catcher.
      // If we don't re-throw, then we should ensure ErrorHandler is called here.
      // The current provided solution has ErrorHandler in each sub-call and then rethrows.
      // This means this catch block might be redundant if sub-calls always handle and rethrow.
      // However, if mergePlaylists or localDB.put itself throws an error not caught by sub-calls:
      if (!error.handledBySubcall) { // Hypothetical property to avoid double calls
         ErrorHandler.handle(error, 'PlaylistSync.syncPlaylist', `Không thể đồng bộ playlist ${playlistId}.`);
      }
      throw error; // Re-throw so the caller (e.g., auto-sync loop) can know.
    }
  }

  async fetchRemotePlaylist(playlistId) {
    console.log(`[PlaylistSync] Fetching remote playlist: ${playlistId}`);
    try {
      const response = await fetchWithRetry(`${this.apiEndpoint}/playlists/${playlistId}`, {
        headers: { 'Authorization': `Bearer ${this.getAuthToken()}` }
      });
      // fetchWithRetry now throws on error or returns parsed JSON / null for 204
      // If response is null here, it means fetchWithRetry handled an error or it was a 204.
      // For fetching a playlist, null is likely an error or "not found".
      if (response === null) {
          throw new Error(`Playlist ${playlistId} not found or empty response from server.`);
      }
      return response; // This is already parsed JSON
    } catch (error) {
      // fetchWithRetry already called ErrorHandler.handle.
      // We just re-throw to let syncPlaylist know it failed.
      console.error(`[PlaylistSync.fetchRemotePlaylist] Error fetching playlist ${playlistId}: ${error.message}`);
      error.handledBySubcall = true; // Mark error to avoid double reporting
      throw error;
    }
  }

  async pushToRemote(playlist) {
    if (!playlist || !playlist.id) {
        ErrorHandler.handle(new Error('Invalid playlist or playlist ID for pushToRemote'), 'PlaylistSync.pushToRemote', 'Playlist không hợp lệ để đẩy lên server.');
        throw new Error('Invalid playlist or playlist ID for pushToRemote');
    }
    console.log(`[PlaylistSync] Pushing playlist to remote: ${playlist.id}`);
    try {
      // fetchWithRetry for a PUT request might not expect a JSON response.
      // Adjusting fetchWithRetry or using a different utility for non-JSON responses might be needed.
      // For now, assuming fetchWithRetry is adapted or the server returns JSON on PUT (even if empty).
      // If it's a 204 No Content, fetchWithRetry as modified returns null.
      const response = await fetchWithRetry(`${this.apiEndpoint}/playlists/${playlist.id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.getAuthToken()}`
        },
        body: JSON.stringify(playlist)
      });
      // Check response if necessary, e.g., if server doesn't return error codes but indicates failure in body.
      // If fetchWithRetry returns null (e.g. 204), it's a success for PUT.
      console.log(`[PlaylistSync] Successfully pushed playlist: ${playlist.id}`);
      return response;
    } catch (error) {
      // fetchWithRetry already called ErrorHandler.handle.
      console.error(`[PlaylistSync.pushToRemote] Error pushing playlist ${playlist.id}: ${error.message}`);
      error.handledBySubcall = true; // Mark error
      throw error;
    }
  }

  mergePlaylists(local, remote) {
    // Assuming remote.videos is an array. Add checks if it can be undefined/null.
    if (!remote || !Array.isArray(remote.videos)) {
        console.warn('[PlaylistSync.mergePlaylists] Remote data is invalid or missing videos array. Returning local data.');
        // ErrorHandler.handle(new Error("Invalid remote data for merging"), "PlaylistSync.mergePlaylists", "Dữ liệu từ server không hợp lệ để trộn.");
        // Depending on strictness, might throw or just use local. For now, favoring local.
        return { ...(local || {}), videos: (local?.videos || []), lastSync: Date.now() };
    }
    if (!local || !Array.isArray(local.videos)) {
        console.warn('[PlaylistSync.mergePlaylists] Local data is invalid or missing videos array. Using remote data.');
        return { ...(remote || {}), videos: (remote?.videos || []), lastSync: Date.now() };
    }


    const merged = { ...local }; // Start with local properties
    merged.id = local.id || remote.id; // Ensure there's an ID

    const videoMap = new Map();

    (local.videos || []).forEach(video => {
      if(video && video.id) videoMap.set(video.id, { ...video, source: 'local', lastModified: video.lastModified || 0 });
    });

    (remote.videos || []).forEach(video => {
      if(!video || !video.id) return; // Skip invalid remote video entries

      const existing = videoMap.get(video.id);
      const remoteLastModified = video.lastModified || 0;

      if (!existing || remoteLastModified > existing.lastModified) {
        videoMap.set(video.id, { ...video, source: 'remote', lastModified: remoteLastModified });
      } else if (existing && remoteLastModified === existing.lastModified && existing.source === 'local') {
        // If timestamps are identical and local was the source, prefer remote for metadata if it exists
        // This is part of the user's suggested logic update for PlaylistSync.mergePlaylists
        videoMap.set(video.id, {
          ...existing, // Keep local data primarily
          title: video.title || existing.title, // Update with remote if remote has it
          thumbnail: video.thumbnail || existing.thumbnail,
          // any other fields to prioritize from remote on exact timestamp match
          source: 'merged_prefer_remote_metadata' // Indicate merge strategy
        });
      }
      // If existing.lastModified > remoteLastModified, local is newer, keep local (already in map)
    });

    merged.videos = Array.from(videoMap.values());
    merged.lastSync = Date.now();
    return merged;
  }

  startAutoSync() {
    if (this.syncTimerId) {
      console.warn('[PlaylistSync] Auto-sync is already running.');
      return;
    }
    console.log('[PlaylistSync] Starting auto-sync.');
    this.syncTimerId = setInterval(async () => {
      console.log('[PlaylistSync] Auto-sync tick.');
      try {
        const playlists = await this.localDB.getAll('playlists');
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
        // Errors from syncPlaylist should already be handled and re-thrown.
        // This catch is for errors from localDB.getAll or the loop itself.
        // The ErrorHandler.handle in syncPlaylist would have already shown a message for specific playlist failures.
        // So, this message can be more general or just log.
        console.error('[PlaylistSync.startAutoSync] General error during auto-sync loop:', error);
        ErrorHandler.handle(error, 'PlaylistSync.startAutoSync', 'Lỗi trong quá trình đồng bộ tự động.');
      }
    }, this.syncIntervalMs);
  }

  stopAutoSync() {
    if (this.syncTimerId) {
      clearInterval(this.syncTimerId);
      this.syncTimerId = null;
      console.log('[PlaylistSync] Auto-sync stopped.');
    }
  }

  getAuthToken() {
    // In a real app, token management would be more robust, possibly via AuthManager
    return localStorage.getItem('tizentube_token') || '';
  }
}

export { PlaylistSync };
