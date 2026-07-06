import { FlyDropRTC } from './webrtc.js';
import { auth, provider } from './firebase-config.js';
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth';

const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const hostname = window.location.hostname;
const SIGNALING_URL = `${protocol}//${hostname}:3001`;

const rtc = new FlyDropRTC(SIGNALING_URL);

// DOM Elements
const roomCodeDisplay = document.getElementById('roomCodeDisplay');
const showQrBtn = document.getElementById('showQrBtn');
const copyRoomBtn = document.getElementById('copyRoomBtn');
const qrModal = document.getElementById('qrModal');
const closeQrBtn = document.getElementById('closeQrBtn');
const qrCanvas = document.getElementById('qrCanvas');
const qrUrlText = document.getElementById('qrUrlText');

const joinRoomInput = document.getElementById('joinRoomInput');
const joinRoomBtn = document.getElementById('joinRoomBtn');
const createRoomBtn = document.getElementById('createRoomBtn');
const connectionPanel = document.getElementById('connectionPanel');

const workspace = document.getElementById('workspace');
const fileInput = document.getElementById('fileInput');

const transfersContainer = document.getElementById('transfers');
const peersList = document.getElementById('peersList');

// Auth & User Profile UI
const loginBtn = document.getElementById('loginBtn');
const userProfile = document.getElementById('userProfile');
const userAvatar = document.getElementById('userAvatar');
const userName = document.getElementById('userName');
const logoutBtn = document.getElementById('logoutBtn');
const setDeviceBtn = document.getElementById('setDeviceBtn');
const currentDeviceNameDisplay = document.getElementById('currentDeviceNameDisplay');

const guestProfile = document.getElementById('guestProfile');
const setDeviceBtnGuest = document.getElementById('setDeviceBtnGuest');
const currentDeviceNameDisplayGuest = document.getElementById('currentDeviceNameDisplayGuest');

// Device Name Modal
const deviceNameModal = document.getElementById('deviceNameModal');
const deviceNameInput = document.getElementById('deviceNameInput');
const saveDeviceNameBtn = document.getElementById('saveDeviceNameBtn');
const closeDeviceNameBtn = document.getElementById('closeDeviceNameBtn');

let currentUser = null;
let deviceName = localStorage.getItem('deviceName') || '未命名裝置';

function updateDeviceNameDisplay() {
  if (currentDeviceNameDisplay) currentDeviceNameDisplay.textContent = deviceName;
  if (currentDeviceNameDisplayGuest) currentDeviceNameDisplayGuest.textContent = deviceName;
}
updateDeviceNameDisplay();

// --- Auth Logic ---
onAuthStateChanged(auth, (user) => {
  if (user) {
    currentUser = user;
    loginBtn.classList.add('hidden');
    guestProfile.classList.add('hidden');
    userProfile.classList.remove('hidden');
    userAvatar.src = user.photoURL || '/assets/favicon.png';
    userName.textContent = user.displayName || '使用者';
    
    if (rtc.ws.readyState === WebSocket.OPEN) {
      rtc.joinRoom(user.uid, deviceName);
    } else {
      rtc.ws.addEventListener('open', () => rtc.joinRoom(user.uid, deviceName));
    }
  } else {
    currentUser = null;
    loginBtn.classList.remove('hidden');
    userProfile.classList.add('hidden');
    guestProfile.classList.remove('hidden');
    
    const urlParams = new URLSearchParams(window.location.search);
    const room = urlParams.get('room');
    if (room) {
      if (rtc.ws.readyState === WebSocket.OPEN) {
        rtc.joinRoom(room, deviceName);
      } else {
        rtc.ws.addEventListener('open', () => rtc.joinRoom(room, deviceName));
      }
    } else {
      connectionPanel.classList.remove('hidden');
      workspace.classList.add('hidden');
    }
  }
});

loginBtn.addEventListener('click', async () => {
  try {
    await signInWithPopup(auth, provider);
  } catch (error) {
    console.error("Login failed:", error);
    alert("登入失敗，請確認 Firebase 設定。");
  }
});

logoutBtn.addEventListener('click', () => {
  signOut(auth).then(() => {
    window.location.href = '/';
  });
});

// --- Device Name Logic ---
function openDeviceNameModal() {
  deviceNameInput.value = deviceName;
  deviceNameModal.classList.remove('hidden');
}

setDeviceBtn.addEventListener('click', openDeviceNameModal);
setDeviceBtnGuest.addEventListener('click', openDeviceNameModal);

closeDeviceNameBtn.addEventListener('click', () => {
  deviceNameModal.classList.add('hidden');
});

saveDeviceNameBtn.addEventListener('click', () => {
  const newName = deviceNameInput.value.trim();
  if (newName) {
    deviceName = newName;
    localStorage.setItem('deviceName', deviceName);
    updateDeviceNameDisplay();
    deviceNameModal.classList.add('hidden');
    
    if (rtc.room) {
      rtc.joinRoom(rtc.room, deviceName); // Re-join to broadcast new name
    }
  }
});

// --- WebRTC Callbacks ---
rtc.onRoomJoined = (roomCode) => {
  roomCodeDisplay.textContent = `房間: ${roomCode}`;
  connectionPanel.classList.add('hidden');
  workspace.classList.remove('hidden');
  
  // Clear existing peers list
  peersList.innerHTML = '';
};

rtc.onPeerJoined = (peerId, peerDeviceName = 'Unknown Device') => {
  addPeerToList(peerId, peerDeviceName);
};

rtc.onPeerLeft = (peerId) => {
  removePeerFromList(peerId);
};

function formatBytes(bytes) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

const activeTransfers = new Map();
let currentTargetPeerId = null;

rtc.onTransferStart = (fileId, name, size, direction) => {
  const item = document.createElement('div');
  item.className = 'transfer-item';
  item.id = `transfer-${fileId}`;

  item.innerHTML = `
    <div class="transfer-header">
      <div class="transfer-name">${name} <span style="font-size: 0.8rem; color: var(--text-secondary);">(${formatBytes(size)})</span></div>
      <div class="transfer-status" id="status-${fileId}">${direction === 'sending' ? '發送中...' : '接收中...'}</div>
    </div>
    <div class="progress-bar-container">
      <div class="progress-bar" id="progress-${fileId}"></div>
    </div>
    <div id="action-${fileId}" style="margin-top: 5px;"></div>
  `;
  transfersContainer.prepend(item);
  activeTransfers.set(fileId, item);
};

rtc.onTransferProgress = (fileId, transferred, total) => {
  const percent = (transferred / total) * 100;
  const progressBar = document.getElementById(`progress-${fileId}`);
  if (progressBar) {
    progressBar.style.width = `${percent}%`;
  }
};

rtc.onTransferComplete = (fileId, blob, name) => {
  const statusElem = document.getElementById(`status-${fileId}`);
  const progressBar = document.getElementById(`progress-${fileId}`);
  const actionContainer = document.getElementById(`action-${fileId}`);
  
  if (statusElem) statusElem.textContent = '已完成！';
  if (progressBar) progressBar.style.width = '100%';

  if (blob && actionContainer) {
    // Show download button instead of auto downloading
    const btn = document.createElement('button');
    btn.className = 'btn-primary';
    btn.textContent = '下載檔案';
    btn.onclick = () => {
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Optional: don't revoke URL immediately so they can redownload if needed
      // setTimeout(() => URL.revokeObjectURL(url), 60000); 
    };
    actionContainer.appendChild(btn);
  }
  
  activeTransfers.delete(fileId);
};

// --- Copy Room Code ---
copyRoomBtn.addEventListener('click', () => {
  if (rtc.room) {
    navigator.clipboard.writeText(rtc.room).then(() => {
      copyRoomBtn.classList.add('success');
      copyRoomBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><polyline points="20 6 9 17 4 12"></polyline></svg>`;
      setTimeout(() => {
        copyRoomBtn.classList.remove('success');
        copyRoomBtn.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>`;
      }, 1500);
    }).catch(err => {
      console.error('Failed to copy: ', err);
    });
  }
});

joinRoomBtn.addEventListener('click', () => {
  const room = joinRoomInput.value.trim().toUpperCase();
  if (room) {
    rtc.joinRoom(room, deviceName);
  }
});

createRoomBtn.addEventListener('click', () => {
  rtc.joinRoom(null, deviceName);
});

showQrBtn.addEventListener('click', () => {
  if (!rtc.room) return;
  const joinUrl = `${window.location.origin}/?room=${rtc.room}`;
  qrUrlText.textContent = joinUrl;
  
  QRCode.toCanvas(qrCanvas, joinUrl, {
    width: 200,
    color: { dark: '#333333', light: '#ffffff' }
  }, (error) => {
    if (error) console.error(error);
    qrModal.classList.remove('hidden');
  });
});

closeQrBtn.addEventListener('click', () => {
  qrModal.classList.add('hidden');
});

// --- Peer List Management ---

function addPeerToList(peerId, peerName) {
  let card = document.getElementById(`peer-${peerId}`);
  if (card) {
    // Update name if card already exists (resolves device naming bug)
    card.querySelector('.peer-name').textContent = peerName;
    return;
  }
  
  card = document.createElement('div');
  card.className = 'peer-card';
  card.id = `peer-${peerId}`;
  
  card.innerHTML = `
    <div class="peer-info">
      <div class="peer-icon">
        <svg viewBox="0 0 24 24" width="20" height="20" stroke="currentColor" stroke-width="2" fill="none"><path d="M22 12h-4l-3 9L9 3l-3 9H2"></path></svg>
      </div>
      <div class="peer-name">${peerName}</div>
    </div>
    <button class="btn-secondary btn-send-peer">發送檔案</button>
  `;

  // Handle click "Send"
  card.querySelector('.btn-send-peer').addEventListener('click', () => {
    currentTargetPeerId = peerId;
    fileInput.click();
  });

  // Handle drag and drop on specific peer
  card.addEventListener('dragover', (e) => {
    e.preventDefault();
    card.classList.add('dragover');
  });

  card.addEventListener('dragleave', () => {
    card.classList.remove('dragover');
  });

  card.addEventListener('drop', (e) => {
    e.preventDefault();
    card.classList.remove('dragover');
    if (e.dataTransfer.files.length > 0) {
      currentTargetPeerId = peerId;
      handleFiles(e.dataTransfer.files);
    }
  });

  peersList.appendChild(card);
}

function removePeerFromList(peerId) {
  const card = document.getElementById(`peer-${peerId}`);
  if (card) card.remove();
}

// Global drop on workspace acts as broadcast (optional, or disable it)
workspace.addEventListener('dragover', (e) => e.preventDefault());
workspace.addEventListener('drop', (e) => e.preventDefault());

fileInput.addEventListener('change', () => {
  if (fileInput.files.length > 0) {
    handleFiles(fileInput.files);
  }
  // Reset input
  fileInput.value = "";
});

function handleFiles(files) {
  for (const file of files) {
    // Basic validation to catch folders or system protected files
    // Folders often have size 0 or a multiple of 4096 and no type (heuristic)
    if (!file.type && file.size % 4096 === 0 && file.size <= 4096) {
      alert(`⚠️ 無法傳送資料夾或受保護的檔案: ${file.name}`);
      continue;
    }

    if (currentTargetPeerId) {
      rtc.sendFile(file, currentTargetPeerId); // Send to specific peer
    } else {
      alert('請先選擇一個裝置來傳送檔案。');
    }
  }
}
