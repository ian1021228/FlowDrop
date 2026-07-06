import { v4 as uuidv4 } from 'uuid';

const CHUNK_SIZE = 64 * 1024; // 64 KB
const MAX_BUFFER = 16 * 1024 * 1024; // 16 MB

export class FlyDropRTC {
  constructor(signalingServerUrl) {
    this.ws = new WebSocket(signalingServerUrl);
    this.peers = new Map(); // peerId -> RTCPeerConnection
    this.dataChannels = new Map(); // peerId -> RTCDataChannel
    this.myId = null;
    this.room = null;
    
    // Callbacks
    this.onRoomJoined = null;
    this.onPeerJoined = null;
    this.onPeerLeft = null;
    this.onTransferStart = null;
    this.onTransferProgress = null;
    this.onTransferComplete = null;

    // Receive buffers
    this.receiveBuffers = new Map(); // fileId -> { meta, chunks, receivedBytes }

    this.ws.onmessage = async (event) => {
      const message = JSON.parse(event.data);
      if (message.type === 'joined') {
        this.myId = message.peerId;
        this.room = message.room;
        if (this.onRoomJoined) this.onRoomJoined(this.room);
        
        for (const peer of message.peers) {
          await this.createPeerConnection(peer.id, true);
          if (this.onPeerJoined) this.onPeerJoined(peer.id, peer.deviceName);
        }
      } else if (message.type === 'peer-joined') {
        if (this.onPeerJoined) this.onPeerJoined(message.peerId, message.deviceName);
      } else if (message.type === 'peer-left') {
        this.removePeer(message.peerId);
        if (this.onPeerLeft) this.onPeerLeft(message.peerId);
      } else if (message.type === 'signal') {
        await this.handleSignal(message.payload);
      }
    };
  }

  joinRoom(roomCode = null, deviceName = 'Guest Device') {
    this.ws.send(JSON.stringify({
      type: 'join',
      room: roomCode,
      payload: { deviceName }
    }));
  }

  async createPeerConnection(peerId, isInitiator) {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
    });
    this.peers.set(peerId, pc);

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.ws.send(JSON.stringify({
          type: 'signal',
          payload: { target: peerId, candidate: event.candidate }
        }));
      }
    };

    if (isInitiator) {
      const dc = pc.createDataChannel('fileTransfer', { ordered: true });
      this.setupDataChannel(peerId, dc);
      
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.ws.send(JSON.stringify({
        type: 'signal',
        payload: { target: peerId, sdp: pc.localDescription }
      }));
    } else {
      pc.ondatachannel = (event) => {
        this.setupDataChannel(peerId, event.channel);
      };
    }
  }

  async handleSignal({ source, sdp, candidate }) {
    if (sdp) {
      if (!this.peers.has(source)) {
        await this.createPeerConnection(source, false);
      }
      const pc = this.peers.get(source);
      await pc.setRemoteDescription(new RTCSessionDescription(sdp));
      if (sdp.type === 'offer') {
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.ws.send(JSON.stringify({
          type: 'signal',
          payload: { target: source, sdp: pc.localDescription }
        }));
      }
    } else if (candidate) {
      const pc = this.peers.get(source);
      if (pc) {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      }
    }
  }

  setupDataChannel(peerId, dc) {
    dc.binaryType = 'arraybuffer';
    dc.bufferedAmountLowThreshold = 8 * 1024 * 1024; // 8MB

    this.dataChannels.set(peerId, dc);

    dc.onopen = () => console.log(`DataChannel to ${peerId} open`);
    dc.onclose = () => console.log(`DataChannel to ${peerId} closed`);
    
    dc.onmessage = (event) => {
      if (typeof event.data === 'string') {
        const msg = JSON.parse(event.data);
        if (msg.type === 'file-meta') {
          this.receiveBuffers.set(msg.fileId, {
            meta: msg,
            chunks: [],
            receivedBytes: 0
          });
          if (this.onTransferStart) {
            this.onTransferStart(msg.fileId, msg.name, msg.size, 'receiving');
          }
        } else if (msg.type === 'file-done') {
          const bufferInfo = this.receiveBuffers.get(msg.fileId);
          if (bufferInfo) {
            const blob = new Blob(bufferInfo.chunks, { type: bufferInfo.meta.fileType });
            if (this.onTransferComplete) {
              this.onTransferComplete(msg.fileId, blob, bufferInfo.meta.name);
            }
            this.receiveBuffers.delete(msg.fileId);
          }
        }
      } else {
        // Binary chunk: assumption is one transfer at a time per room for simplicity
        let activeFileId = null;
        let activeBuffer = null;
        for (const [fId, buf] of this.receiveBuffers.entries()) {
          activeFileId = fId;
          activeBuffer = buf;
          break;
        }

        if (activeBuffer) {
          activeBuffer.chunks.push(event.data);
          activeBuffer.receivedBytes += event.data.byteLength;
          if (this.onTransferProgress) {
            this.onTransferProgress(activeFileId, activeBuffer.receivedBytes, activeBuffer.meta.size);
          }
        }
      }
    };
  }

  async sendFile(file, targetPeerId = null) {
    if (this.dataChannels.size === 0) {
      alert('No peers connected in this room!');
      return;
    }

    const fileId = uuidv4();
    const meta = {
      type: 'file-meta',
      fileId,
      name: file.name,
      size: file.size,
      fileType: file.type
    };

    if (this.onTransferStart) {
      this.onTransferStart(fileId, file.name, file.size, 'sending');
    }

    const targets = targetPeerId ? [targetPeerId] : Array.from(this.dataChannels.keys());
    for (const peerId of targets) {
      const dc = this.dataChannels.get(peerId);
      if (dc && dc.readyState === 'open') {
        dc.send(JSON.stringify(meta));
      }
    }

    let offset = 0;
    const reader = new FileReader();

    const readNextChunk = () => {
      const slice = file.slice(offset, offset + CHUNK_SIZE);
      reader.readAsArrayBuffer(slice);
    };

    reader.onload = async (e) => {
      const chunk = e.target.result;
      
      for (const peerId of targets) {
        const dc = this.dataChannels.get(peerId);
        if (dc && dc.readyState === 'open') {
          if (dc.bufferedAmount > MAX_BUFFER) {
            await new Promise(resolve => {
              dc.onbufferedamountlow = () => {
                dc.onbufferedamountlow = null;
                resolve();
              };
            });
          }
          dc.send(chunk);
        }
      }

      offset += chunk.byteLength;
      if (this.onTransferProgress) {
        this.onTransferProgress(fileId, offset, file.size);
      }

      if (offset < file.size) {
        readNextChunk();
      } else {
        const doneMsg = JSON.stringify({ type: 'file-done', fileId });
        for (const dc of this.dataChannels.values()) {
          if (dc.readyState === 'open') {
            dc.send(doneMsg);
          }
        }
        if (this.onTransferComplete) {
          this.onTransferComplete(fileId, null, file.name);
        }
      }
    };

    readNextChunk();
  }

  removePeer(peerId) {
    if (this.peers.has(peerId)) {
      this.peers.get(peerId).close();
      this.peers.delete(peerId);
    }
    this.dataChannels.delete(peerId);
  }
}
