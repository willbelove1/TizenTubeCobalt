// webrtc-manager.js
import { ErrorHandler } from './error-handler.js';

class WebRTCManager {
  constructor() {
    this.pc = null; // RTCPeerConnection instance
    this.localStream = null;
    this.remoteStream = null;
    this.isInitialized = false;

    // Example STUN/TURN servers (replace with actual ones for production)
    this.defaultIceServers = [
      { urls: 'stun:stun.l.google.com:19302' },
      { urls: 'stun:stun1.l.google.com:19302' },
      // { urls: 'turn:your-turn-server.com', username: 'user', credential: 'pass' } // Example TURN
    ];
    console.log('[WebRTCManager] Initialized.');
  }

  /**
   * Initializes the RTCPeerConnection.
   * @param {object} signalServer - An object or class responsible for sending/receiving signaling messages.
   *                                Must have a `send(message)` method.
   * @param {Array<RTCIceServer>} [iceServers] - Optional custom ICE servers.
   */
  async initializeConnection(signalServer, iceServers) {
    if (this.isInitialized) {
      console.warn('[WebRTCManager] Connection already initialized. Close existing one first or ignore.');
      return;
    }
    if (!signalServer || typeof signalServer.send !== 'function') {
      const error = new Error('A valid signalServer with a send() method is required.');
      ErrorHandler.handle(error, 'WebRTCManager.initializeConnection', 'Lỗi cấu hình máy chủ tín hiệu WebRTC.');
      throw error; // Critical setup error
    }
    this.signalServer = signalServer;

    try {
      const configuration = { iceServers: iceServers || this.defaultIceServers };
      this.pc = new RTCPeerConnection(configuration);
      console.log('[WebRTCManager] RTCPeerConnection created with configuration:', configuration);

      this.pc.onicecandidate = (event) => {
        if (event.candidate) {
          console.log('[WebRTCManager] ICE candidate generated:', event.candidate);
          this.signalServer.send({
            type: 'ice-candidate',
            candidate: event.candidate
          });
        } else {
          console.log('[WebRTCManager] All ICE candidates have been sent.');
        }
      };

      this.pc.ontrack = (event) => {
        console.log('[WebRTCManager] Remote track received:', event.track, 'Streams:', event.streams);
        if (event.streams && event.streams[0]) {
          this.remoteStream = event.streams[0];
          this.displayRemoteStream();
        } else {
          // Sometimes tracks are added one by one without a full stream initially
          if (!this.remoteStream) {
            this.remoteStream = new MediaStream();
          }
          this.remoteStream.addTrack(event.track);
          this.displayRemoteStream(); // Update display if stream object changes
        }
      };

      this.pc.oniceconnectionstatechange = () => {
        console.log(`[WebRTCManager] ICE connection state changed: ${this.pc.iceConnectionState}`);
        if (this.pc.iceConnectionState === 'failed' || this.pc.iceConnectionState === 'disconnected' || this.pc.iceConnectionState === 'closed') {
          // Handle connection failure/closure
          ErrorHandler.handle(new Error(`ICE connection state: ${this.pc.iceConnectionState}`), 'WebRTCManager.iceConnectionStateChange', 'Kết nối WebRTC thất bại hoặc bị ngắt.');
          // this.closeConnection(); // Optionally auto-close
        }
      };

      this.pc.onsignalingstatechange = () => {
        console.log(`[WebRTCManager] Signaling state changed: ${this.pc.signalingState}`);
      };

      this.isInitialized = true;
      console.log('[WebRTCManager] Connection initialized successfully.');

    } catch (error) {
      ErrorHandler.handle(error, 'WebRTCManager.initializeConnection', 'Không thể khởi tạo kết nối WebRTC.');
      this.pc = null; // Ensure pc is null on failure
      throw error; // Re-throw for caller to handle
    }
  }

  /**
   * Creates an offer to initiate a WebRTC connection.
   * @returns {Promise<RTCSessionDescriptionInit|null>} The offer SDP.
   */
  async createOffer() {
    if (!this.pc || !this.isInitialized) {
      ErrorHandler.handle(new Error('PeerConnection not initialized.'), 'WebRTCManager.createOffer', 'Kết nối WebRTC chưa sẵn sàng.');
      return null;
    }
    try {
      console.log('[WebRTCManager] Creating offer...');
      const offerOptions = {
        offerToReceiveAudio: true,
        offerToReceiveVideo: true
      };
      const offer = await this.pc.createOffer(offerOptions);
      await this.pc.setLocalDescription(offer);
      console.log('[WebRTCManager] Offer created and local description set.');
      return offer;
    } catch (error) {
      ErrorHandler.handle(error, 'WebRTCManager.createOffer', 'Không thể tạo offer WebRTC.');
      return null;
    }
  }

  /**
   * Handles a remote offer received from the signaling server.
   * @param {RTCSessionDescriptionInit} offer - The remote offer.
   * @returns {Promise<RTCSessionDescriptionInit|null>} The answer SDP.
   */
  async handleRemoteOffer(offer) {
    if (!this.pc || !this.isInitialized) {
      ErrorHandler.handle(new Error('PeerConnection not initialized.'), 'WebRTCManager.handleRemoteOffer', 'Kết nối WebRTC chưa sẵn sàng.');
      return null;
    }
    try {
      console.log('[WebRTCManager] Handling remote offer...');
      await this.pc.setRemoteDescription(new RTCSessionDescription(offer));
      console.log('[WebRTCManager] Remote description set from offer. Creating answer...');
      const answer = await this.pc.createAnswer();
      await this.pc.setLocalDescription(answer);
      console.log('[WebRTCManager] Answer created and local description set.');
      return answer;
    } catch (error) {
      ErrorHandler.handle(error, 'WebRTCManager.handleRemoteOffer', 'Không thể xử lý offer từ xa hoặc tạo answer.');
      return null;
    }
  }

  /**
   * Handles a remote answer received from the signaling server.
   * @param {RTCSessionDescriptionInit} answer - The remote answer.
   */
  async handleRemoteAnswer(answer) {
    if (!this.pc || !this.isInitialized) {
      ErrorHandler.handle(new Error('PeerConnection not initialized.'), 'WebRTCManager.handleRemoteAnswer', 'Kết nối WebRTC chưa sẵn sàng.');
      return;
    }
    try {
      console.log('[WebRTCManager] Handling remote answer...');
      await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
      console.log('[WebRTCManager] Remote description set from answer.');
    } catch (error) {
      ErrorHandler.handle(error, 'WebRTCManager.handleRemoteAnswer', 'Không thể xử lý answer từ xa.');
    }
  }

  /**
   * Handles an ICE candidate received from the signaling server.
   * @param {RTCIceCandidateInit} candidate - The ICE candidate.
   */
  async handleIceCandidate(candidate) {
    if (!this.pc || !this.isInitialized) {
      ErrorHandler.handle(new Error('PeerConnection not initialized.'), 'WebRTCManager.handleIceCandidate', 'Kết nối WebRTC chưa sẵn sàng.');
      return;
    }
    try {
      if (candidate) {
        await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
        // console.log('[WebRTCManager] Added received ICE candidate.');
      }
    } catch (error) {
      ErrorHandler.handle(error, 'WebRTCManager.handleIceCandidate', 'Không thể thêm ICE candidate từ xa.');
    }
  }


  displayRemoteStream() {
    try {
      const videoElement = document.querySelector('video#remoteVideo'); // Assuming a specific video element for remote stream
      if (videoElement) {
        if (this.remoteStream) {
          videoElement.srcObject = this.remoteStream;
          console.log('[WebRTCManager] Remote stream attached to video element #remoteVideo.');
        } else {
          videoElement.srcObject = null; // Clear if stream is gone
          console.log('[WebRTCManager] Cleared remote stream from video element #remoteVideo.');
        }
      } else {
        console.warn('[WebRTCManager] Video element for remote stream (e.g., video#remoteVideo) not found.');
      }
    } catch (error) {
      // Don't use ErrorHandler for this UI update, just log.
      console.error('[WebRTCManager.displayRemoteStream] Error displaying remote stream:', error);
    }
  }

  /**
   * Adds a local media stream to the RTCPeerConnection.
   * @param {MediaStream} stream - The local media stream.
   */
  async addLocalStream(stream) {
    if (!this.pc || !this.isInitialized) {
      ErrorHandler.handle(new Error('PeerConnection not initialized.'), 'WebRTCManager.addLocalStream', 'Kết nối WebRTC chưa sẵn sàng.');
      return;
    }
    if (!stream || !(stream instanceof MediaStream)) {
        ErrorHandler.handle(new Error('Invalid stream provided to addLocalStream.'), 'WebRTCManager.addLocalStream', 'Luồng media không hợp lệ.');
        return;
    }
    try {
      this.localStream = stream;
      this.localStream.getTracks().forEach(track => {
        this.pc.addTrack(track, this.localStream);
        console.log(`[WebRTCManager] Added local track: ${track.kind} (${track.id})`);
      });
      console.log('[WebRTCManager] Local stream added to PeerConnection.');
    } catch (error) {
      ErrorHandler.handle(error, 'WebRTCManager.addLocalStream', 'Không thể thêm luồng media cục bộ.');
    }
  }

  /**
   * Closes the WebRTC connection and cleans up resources.
   */
  closeConnection() {
    console.log('[WebRTCManager] Closing WebRTC connection.');
    if (this.pc) {
      try {
        this.pc.ontrack = null;
        this.pc.onicecandidate = null;
        this.pc.oniceconnectionstatechange = null;
        this.pc.onsignalingstatechange = null;

        // Stop all local tracks
        if (this.localStream) {
          this.localStream.getTracks().forEach(track => track.stop());
          this.localStream = null;
        }

        // Stop all remote tracks (though they should stop when connection closes)
        if (this.remoteStream) {
            this.remoteStream.getTracks().forEach(track => track.stop());
            this.remoteStream = null;
            this.displayRemoteStream(); // Clear from video element
        }

        this.pc.close();
        this.pc = null;
        console.log('[WebRTCManager] PeerConnection closed.');
      } catch (error) {
        // Don't use ErrorHandler for cleanup errors, just log.
        console.error('[WebRTCManager.closeConnection] Error while closing PeerConnection:', error);
      }
    }
    this.isInitialized = false;
    this.signalServer = null; // Release reference
  }

  // Call destroy when the manager instance is no longer needed.
  destroy() {
    this.closeConnection();
    console.log('[WebRTCManager] Destroyed.');
  }
}

export { WebRTCManager };
