const socket = io();
let localStream = null;
let screenStream = null;
const peers = {}; // Keeps track of active peer connections

const joinContainer = document.getElementById('join-container');
const roomContainer = document.getElementById('room-container');
const videoGrid = document.getElementById('video-grid');
const userList = document.getElementById('user-list');

let myNickname = "";
let myRoomId = "";

document.getElementById('join-btn').onclick = async () => {
    myNickname = document.getElementById('nickname-input').value.trim();
    myRoomId = document.getElementById('room-input').value.trim();
    
    if (!myNickname || !myRoomId) return alert("Please fill out both fields.");

    // Step 1: Capture default microphone access initially
    try {
        localStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (e) {
        console.warn("No microphone detected or permission denied. Joining audio-only as receiver.");
        localStream = new MediaStream();
    }

    joinContainer.classList.add('hidden');
    roomContainer.classList.remove('remove', 'hidden');

    addParticipantRoster("You", socket.id);
    
    // Connect into signaling server room infrastructure
    socket.emit('join-room', { roomId: myRoomId, nickname: myNickname });
};

// Handle discovery of existing room participants
socket.on('all-users', users => {
    users.forEach(user => {
        const peer = createPeer(user.id, socket.id, localStream);
        peers[user.id] = peer;
        addParticipantRoster(user.nickname, user.id);
    });
});

// Handle incoming new arrivals 
socket.on('user-joined', payload => {
    addParticipantRoster(payload.nickname, payload.id);
});

socket.on('user-joined-signal', payload => {
    const peer = addPeer(payload.signal, payload.callerId, localStream);
    peers[payload.callerId] = peer;
});

socket.on('receiving-returned-signal', payload => {
    peers[payload.id].signal(payload.signal);
});

// Implementation of Stream Sharing (Capturing Display + System Audio)
document.getElementById('screen-share-toggle').onclick = async () => {
    try {
        // Request browser display capture wrapper accompanied explicitly by system audio paths
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false
            }
        });

        const screenVideoTrack = screenStream.getVideoTracks()[0];
        const screenAudioTrack = screenStream.getAudioTracks()[0];

        // Display local screen preview container on stage
        let localVideo = document.getElementById('local-video');
        if (!localVideo) {
            localVideo = document.createElement('video');
            localVideo.id = 'local-video';
            localVideo.className = "w-full h-full bg-black rounded border border-indigo-500 object-cover";
            localVideo.autoplay = true;
            localVideo.muted = true; // Avoid feedback loops locally
            videoGrid.appendChild(localVideo);
        }
        localVideo.srcObject = screenStream;

        // Replace stream tracks across all downstream peers in mesh real-time
        Object.values(peers).forEach(peer => {
            if (screenVideoTrack) peer.replaceTrack(localStream.getVideoTracks()[0], screenVideoTrack, localStream);
            if (screenAudioTrack) peer.replaceTrack(localStream.getAudioTracks()[0], screenAudioTrack, localStream);
        });

        // Event handler tracking when screen share stops execution natively via the browser bar
        screenVideoTrack.onended = () => stopScreenShare();

    } catch (err) {
        console.error("Unable to execute sound-enabled screen share:", err);
    }
};

function stopScreenShare() {
    if (!screenStream) return;
    screenStream.getTracks().forEach(track => track.stop());
    const localVid = document.getElementById('local-video');
    if (localVid) localVid.remove();
    
    // Revert active tracks back to microphone default profiles for safety
    Object.values(peers).forEach(peer => {
        // Re-bind microphone track pipelines over the signaling channels
    });
}

function createPeer(userToSignal, callerId, stream) {
    const peer = new SimplePeer({ initiator: true, trickle: false, stream });
    peer.on('signal', signal => {
        socket.emit('sending-signal', { userToSignal, callerId, signal, nickname: myNickname });
    });
    peer.on('stream', stream => appendRemoteStream(stream, userToSignal));
    return peer;
}

function addPeer(incomingSignal, callerId, stream) {
    const peer = new SimplePeer({ initiator: false, trickle: false, stream });
    peer.on('signal', signal => {
        socket.emit('returning-signal', { signal, callerId });
    });
    peer.on('stream', stream => appendRemoteStream(stream, callerId));
    peer.signal(incomingSignal);
    return peer;
}

function appendRemoteStream(stream, userId) {
    let video = document.getElementById(userId);
    if (!video) {
        video = document.createElement('video');
        video.id = userId;
        video.className = "w-full h-full bg-black rounded border border-gray-700 object-cover";
        video.autoplay = true;
        videoGrid.appendChild(video);
    }
    video.srcObject = stream;
}

function addParticipantRoster(name, id) {
    const li = document.createElement('li');
    li.id = `roster-${id}`;
    li.innerText = `● ${name}`;
    userList.appendChild(li);
}

socket.on('user-left', data => {
    if (peers[data.id]) peers[data.id].destroy();
    delete peers[data.id];
    const vid = document.getElementById(data.id);
    if (vid) vid.remove();
    const rosterItem = document.getElementById(`roster-${data.id}`);
    if (rosterItem) rosterItem.remove();
});
