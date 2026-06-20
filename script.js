// Ініціалізація Socket.IO
const socket = io();
let currentActiveChatPartner = null;

// Налаштування PeerJS для відео/аудіо дзвінків (з STUN серверами Google для пробиття NAT)
const peer = new Peer(undefined, {
    config: {
        'iceServers': [
            { url: 'stun:stun.l.google.com:19302' },
            { url: 'stun:stun1.l.google.com:19302' }
        ]
    }
});

let localStream;
let currentCall;

peer.on('open', (id) => {
    console.log('Мій Peer ID:', id);
    // Тут можна відправити свій ID на сервер через Socket.io для прив'язки до профілю
    socket.emit('register_peer', id);
});

// Обробка вхідних дзвінків
peer.on('call', (call) => {
    document.getElementById('call-modal').style.display = 'flex';
    document.getElementById('call-status-text').innerText = 'Вхідний дзвінок...';
    document.getElementById('btn-accept-call').style.display = 'block';
    
    document.getElementById('btn-accept-call').onclick = () => {
        navigator.mediaDevices.getUserMedia({ video: true, audio: true })
            .then((stream) => {
                localStream = stream;
                document.getElementById('local-video').srcObject = stream;
                call.answer(stream); // Відповідаємо на дзвінок
                setupCallEvents(call);
            }).catch(err => console.error('Помилка доступу до медіа', err));
    };
});

function startCall(isVideo) {
    if (!currentActiveChatPartner) return alert('Оберіть співрозмовника!');
    
    // Отримуємо Peer ID партнера через Socket.io або з бази
    // const partnerPeerId = getPartnerPeerId(currentActiveChatPartner); 
    
    navigator.mediaDevices.getUserMedia({ video: isVideo, audio: true })
        .then((stream) => {
            localStream = stream;
            document.getElementById('call-modal').style.display = 'flex';
            document.getElementById('call-video-container').style.display = isVideo ? 'block' : 'none';
            document.getElementById('local-video').srcObject = stream;
            
            // Замість 'partner_peer_id' підставте реальний ID співрозмовника
            const call = peer.call('partner_peer_id', stream); 
            setupCallEvents(call);
        });
}

function setupCallEvents(call) {
    currentCall = call;
    document.getElementById('btn-accept-call').style.display = 'none';
    document.getElementById('call-status-text').innerText = 'З\'єднання встановлено';
    
    call.on('stream', (remoteStream) => {
        document.getElementById('remote-video').srcObject = remoteStream;
    });
    
    call.on('close', endCall);
}

function endCall() {
    if (currentCall) currentCall.close();
    if (localStream) localStream.getTracks().forEach(track => track.stop());
    document.getElementById('call-modal').style.display = 'none';
}

// === Медіа рекордер (Аудіо та Кружечки) ===
let mediaRecorder;
let recordedChunks = [];
let recordType = '';

async function startMediaRecording(type) {
    recordType = type;
    const isVideo = type === 'video_circle';
    
    try {
        const stream = await navigator.mediaDevices.getUserMedia({
            audio: true, 
            video: isVideo ? { facingMode: "user", width: 400, height: 400 } : false 
        });
        
        document.getElementById('record-overlay').style.display = 'flex';
        
        if (isVideo) {
            const preview = document.getElementById('record-preview');
            preview.srcObject = stream;
            preview.classList.add('video-circle');
            preview.style.display = 'block';
        }
        
        mediaRecorder = new MediaRecorder(stream);
        recordedChunks = [];
        
        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) recordedChunks.push(e.data);
        };
        
        mediaRecorder.start();
        // Тут можна додати логіку таймера
    } catch (err) {
        console.error('Помилка мікрофона/камери:', err);
    }
}

function finishAndSendRecord() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.onstop = () => {
            const blob = new Blob(recordedChunks, { type: recordType === 'video_circle' ? 'video/webm' : 'audio/webm' });
            
            // Відправка файлу через Socket.IO або на сервер
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                socket.emit('chat_message', {
                    to: currentActiveChatPartner,
                    type: recordType,
                    content: reader.result
                });
                renderMessage(reader.result, recordType, 'my-message');
            };
            
            // Зупиняємо треки
            mediaRecorder.stream.getTracks().forEach(t => t.stop());
            document.getElementById('record-overlay').style.display = 'none';
        };
        mediaRecorder.stop();
    }
}

function deleteRecord() {
    if (mediaRecorder) {
        mediaRecorder.stream.getTracks().forEach(t => t.stop());
    }
    document.getElementById('record-overlay').style.display = 'none';
}

// === Базова відправка повідомлень ===
document.getElementById('form').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = document.getElementById('input');
    if (input.value.trim() && currentActiveChatPartner) {
        socket.emit('chat_message', {
            to: currentActiveChatPartner,
            type: 'text',
            content: input.value
        });
        renderMessage(input.value, 'text', 'my-message');
        input.value = '';
    }
});

function renderMessage(content, type, senderClass) {
    const ul = document.getElementById('messages');
    const li = document.createElement('li');
    li.className = `message ${senderClass}`;
    
    if (type === 'text') {
        li.textContent = content;
    } else if (type === 'video_circle') {
        li.innerHTML = `<video src="${content}" class="video-circle" autoplay loop muted></video>`;
    }
    
    ul.appendChild(li);
    ul.scrollTop = ul.scrollHeight;
}

// Ініціалізація теми
document.body.style.display = 'flex'; // Показуємо після завантаження скриптів
