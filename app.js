document.addEventListener('DOMContentLoaded', () => {
    
    // ==========================================
    // CONFIGURACIÓN Y REFERENCIAS
    // ==========================================
    const CONFIG = {
        width: 800,
        height: 600,
        layerCount: 4,
        maxHistory: 30
    };

    // UI Elements
    const appGrid = document.getElementById('appGrid');
    const canvasContainer = document.getElementById('canvasContainer');
    const zoomLayer = document.getElementById('zoomLayer');
    const brushCursor = document.getElementById('brushCursor');
    const zoomInfo = document.getElementById('zoomInfo');
    const timelineStrip = document.getElementById('timelineStrip');
    
    // Auxiliares
    const auxCanvas = document.getElementById('auxCanvas');
    const auxCtx = auxCanvas.getContext('2d', { willReadFrequently: true });
    
    // Onion Skin
    const onionSkinCanvas = document.getElementById('onionSkinCanvas');
    const onionCtx = onionSkinCanvas.getContext('2d');
    const btnOnionSkin = document.getElementById('btnOnionSkin');

    // Capas de dibujo
    const canvases = [];
    const contexts = [];
    for(let i = 0; i < CONFIG.layerCount; i++) {
        const c = document.getElementById(`layer${i}`);
        canvases.push(c);
        contexts.push(c.getContext('2d', { willReadFrequently: true }));
    }

    // ==========================================
    // ESTADO DE LA APLICACIÓN
    // ==========================================
    const STATE = {
        currentFrameIndex: 0,
        frames: [],         
        frameHistories: [], 
        
        isPlaying: false,
        playInterval: null,
        fps: 12,
        
        // PINCEL AVANZADO
        tool: 'brush',
        brushColor: '#000000',
        brushSize: 5,
        brushOpacity: 1, // 0 a 1
        brushStyle: 'round', // round, square, spray, marker
        
        activeLayerIndex: 0,
        isDrawing: false,
        
        // Zoom
        scale: 1,
        panX: 0,
        panY: 0,
        lastThumbUpdate: 0
    };

    let currentUndoStack = [];
    let currentRedoStack = [];

    // ==========================================
    // CORE: DIBUJO AVANZADO
    // ==========================================

    function clearAllLayers() {
        contexts.forEach(ctx => ctx.clearRect(0, 0, CONFIG.width, CONFIG.height));
    }

    function createEmptyFrameData() {
        const temp = document.createElement('canvas');
        temp.width = CONFIG.width; temp.height = CONFIG.height;
        const emptyData = temp.toDataURL();
        return new Array(CONFIG.layerCount).fill(emptyData);
    }

    function getLayersData() {
        return canvases.map(c => c.toDataURL());
    }

    function loadLayersData(frameData) {
        clearAllLayers();
        if (!frameData) return;
        frameData.forEach((dataUrl, idx) => {
            if (dataUrl && dataUrl.length > 50) {
                const img = new Image();
                img.onload = () => contexts[idx].drawImage(img, 0, 0);
                img.src = dataUrl;
            }
        });
    }

    // --- LÓGICA DE DIBUJO ---
    function draw(x, y, isDrag) {
        const ctx = contexts[STATE.activeLayerIndex];
        
        // Configuración Común
        ctx.globalAlpha = STATE.brushOpacity;
        ctx.strokeStyle = STATE.brushColor;
        ctx.fillStyle = STATE.brushColor;

        if (STATE.tool === 'eraser') {
            ctx.globalCompositeOperation = 'destination-out';
            ctx.globalAlpha = 1; // El borrador borra fuerte siempre
            ctx.lineWidth = STATE.brushSize;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
            if (!isDrag) ctx.beginPath();
            ctx.lineTo(x, y);
            ctx.stroke();
            return;
        } 
        
        // MODO PINCEL
        ctx.globalCompositeOperation = 'source-over';

        // 1. SPRAY / AERÓGRAFO
        if (STATE.brushStyle === 'spray') {
            const radius = STATE.brushSize;
            const density = Math.max(1, radius * 1.5); // Más puntos cuanto más grande
            
            for (let i = 0; i < density; i++) {
                // Punto aleatorio dentro del círculo
                const angle = Math.random() * Math.PI * 2;
                const r = Math.sqrt(Math.random()) * radius;
                const px = x + r * Math.cos(angle);
                const py = y + r * Math.sin(angle);
                
                ctx.fillRect(px, py, 1, 1);
            }
            return; // El spray no usa lineTo
        }

        // 2. OTROS ESTILOS (Trazado continuo)
        ctx.lineWidth = STATE.brushSize;
        
        if (STATE.brushStyle === 'round') {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        } else if (STATE.brushStyle === 'square') {
            ctx.lineCap = 'square';
            ctx.lineJoin = 'bevel';
        } else if (STATE.brushStyle === 'marker') {
            ctx.lineCap = 'square';
            ctx.lineJoin = 'round';
            // El marcador es semitransparente acumulativo
            if(STATE.brushOpacity > 0.5) ctx.globalAlpha = 0.5; 
        }

        if (!isDrag) {
            ctx.beginPath();
            ctx.moveTo(x, y);
        }
        
        ctx.lineTo(x, y);
        ctx.stroke();

        // Restaurar Alpha
        ctx.globalAlpha = 1.0;
    }

    // ==========================================
    // GESTIÓN DE FRAMES
    // ==========================================

    function saveCurrentFrameData() {
        if (STATE.currentFrameIndex < 0) return;
        STATE.frames[STATE.currentFrameIndex] = getLayersData();
        STATE.frameHistories[STATE.currentFrameIndex] = {
            undo: [...currentUndoStack],
            redo: [...currentRedoStack]
        };
    }

    function changeFrame(newIndex) {
        if (newIndex < 0 || newIndex >= STATE.frames.length) return;
        
        if (STATE.currentFrameIndex >= 0 && STATE.currentFrameIndex < STATE.frames.length) {
            saveCurrentFrameData();
            updateStaticThumbnail(STATE.currentFrameIndex);
        }

        STATE.currentFrameIndex = newIndex;
        loadLayersData(STATE.frames[newIndex]);

        if (!STATE.frameHistories[newIndex]) {
            STATE.frameHistories[newIndex] = { undo: [], redo: [] };
        }
        currentUndoStack = STATE.frameHistories[newIndex].undo || [];
        currentRedoStack = STATE.frameHistories[newIndex].redo || [];

        updateUI();
        updateOnionSkin();
        scrollToActiveThumbnail();
    }

    // ==========================================
    // MINIATURAS (PREVISUALIZACIÓN)
    // ==========================================

    async function generateCleanThumbnailURL(frameIndex) {
        if (!STATE.frames[frameIndex]) return null;
        const tempC = document.createElement('canvas');
        tempC.width = CONFIG.width; tempC.height = CONFIG.height;
        const tempCtx = tempC.getContext('2d');
        tempCtx.fillStyle = "#FFFFFF"; 
        tempCtx.fillRect(0, 0, CONFIG.width, CONFIG.height);
        const frameLayers = STATE.frames[frameIndex];
        await Promise.all(frameLayers.map(src => new Promise(resolve => {
            if (!src || src.length < 50) { resolve(); return; }
            const img = new Image();
            img.onload = () => { tempCtx.drawImage(img, 0, 0); resolve(); };
            img.onerror = () => resolve(); 
            img.src = src;
        })));
        return tempC.toDataURL('image/jpeg', 0.5);
    }

    function updateLiveThumbnail() {
        const now = Date.now();
        if (now - STATE.lastThumbUpdate < 30) return;
        STATE.lastThumbUpdate = now;
        auxCtx.fillStyle = "#FFFFFF"; auxCtx.fillRect(0, 0, CONFIG.width, CONFIG.height);
        canvases.forEach(c => auxCtx.drawImage(c, 0, 0));
        const activeBox = timelineStrip.querySelector(`.frame-box[data-index="${STATE.currentFrameIndex}"] img`);
        if (activeBox) activeBox.src = auxCanvas.toDataURL('image/jpeg', 0.5);
    }

    function updateStaticThumbnail(index) {
        const boxImg = timelineStrip.querySelector(`.frame-box[data-index="${index}"] img`);
        if (boxImg) generateCleanThumbnailURL(index).then(url => { if(url) boxImg.src = url; });
    }

    // ==========================================
    // ONION SKIN
    // ==========================================
    let isOnionEnabled = false;

    function updateOnionSkin() {
        onionCtx.clearRect(0, 0, CONFIG.width, CONFIG.height);
        if (!isOnionEnabled || STATE.currentFrameIndex === 0 || STATE.isPlaying) return;

        const prevFrameLayers = STATE.frames[STATE.currentFrameIndex - 1];
        if (!prevFrameLayers) return;

        const loadPromises = prevFrameLayers.map(src => new Promise(resolve => {
            if(!src || src.length < 50) { resolve(null); return; }
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            img.src = src;
        }));

        Promise.all(loadPromises).then(images => {
            onionCtx.globalCompositeOperation = 'source-over';
            onionCtx.clearRect(0, 0, CONFIG.width, CONFIG.height);
            images.forEach(img => { if(img) onionCtx.drawImage(img, 0, 0); });
            
            onionCtx.globalCompositeOperation = 'source-in';
            onionCtx.fillStyle = 'rgba(50, 150, 255, 1)'; 
            onionCtx.fillRect(0, 0, CONFIG.width, CONFIG.height);
            onionSkinCanvas.style.opacity = '0.3';
            onionCtx.globalCompositeOperation = 'source-over';
        });
    }

    btnOnionSkin.addEventListener('click', () => {
        isOnionEnabled = !isOnionEnabled;
        btnOnionSkin.classList.toggle('active', isOnionEnabled);
        updateOnionSkin();
    });

    // ==========================================
    // INPUTS Y EVENTOS UI
    // ==========================================
    
    // Zoom
    const rect = canvasContainer.parentElement.getBoundingClientRect();
    STATE.panX = (rect.width - CONFIG.width) / 2;
    STATE.panY = (rect.height - CONFIG.height) / 2;
    applyZoom();

    function applyZoom() {
        zoomLayer.style.transform = `translate(${STATE.panX}px, ${STATE.panY}px) scale(${STATE.scale})`;
        zoomInfo.textContent = Math.round(STATE.scale * 100) + '%';
        updateCursor();
    }

    function getPointerPos(e) {
        const r = canvasContainer.getBoundingClientRect();
        return {
            x: (e.clientX - r.left - STATE.panX) / STATE.scale,
            y: (e.clientY - r.top - STATE.panY) / STATE.scale
        };
    }

    function updateCursor(e) {
        const size = STATE.brushSize * STATE.scale;
        brushCursor.style.width = size + 'px';
        brushCursor.style.height = size + 'px';
        
        // Cambio visual del cursor según tipo
        if (STATE.brushStyle === 'square') brushCursor.style.borderRadius = '0';
        else brushCursor.style.borderRadius = '50%';
        
        // Punteado para spray
        if (STATE.brushStyle === 'spray') brushCursor.style.borderStyle = 'dotted';
        else brushCursor.style.borderStyle = 'solid';

        if(e) {
            const r = canvasContainer.getBoundingClientRect();
            brushCursor.style.left = (e.clientX - r.left) + 'px';
            brushCursor.style.top = (e.clientY - r.top) + 'px';
        }
    }

    // Eventos de Mouse Canvas
    canvasContainer.addEventListener('wheel', (e) => {
        e.preventDefault();
        const delta = -Math.sign(e.deltaY) * 0.1;
        STATE.scale = Math.min(Math.max(0.1, STATE.scale + delta), 5);
        applyZoom();
        updateCursor(e);
    }, { passive: false });

    canvasContainer.addEventListener('mousemove', (e) => {
        updateCursor(e);
        if (STATE.isPlaying) return;
        if (STATE.isDrawing) {
            const pos = getPointerPos(e);
            draw(pos.x, pos.y, true);
            updateLiveThumbnail(); 
        }
    });

    canvasContainer.addEventListener('mousedown', (e) => {
        if (STATE.isPlaying) return;
        if (e.button === 0) {
            pushHistory(); 
            STATE.isDrawing = true;
            const pos = getPointerPos(e);
            draw(pos.x, pos.y, false);
            updateLiveThumbnail();
        }
        if (e.button === 1) { // Pan
            e.preventDefault();
            const startX = e.clientX, startY = e.clientY;
            const initialPanX = STATE.panX, initialPanY = STATE.panY;
            const onMove = (evt) => {
                STATE.panX = initialPanX + (evt.clientX - startX);
                STATE.panY = initialPanY + (evt.clientY - startY);
                applyZoom();
            };
            const onUp = () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
            window.addEventListener('mousemove', onMove); window.addEventListener('mouseup', onUp);
        }
    });

    window.addEventListener('mouseup', () => {
        if (STATE.isDrawing) {
            STATE.isDrawing = false;
            contexts[STATE.activeLayerIndex].beginPath();
            saveCurrentFrameData(); 
        }
    });

    canvasContainer.addEventListener('mouseenter', () => brushCursor.style.display = 'block');
    canvasContainer.addEventListener('mouseleave', () => { brushCursor.style.display = 'none'; STATE.isDrawing = false; });

    // ==========================================
    // HISTORIAL Y TIMELINE
    // ==========================================
    function pushHistory() {
        currentUndoStack.push(getLayersData());
        if (currentUndoStack.length > CONFIG.maxHistory) currentUndoStack.shift();
        currentRedoStack = []; 
    }

    function performUndo() {
        if (currentUndoStack.length === 0) return;
        currentRedoStack.push(getLayersData());
        loadLayersData(currentUndoStack.pop());
        saveCurrentFrameData();
        updateLiveThumbnail();
        updateOnionSkin();
    }

    function performRedo() {
        if (currentRedoStack.length === 0) return;
        currentUndoStack.push(getLayersData());
        loadLayersData(currentRedoStack.pop());
        saveCurrentFrameData();
        updateLiveThumbnail();
        updateOnionSkin();
    }

    function renderTimeline() {
        timelineStrip.innerHTML = '';
        STATE.frames.forEach((_, index) => {
            const box = document.createElement('div');
            box.className = 'frame-box';
            if (index === STATE.currentFrameIndex) box.classList.add('active');
            box.dataset.index = index;
            box.draggable = true;
            
            const img = document.createElement('img'); img.src = ''; 
            generateCleanThumbnailURL(index).then(url => { if(url) img.src = url; });

            const badge = document.createElement('span');
            badge.className = 'frame-num-badge'; badge.textContent = index + 1;

            const controls = document.createElement('div');
            controls.className = 'frame-controls';
            
            const btnLeft = document.createElement('button');
            btnLeft.className = 'move-btn'; btnLeft.textContent = '<';
            btnLeft.onclick = (e) => { e.stopPropagation(); moveFrame(index, index - 1); };

            const btnRight = document.createElement('button');
            btnRight.className = 'move-btn'; btnRight.textContent = '>';
            btnRight.onclick = (e) => { e.stopPropagation(); moveFrame(index, index + 1); };

            if(index > 0) controls.appendChild(btnLeft); else controls.appendChild(document.createElement('div'));
            if(index < STATE.frames.length -1) controls.appendChild(btnRight);

            box.appendChild(img); box.appendChild(badge); box.appendChild(controls);
            box.addEventListener('click', () => { if(!STATE.isPlaying) changeFrame(index); });
            
            box.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/plain', index); box.classList.add('dragging'); });
            box.addEventListener('dragend', () => box.classList.remove('dragging'));
            box.addEventListener('dragover', (e) => e.preventDefault());
            box.addEventListener('drop', (e) => { e.preventDefault(); const fromIdx = parseInt(e.dataTransfer.getData('text/plain')); moveFrame(fromIdx, index); });

            timelineStrip.appendChild(box);
        });
        updateUI();
    }

    function moveFrame(fromIndex, toIndex) {
        if (toIndex < 0 || toIndex >= STATE.frames.length) return;
        saveCurrentFrameData();
        const fData = STATE.frames.splice(fromIndex, 1)[0];
        STATE.frames.splice(toIndex, 0, fData);
        const hData = STATE.frameHistories.splice(fromIndex, 1)[0];
        STATE.frameHistories.splice(toIndex, 0, hData);
        if (STATE.currentFrameIndex === fromIndex) STATE.currentFrameIndex = toIndex;
        else if (STATE.currentFrameIndex === toIndex && fromIndex < toIndex) STATE.currentFrameIndex--;
        else if (STATE.currentFrameIndex === toIndex && fromIndex > toIndex) STATE.currentFrameIndex++;
        renderTimeline();
        scrollToActiveThumbnail();
    }

    // Botones Frames
    document.getElementById('btnAddFrame').addEventListener('click', () => {
        saveCurrentFrameData();
        STATE.frames.splice(STATE.currentFrameIndex + 1, 0, createEmptyFrameData());
        STATE.frameHistories.splice(STATE.currentFrameIndex + 1, 0, { undo:[], redo:[] });
        changeFrame(STATE.currentFrameIndex + 1);
        renderTimeline();
    });

    document.getElementById('btnDupFrame').addEventListener('click', () => {
        saveCurrentFrameData();
        STATE.frames.splice(STATE.currentFrameIndex + 1, 0, [...STATE.frames[STATE.currentFrameIndex]]);
        STATE.frameHistories.splice(STATE.currentFrameIndex + 1, 0, { undo:[], redo:[] });
        changeFrame(STATE.currentFrameIndex + 1);
        renderTimeline();
    });

    document.getElementById('btnDelFrame').addEventListener('click', () => {
        if (STATE.frames.length <= 1) { alert("Mínimo 1 frame"); return; }
        STATE.frames.splice(STATE.currentFrameIndex, 1);
        STATE.frameHistories.splice(STATE.currentFrameIndex, 1);
        let newIdx = STATE.currentFrameIndex;
        if (newIdx >= STATE.frames.length) newIdx = STATE.frames.length - 1;
        STATE.currentFrameIndex = newIdx;
        loadLayersData(STATE.frames[newIdx]);
        const h = STATE.frameHistories[newIdx];
        currentUndoStack = h.undo; currentRedoStack = h.redo;
        renderTimeline();
        updateOnionSkin();
    });

    // ==========================================
    // UI UPDATES Y EVENTOS DE PROPIEDADES
    // ==========================================

    function updateUI() {
        document.getElementById('frameIndicator').textContent = `Frame ${STATE.currentFrameIndex + 1}/${STATE.frames.length}`;
        const boxes = timelineStrip.querySelectorAll('.frame-box');
        boxes.forEach(b => b.classList.remove('active'));
        const active = timelineStrip.querySelector(`.frame-box[data-index="${STATE.currentFrameIndex}"]`);
        if(active) active.classList.add('active');
    }

    function scrollToActiveThumbnail() {
        const active = timelineStrip.querySelector('.frame-box.active');
        if(active) active.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }

    // HERRAMIENTAS IZQUIERDA
    document.getElementById('btnBrush').onclick = () => { STATE.tool = 'brush'; updateToolBtns(); };
    document.getElementById('btnEraser').onclick = () => { STATE.tool = 'eraser'; updateToolBtns(); };
    function updateToolBtns() {
        document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('active'));
        if(STATE.tool==='brush') document.getElementById('btnBrush').classList.add('active');
        else document.getElementById('btnEraser').classList.add('active');
    }

    // PROPIEDADES DERECHA
    const brushBtns = document.querySelectorAll('.brush-btn');
    brushBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            brushBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            STATE.brushStyle = btn.dataset.type;
            updateCursor();
        });
    });

    document.getElementById('colorPicker').addEventListener('input', (e) => STATE.brushColor = e.target.value);
    
    document.getElementById('brushSize').addEventListener('input', (e) => {
        STATE.brushSize = parseInt(e.target.value);
        document.getElementById('brushSizeVal').textContent = STATE.brushSize + ' px';
        updateCursor();
    });
    
    document.getElementById('brushOpacity').addEventListener('input', (e) => {
        const val = parseInt(e.target.value);
        STATE.brushOpacity = val / 100;
        document.getElementById('brushOpacityVal').textContent = val + '%';
    });

    document.getElementById('btnClearLayer').addEventListener('click', () => {
        pushHistory();
        contexts[STATE.activeLayerIndex].clearRect(0, 0, CONFIG.width, CONFIG.height);
        saveCurrentFrameData();
        updateLiveThumbnail();
    });

    document.querySelectorAll('input[name="layer"]').forEach(radio => {
        radio.addEventListener('change', (e) => {
            STATE.activeLayerIndex = parseInt(e.target.value);
            document.querySelectorAll('.layer-row').forEach(row => row.classList.remove('active-layer'));
            e.target.closest('.layer-row').classList.add('active-layer');
        });
    });

    // PANELES COLLAPSE
    const togglePanel = (id, className, btnShowId) => {
        appGrid.classList.add(className);
        document.getElementById(btnShowId).style.display = 'flex';
    };
    const showPanel = (id, className, btnShowId) => {
        appGrid.classList.remove(className);
        document.getElementById(btnShowId).style.display = 'none';
    };

    document.getElementById('btnToggleLeft').onclick = () => togglePanel('leftPanel', 'hide-left', 'btnShowLeft');
    document.getElementById('btnShowLeft').onclick = () => showPanel('leftPanel', 'hide-left', 'btnShowLeft');
    
    document.getElementById('btnToggleRight').onclick = () => togglePanel('rightPanel', 'hide-right', 'btnShowRight');
    document.getElementById('btnShowRight').onclick = () => showPanel('rightPanel', 'hide-right', 'btnShowRight');
    
    document.getElementById('btnToggleTimeline').onclick = () => togglePanel('timelinePanel', 'hide-bottom', 'btnShowTimeline');
    document.getElementById('btnShowTimeline').onclick = () => showPanel('timelinePanel', 'hide-bottom', 'btnShowTimeline');

    // PLAYBACK
    const btnPlay = document.getElementById('btnPlayPause');
    btnPlay.onclick = togglePlay;
    document.getElementById('fpsInputNumber').onchange = (e) => { STATE.fps = parseInt(e.target.value) || 12; if(STATE.isPlaying){togglePlay(); togglePlay();} };

    function togglePlay() {
        if (STATE.isPlaying) {
            STATE.isPlaying = false;
            clearInterval(STATE.playInterval);
            btnPlay.textContent = "▶";
            btnPlay.classList.remove('playing');
            brushCursor.style.display = 'block';
            onionSkinCanvas.style.display = 'block';
            changeFrame(STATE.currentFrameIndex);
        } else {
            saveCurrentFrameData();
            STATE.isPlaying = true;
            btnPlay.textContent = "⏸";
            btnPlay.classList.add('playing');
            brushCursor.style.display = 'none';
            onionSkinCanvas.style.display = 'none';
            STATE.playInterval = setInterval(() => {
                let next = STATE.currentFrameIndex + 1;
                if (next >= STATE.frames.length) next = 0;
                STATE.currentFrameIndex = next;
                loadLayersData(STATE.frames[next]);
                const nextBox = timelineStrip.querySelector(`.frame-box[data-index="${next}"]`);
                if(nextBox) nextBox.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
                document.getElementById('frameIndicator').textContent = `Frame ${next + 1}/${STATE.frames.length}`;
            }, 1000 / STATE.fps);
        }
    }

    document.addEventListener('keydown', (e) => {
        if (e.target.tagName === 'INPUT') return;
        if (e.ctrlKey && e.key.toLowerCase() === 'z') { e.preventDefault(); performUndo(); }
        if (e.ctrlKey && e.key.toLowerCase() === 'y') { e.preventDefault(); performRedo(); }
        if (e.code === 'Space') { e.preventDefault(); togglePlay(); }
    });

    // EXPORT
    document.getElementById('btnExportWebM').addEventListener('click', async () => {
        if (STATE.isPlaying) togglePlay();
        const btn = document.getElementById('btnExportWebM');
        const origText = btn.textContent;
        btn.textContent = "..."; btn.disabled = true;
        const stream = auxCanvas.captureStream(STATE.fps);
        const recorder = new MediaRecorder(stream, { mimeType: 'video/webm; codecs=vp9' });
        const chunks = [];
        recorder.ondataavailable = e => { if (e.data.size > 0) chunks.push(e.data); };
        recorder.onstop = () => {
            const blob = new Blob(chunks, { type: 'video/webm' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a'); a.href = url; a.download = 'animacion.webm';
            a.click(); URL.revokeObjectURL(url);
            btn.textContent = origText; btn.disabled = false;
            loadLayersData(STATE.frames[STATE.currentFrameIndex]);
        };
        recorder.start();
        for (let i = 0; i < STATE.frames.length; i++) {
            auxCtx.fillStyle = "#FFFFFF"; auxCtx.fillRect(0,0,CONFIG.width, CONFIG.height);
            const layers = STATE.frames[i];
            for (let l = 0; l < layers.length; l++) {
                 await new Promise(r => {
                     const img = new Image(); img.onload = () => { auxCtx.drawImage(img,0,0); r(); }; img.onerror = r; img.src = layers[l];
                 });
            }
            await new Promise(r => setTimeout(r, 1000 / STATE.fps));
        }
        recorder.stop();
    });

    // INIT
    STATE.frames.push(createEmptyFrameData());
    STATE.frameHistories.push({ undo: [], redo: [] });
    changeFrame(0);
    renderTimeline();
});