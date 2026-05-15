import { eventSource, event_types, saveSettingsDebounced, getRequestHeaders, characters, this_chid, name1 } from '../../../../script.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { oai_settings } from '../../../openai.js'; 

const MODULE_NAME = 'custom-standing-ext';

const API_MODELS = {
    openai: ['gpt-5.2', 'gpt-5.2-2025-12-11', 'gpt-5.1', 'gpt-5.1-2025-11-13', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano', 'gpt-4o', 'gpt-4o-2024-11-20', 'gpt-4o-mini', 'chatgpt-4o-latest', 'gpt-4.1', 'gpt-4.1-mini', 'gpt-4.1-nano', 'gpt-4.5-preview', 'o1', 'o1-mini', 'o1-preview', 'o3', 'o3-mini', 'o4-mini'],
    claude: ['claude-opus-4-5', 'claude-sonnet-4-5', 'claude-haiku-4-5', 'claude-opus-4-1', 'claude-opus-4-0', 'claude-sonnet-4-0', 'claude-3-7-sonnet-latest', 'claude-3-7-sonnet-20250219', 'claude-3-5-sonnet-latest', 'claude-3-5-sonnet-20241022', 'claude-3-5-haiku-latest', 'claude-3-5-haiku-20241022', 'claude-3-opus-20240229', 'claude-3-haiku-20240307'],
    makersuite: ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-exp', 'gemini-2.0-flash-lite', 'gemini-2.0-flash-lite-001'],
    vertexai: ['gemini-3.1-pro-preview', 'gemini-3.1-flash-lite-preview', 'gemini-3-pro-preview', 'gemini-3-flash-preview', 'gemini-2.5-pro', 'gemini-2.5-flash', 'gemini-2.5-flash-lite', 'gemini-2.0-flash', 'gemini-2.0-flash-001', 'gemini-2.0-flash-exp', 'gemini-2.0-flash-lite-001'],
    openrouter: [],
    cohere: ['command-r-plus', 'command-r-plus-08-2024', 'command-r', 'command-a'],
    deepseek: ['deepseek-chat', 'deepseek-reasoner'],
    groq: ['qwen/qwen3-32b', 'deepseek-r1-distill-llama-70b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'gemma2-9b-it']
};

const DEFAULT_PROMPT = `Analyze the emotional state of ALL active Characters and the User in the latest messages.
CRITICAL RULE: DO NOT invent new keywords. You MUST select exactly ONE exact keyword from their AVAILABLE lists below. If nothing fits perfectly, pick the closest one or a neutral one.

[AVAILABLE SPRITE LISTS]
{{character_lists}}
User ({{user_name}}) Keywords: [ {{user_keywords}} ]

Output ONLY valid JSON like this:
{
  "expressions": [
    { "name": "ExactCharacterName", "expression": "exact_keyword_from_list", "transition": "bounce", "isActive": true },
    { "name": "{{user_name}}", "expression": "exact_keyword_from_user_list", "transition": "none", "isActive": false }
  ]
}

[isActive RULE]
- true: The character/user is currently speaking, actively reacting, or is the main focus of the current scene.
- false: The character/user is absent, asleep, ignoring the scene, or just standing silently in the background.

Transition guide:
- crossfade: smooth blend
- bounce: playful scale bounce
- shake: quick horizontal tremor
- hop: small vertical hop
- none: instant swap`;

let extSettings = {};
let assetsMap = {}; 
let activeSubChars = [];

let editMode = false;
let editTarget = 'default'; 
let isDragging = false;
let startX, startY, initialLeft, initialTop;

jQuery(async () => {
    try {
        const html = await $.get(`/scripts/extensions/third-party/${MODULE_NAME}/index.html`);
        const $html = $(html);
        
        $('body').append($html.filter('#multi-char-display-container'));
        $('body').append($html.filter('#cs-edit-controls'));
        $('#extensions_settings').append($html.filter('#custom_standing_settings'));
        
        initSettings();
        bindGlobalEvents();
        setupDragAndDrop();

        eventSource.on(event_types.CHAT_CHANGED, () => {
            refreshActiveSubChars();
            renderSubCharsUI();
            loadAllAssets();
        });
        
        // 핸들러 연결
        eventSource.on(event_types.MESSAGE_RECEIVED, handleAIResponse);
        
        if (this_chid !== undefined) {
            refreshActiveSubChars();
            renderSubCharsUI();
            loadAllAssets();
        }

        console.log(`[${MODULE_NAME}] 활성화 스위치 패치 버전 로드 완료!`);
    } catch (e) { console.error(e); }
});

function initSettings() {
    if (!extension_settings.customSpriteExt) {
        extension_settings.customSpriteExt = {};
    }
    extSettings = extension_settings.customSpriteExt;
    
    // 🌟 활성화 스위치 기본값 설정
    if (extSettings.isEnabled === undefined) extSettings.isEnabled = true;
    $('#cs-enable-extension').prop('checked', extSettings.isEnabled);

    if (!extSettings.systemPrompt || !extSettings.systemPrompt.includes('isActive')) {
        extSettings.systemPrompt = DEFAULT_PROMPT;
    }
    
    if (extSettings.contextSize === undefined) extSettings.contextSize = 3;
    if (!extSettings.apiProvider) extSettings.apiProvider = 'default';
    if (!extSettings.userScale) extSettings.userScale = 1.0;
    
    if (extSettings.frameType === undefined) {
        extSettings.frameType = extSettings.showFrame ? 'basic' : 'none'; 
    }
    $('#cs-frame-type').val(extSettings.frameType);

    if (!extSettings.botSubChars) extSettings.botSubChars = {};

    $('#cs-context-size').val(extSettings.contextSize);
    $('#cs-api-provider').val(extSettings.apiProvider);
    $('#cs-system-prompt').val(extSettings.systemPrompt);
    
    updateModelList();
}

function refreshActiveSubChars() {
    if (this_chid === undefined) {
        activeSubChars = [];
        return;
    }
    const character = characters[this_chid];
    if (!character) {
        activeSubChars = [];
        return;
    }
    const baseName = character.avatar.replace(/\.[^/.]+$/, '');
    
    if (!extSettings.botSubChars) extSettings.botSubChars = {};
    
    if (!extSettings.botSubChars[baseName]) {
        extSettings.botSubChars[baseName] = [{ 
            id: 'default', 
            name: '메인 캐릭터', 
            scale: 1.0, 
            posX: '', 
            posY: '' 
        }];
    }
    
    activeSubChars = extSettings.botSubChars[baseName];
}

function applyFrameStyle() {
    $('.custom-sprite-img').removeClass('frame-basic frame-polaroid frame-glowing frame-elegant');
    if (extSettings.frameType && extSettings.frameType !== 'none') {
        $('.custom-sprite-img').addClass(`frame-${extSettings.frameType}`);
    }
}

function renderSubCharsUI() {
    const $settingsContainer = $('#multi-char-settings-container');
    const $displayContainer = $('#multi-char-display-container');
    const $targetContainer = $('#cs-edit-target-container');
    
    $settingsContainer.empty();
    $displayContainer.empty();
    $targetContainer.empty();

    if (activeSubChars.length === 0) return;

// 확장이 켜져 있을 때만 화면에 스프라이트 컨테이너 추가
    if (extSettings.isEnabled) {
        $displayContainer.append(`
            <div id="wrapper-user" class="standing-wrapper" data-target="user" style="position:fixed; bottom:0; left:10%; z-index:10000; pointer-events:none; transition: outline 0.2s, background 0.2s;">
                <div id="display-user" style="transform-origin: bottom center; pointer-events:none;"></div>
            </div>
        `);
    }
    $targetContainer.append(`<label style="cursor:pointer; color:#34d399; white-space:nowrap;"><input type="radio" name="cs-edit-target" value="user"> 🧑 페르소나</label>`);

    activeSubChars.forEach((sc, index) => {
        // 설정 블록 생성 로직은 유지 (생략)
        const blockHtml = `
            <div class="sub-char-block" data-id="${sc.id}" style="padding:12px; border:1px solid #4b5563; border-radius:8px; background:rgba(0,0,0,0.2);">
                <div class="flex-container" style="justify-content: space-between; margin-bottom:10px; flex-wrap: wrap; gap: 5px;">
                    <div style="display:flex; align-items:center; gap:10px;">
                        <label style="color: #60a5fa; margin:0; font-size:15px; white-space:nowrap;"><b>👤 ${sc.name}</b></label>
                        <button class="menu_button rename-sc-btn" data-id="${sc.id}" style="padding: 2px 8px; font-size: 11px; white-space:nowrap;"><i class="fa-solid fa-pen"></i> 이름 변경</button>
                    </div>
                    ${index !== 0 ? `<button class="menu_button danger_button delete-sc-btn" data-id="${sc.id}" style="padding: 2px 8px; font-size: 11px; white-space:nowrap;"><i class="fa-solid fa-trash"></i> 캐릭 삭제</button>` : ''}
                </div>
                <div class="flex-container flexWrap" style="gap: 8px;">
                    <button class="menu_button upload-sc-btn" data-id="${sc.id}" style="white-space:nowrap; flex:1;"><i class="fa-solid fa-file-upload"></i> 업로드</button>
                    <input type="file" id="upload-input-${sc.id}" data-id="${sc.id}" class="sc-file-input" multiple accept="image/*" style="display:none;">
                    <button class="menu_button danger_button clear-sc-btn" data-id="${sc.id}" style="white-space:nowrap; flex:1;"><i class="fa-solid fa-trash"></i> 비우기</button>
                </div>
                <div id="preview-${sc.id}" class="asset-grid-container" style="margin-top:10px;"></div>
            </div>
        `;
        $settingsContainer.append(blockHtml);

        if (extSettings.isEnabled) {
            $displayContainer.append(`
                <div id="wrapper-${sc.id}" class="standing-wrapper" data-target="${sc.id}" style="position:fixed; bottom:0; right:${10 + (index * 5)}%; z-index:10000; pointer-events:none; transition: outline 0.2s, background 0.2s;">
                    <div id="display-${sc.id}" style="transform-origin: bottom center; pointer-events:none;"></div>
                </div>
            `);
        }

        $targetContainer.prepend(`<label style="cursor:pointer; color:#60a5fa; white-space:nowrap;"><input type="radio" name="cs-edit-target" value="${sc.id}" ${index === 0 ? 'checked' : ''}> 👤 ${sc.name}</label>`);
    });
    bindSubCharEvents();
    applyDisplaySettings();
}

function applyDisplaySettings() {
    $('#display-user').css('transform', `scale(${extSettings.userScale})`);
    if (extSettings.userPosX && extSettings.userPosY) {
        $('#wrapper-user').css({ left: extSettings.userPosX, top: extSettings.userPosY, right: 'auto', bottom: 'auto' });
    } else {
        $('#wrapper-user').css({ left: '10%', top: 'auto', right: 'auto', bottom: '0' });
    }

    activeSubChars.forEach(sc => {
        $(`#display-${sc.id}`).css('transform', `scale(${sc.scale})`);
        if (sc.posX && sc.posY) {
            $(`#wrapper-${sc.id}`).css({ left: sc.posX, top: sc.posY, right: 'auto', bottom: 'auto' });
        } else {
            $(`#wrapper-${sc.id}`).css({ left: 'auto', top: 'auto', right: '10%', bottom: '0' });
        }
    });
}

function updateEditTargetUI() {
    const isUser = editTarget === 'user';
    let activeScale = isUser ? extSettings.userScale : 1.0;
    
    if (!isUser) {
        const sc = activeSubChars.find(s => s.id === editTarget);
        if (sc) activeScale = sc.scale;
    }
    
    $('#cs-sprite-scale').val(activeScale);
    $('#cs-scale-val').text(activeScale);

    $('.standing-wrapper').each(function() {
        const id = $(this).data('target');
        if (id === editTarget) {
            const isUserTarget = id === 'user';
            $(this).css({
                'pointer-events': 'auto',
                'outline': `3px dashed ${isUserTarget ? '#34d399' : '#60a5fa'}`,
                'background': isUserTarget ? 'rgba(52, 211, 153, 0.1)' : 'rgba(96, 165, 250, 0.1)',
                'z-index': 10001
            });
        } else {
            $(this).css({ 'pointer-events': 'none', 'outline': 'none', 'background': 'transparent', 'z-index': 10000 });
        }
    });
}

function toggleEditMode(forceState) {
    editMode = forceState !== undefined ? forceState : !editMode;
    const $controls = $('#cs-edit-controls');
    const $toggleBtn = $('#cs-toggle-edit-mode');
    
    if (editMode) {
        $('#cs-edit-mode-text').text('수정 완료 (설정 창 닫기)');
        $toggleBtn.css('background-color', 'var(--SmartThemeQuoteColor, #374151)');
        $controls.css('display', 'flex');
        
        editTarget = $('input[name="cs-edit-target"]:checked').val() || (activeSubChars.length > 0 ? activeSubChars[0].id : 'user');
        updateEditTargetUI();

        if ($('#display-user').is(':empty') && assetsMap['user']?.length > 0) updateDisplay(assetsMap['user'][0].label, 'none', 'user', true);
        activeSubChars.forEach(sc => {
            if ($(`#display-${sc.id}`).is(':empty') && assetsMap[sc.id]?.length > 0) {
                updateDisplay(assetsMap[sc.id][0].label, 'none', sc.id, true);
            }
        });
    } else {
        $('#cs-edit-mode-text').text('스탠딩 수정 모드 켜기');
        $toggleBtn.css('background-color', '');
        $controls.css('display', 'none');
        
        $('.standing-wrapper').css({ 'pointer-events': 'none', 'outline': 'none', 'background': 'transparent' });
        
        extSettings.userPosX = $('#wrapper-user').css('left');
        extSettings.userPosY = $('#wrapper-user').css('top');
        activeSubChars.forEach(sc => {
            sc.posX = $(`#wrapper-${sc.id}`).css('left');
            sc.posY = $(`#wrapper-${sc.id}`).css('top');
        });
        save();
    }
}

function getFolderName(targetId) {
    if (targetId === 'user') {
        const safePersonaName = (name1 || 'User').replace(/[^a-zA-Z0-9가-힣]/g, '_');
        return `user_standing_${safePersonaName}`; 
    }
    
    const character = characters[this_chid];
    if (!character) return null;
    const baseName = character.avatar.replace(/\.[^/.]+$/, '');
    
    if (targetId === 'default') return `${baseName}_standing`;
    
    const subChar = activeSubChars.find(s => s.id === targetId);
    if (subChar) {
        const safeSubName = subChar.name.replace(/[^a-zA-Z0-9가-힣]/g, '_');
        return `${baseName}_standing_${safeSubName}`;
    }
    
    return `${baseName}_standing_${targetId}`; 
}

async function loadAllAssets() {
    if (this_chid === undefined) return;
    await loadAssets('user');
    for (const sc of activeSubChars) {
        await loadAssets(sc.id);
    }
}

async function loadAssets(targetId) {
    const folderName = getFolderName(targetId);
    const $div = targetId === 'user' ? $('#cs-user-asset-preview') : $(`#preview-${targetId}`);
    const $display = $(`#display-${targetId}`);
    
    $div.empty();
    assetsMap[targetId] = [];

    if (!folderName) {
        if(targetId !== 'user') $div.html('<span style="color:#aaa; font-size:12px;">캐릭터를 먼저 선택해주세요.</span>');
        $display.empty();
        return;
    }

    try {
        const result = await fetch(`/api/sprites/get?name=${encodeURIComponent(folderName)}`);
        if (!result.ok) throw new Error("에셋 없음");
        
        const assets = await result.json();
        assetsMap[targetId] = assets;
        
        if (assets.length === 0) {
            $div.html('<span style="color:#aaa; font-size:12px;">저장된 에셋이 없습니다.</span>');
            $display.empty();
            return;
        }

        assets.forEach(asset => {
            const fileName = asset.path.split('/').pop().split('?')[0];
            $div.append(`
                <div class="asset-item" style="position:relative;">
                    <img src="${asset.path}" title="${fileName}">
                    <span>${asset.label}</span>
                    <div class="delete-asset-btn" data-target="${targetId}" data-label="${asset.label}" data-filename="${fileName}" style="position:absolute; top:2px; right:2px; background:rgba(255,0,0,0.7); color:white; border-radius:50%; width:18px; height:18px; text-align:center; line-height:16px; cursor:pointer; font-size:10px;">X</div>
                </div>
            `);
        });

        if (extSettings.isEnabled && $display.is(':empty') && assets.length > 0) {
            updateDisplay(assets[0].label, 'none', targetId, true);
        }

    } catch (e) { console.error(`[${MODULE_NAME}] 로드 에러:`, e); }
}

async function handleImageUpload(targetId, file) {
    const folderName = getFolderName(targetId);
    if (!folderName) return alert("폴더를 찾을 수 없습니다!");

    const label = file.name.split('.')[0];
    const formData = new FormData();
    formData.append('name', folderName);
    formData.append('label', label);
    formData.append('avatar', file);
    formData.append('spriteName', label);

    try {
        await jQuery.ajax({ type: 'POST', url: '/api/sprites/upload', data: formData, processData: false, contentType: false, cache: false });
    } catch (error) { alert("업로드 중 오류 발생"); }
}

async function deleteAsset(targetId, label, fileName) {
    const folderName = getFolderName(targetId);
    if (!folderName) return;
    const spriteName = fileName.split('.').slice(0, -1).join('.');

    try {
        await jQuery.ajax({ type: 'POST', url: '/api/sprites/delete', data: JSON.stringify({ name: folderName, label: label, spriteName: spriteName }), contentType: 'application/json', cache: false });
        await loadAssets(targetId); 
    } catch (error) {}
}

function bindGlobalEvents() {
// 🌟 끄기/켜기 이벤트 바인딩 및 화면 즉시 갱신
    $('#cs-enable-extension').on('change', function() {
        const isEnabled = $(this).is(':checked');
        extSettings.isEnabled = isEnabled;
        save();

        if (isEnabled) {
            // 다시 켰을 때는 UI를 새로 그려서 스프라이트를 나타나게 함
            renderSubCharsUI();
            loadAllAssets();
        } else {
            // 껐을 때는 화면에서 즉시 제거
            $('#multi-char-display-container').empty();
            if (editMode) toggleEditMode(false);
        }
    });

    $('#cs-context-size').on('input', function() { extSettings.contextSize = Number($(this).val()); save(); });
    $('#cs-api-provider').on('change', function() { extSettings.apiProvider = $(this).val(); updateModelList(); save(); });
    $('#cs-api-model').on('change', function() { extSettings.apiModel = $(this).val(); save(); });
    $('#cs-system-prompt').on('input', function() { extSettings.systemPrompt = $(this).val(); save(); });

    $('#cs-frame-type').on('change', function() {
        extSettings.frameType = $(this).val();
        applyFrameStyle();
        save();
    });

    $('#cs-refresh-user').on('click', () => loadAssets('user'));
    $('#cs-toggle-edit-mode').on('click', () => toggleEditMode());
    $('#cs-close-edit').on('click', () => toggleEditMode(false));

    $(document).on('change', 'input[name="cs-edit-target"]', function() {
        editTarget = $(this).val();
        updateEditTargetUI();
    });

    $('#cs-sprite-scale').on('input', function() {
        const val = $(this).val();
        $('#cs-scale-val').text(val);
        if (editTarget === 'user') {
            extSettings.userScale = val;
            $('#display-user').css('transform', `scale(${val})`);
        } else {
            const sc = activeSubChars.find(s => s.id === editTarget);
            if (sc) {
                sc.scale = val;
                $(`#display-${sc.id}`).css('transform', `scale(${val})`);
            }
        }
    });

    $('#cs-reset-display').on('click', function() {
        extSettings.userScale = 1.0; extSettings.userPosX = ''; extSettings.userPosY = '';
        activeSubChars.forEach(sc => { sc.scale = 1.0; sc.posX = ''; sc.posY = ''; });
        if (editMode) toggleEditMode(false);
        applyDisplaySettings();
        save();
    });

    $('#cs-user-asset-upload').on('change', async function(e) {
        if (!e.target.files.length) return;
        for (let file of e.target.files) await handleImageUpload('user', file);
        $(this).val(''); await loadAssets('user'); 
    });
    $('#cs-clear-user-assets').on('click', async function() {
        if(confirm("모든 페르소나 에셋을 삭제하시겠습니까?")) {
            const arr = assetsMap['user'] || [];
            for (let a of arr) await deleteAsset('user', a.label, a.path.split('/').pop().split('?')[0]);
        }
    });

    $(document).on('click', '.delete-asset-btn', async function() {
        if(confirm("이미지를 폴더에서 완전히 삭제하시겠습니까?")) {
            await deleteAsset($(this).data('target'), $(this).data('label'), $(this).data('filename'));
        }
    });

    $('#cs-add-sub-char-btn').off('click').on('click', function() {
        if (this_chid === undefined) return alert("먼저 채팅방(캐릭터)에 입장해주세요!");
        
        const name = prompt("추가할 캐릭터의 이름을 입력하세요:");
        if (!name || !name.trim()) return;
        
        const newId = 'sub_' + Date.now();
        activeSubChars.push({ id: newId, name: name.trim(), scale: 1.0, posX: '', posY: '' });
        save();
        renderSubCharsUI();
        loadAllAssets(); 
    });
}

function bindSubCharEvents() {
    $('.rename-sc-btn').off('click').on('click', function() {
        const id = $(this).data('id');
        const sc = activeSubChars.find(s => s.id === id);
        if (!sc) return;
        const newName = prompt("새로운 이름을 입력하세요:", sc.name);
        if (newName && newName.trim()) {
            sc.name = newName.trim();
            save();
            renderSubCharsUI();
            loadAllAssets();
        }
    });

    $('.delete-sc-btn').off('click').on('click', function() {
        if(!confirm("이 캐릭터 슬롯을 완전히 삭제하시겠습니까?")) return;
        const id = $(this).data('id');
        
        const character = characters[this_chid];
        const baseName = character.avatar.replace(/\.[^/.]+$/, '');
        extSettings.botSubChars[baseName] = extSettings.botSubChars[baseName].filter(s => s.id !== id);
        activeSubChars = extSettings.botSubChars[baseName];
        
        delete assetsMap[id];
        save();
        renderSubCharsUI();
        loadAllAssets();
    });

    $('.upload-sc-btn').off('click').on('click', function() {
        $(`#upload-input-${$(this).data('id')}`).click();
    });

    $('.sc-file-input').off('change').on('change', async function(e) {
        const id = $(this).data('id');
        if (!e.target.files.length) return;
        for (let file of e.target.files) await handleImageUpload(id, file);
        $(this).val(''); await loadAssets(id); 
    });

    $('.clear-sc-btn').off('click').on('click', async function() {
        const id = $(this).data('id');
        if(confirm("이 캐릭터의 모든 에셋을 삭제하시겠습니까?")) {
            const arr = assetsMap[id] || [];
            for (let a of arr) await deleteAsset(id, a.label, a.path.split('/').pop().split('?')[0]);
        }
    });
}

function setupDragAndDrop() {
    $('body').on('mousedown touchstart', '.standing-wrapper', function(e) {
        if (!editMode || $(this).data('target') !== editTarget) return;
        isDragging = true;
        const ev = e.type === 'touchstart' ? e.originalEvent.touches[0] : e;
        const rect = this.getBoundingClientRect();
        initialLeft = rect.left; initialTop = rect.top;
        startX = ev.clientX; startY = ev.clientY;
        $(this).css({ left: initialLeft + 'px', top: initialTop + 'px', right: 'auto', bottom: 'auto' });
        e.preventDefault();
    });

    $(document).on('mousemove touchmove', function(e) {
        if (!isDragging) return;
        const ev = e.type === 'touchmove' ? e.originalEvent.touches[0] : e;
        $(`#wrapper-${editTarget}`).css({ 
            left: (initialLeft + (ev.clientX - startX)) + 'px', 
            top: (initialTop + (ev.clientY - startY)) + 'px' 
        });
    });

    $(document).on('mouseup touchend', function() {
        if (isDragging) isDragging = false;
    });
}

function updateModelList() {
    const provider = $('#cs-api-provider').val();
    const $select = $('#cs-api-model');
    const $container = $('#cs-model-container');
    $select.empty();
    if (provider === 'default') { $container.hide(); return; }
    $container.show();
    if (API_MODELS[provider] && API_MODELS[provider].length > 0) {
        API_MODELS[provider].forEach(m => $select.append(`<option value="${m}">${m}</option>`));
        $select.val(extSettings.apiModel || API_MODELS[provider][0]);
    } else if (provider === 'openrouter') $select.append(`<option value="">(기본 설정 사용)</option>`);
}

function save() { saveSettingsDebounced(); }

function handleAIResponse(messageId) {
    // 🌟 확장이 비활성화 상태라면 즉시 리턴하여 AI 요청 차단!
    if (extSettings.isEnabled === false) return; 

    (async () => {
        const context = getContext();
        if (!context || !context.chat) return;
        const msg = context.chat[messageId];
        if (!msg || msg.is_user) return;

        let charListsStr = '';
        let hasAnyAsset = false;
        activeSubChars.forEach(sc => {
            const keys = (assetsMap[sc.id] || []).map(a => a.label).join(', ') || 'None';
            if (keys !== 'None') hasAnyAsset = true;
            charListsStr += `Character '${sc.name}' Keywords: [ ${keys} ]\n`;
        });

        const userKeys = (assetsMap['user'] || []).map(a => a.label).join(', ') || 'None';
        if (userKeys !== 'None') hasAnyAsset = true;
        
        // 에셋이 하나도 없으면 API 호출 방지
        if (!hasAnyAsset) return;

        const chatLog = context.chat.slice(-extSettings.contextSize).map(m => `${m.is_user?'User':'AI'}: ${m.mes}`).join('\n\n');
        const safeUserName = name1 || 'User';
        
        let systemPrompt = extSettings.systemPrompt || DEFAULT_PROMPT;
        systemPrompt = systemPrompt
            .replace(/\{\{character_lists\}\}/g, charListsStr.trim())
            .replace(/\{\{user_keywords\}\}/g, userKeys)
            .replace(/\{\{user_name\}\}/g, safeUserName);
        
        const finalPrompt = `${systemPrompt}\n\nChat History:\n${chatLog}`;

        try {
            const reqBody = { messages: [{ role: 'system', content: finalPrompt }], temperature: 0.1, stream: false };
            let apiSource = '';

            if (extSettings.apiProvider !== 'default') {
                apiSource = extSettings.apiProvider;
                reqBody.chat_completion_source = apiSource;
                if (extSettings.apiModel) reqBody.model = extSettings.apiModel;
            } else {
                apiSource = $('#chat_completion_source').val();
                reqBody.chat_completion_source = apiSource;
            }

            if (apiSource === 'vertexai' || apiSource === 'vertex') {
                reqBody.vertexai_auth_mode = oai_settings.vertexai_auth_mode || 'express';
                reqBody.vertexai_region = oai_settings.vertexai_region || 'global';
                if (reqBody.vertexai_auth_mode === 'express' && oai_settings.vertexai_express_project_id) {
                    reqBody.vertexai_express_project_id = oai_settings.vertexai_express_project_id;
                }
            }

            const res = await fetch('/api/backends/chat-completions/generate', { method: 'POST', headers: { ...getRequestHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(reqBody) });
            if (!res.ok) return;

            const data = await res.json();
            let text = data?.choices?.[0]?.message?.content || data?.candidates?.[0]?.content?.parts?.[0]?.text || data?.content?.[0]?.text || (typeof data === 'string' ? data : "");
            const jsonMatch = text.match(/\{[\s\S]*\}/);
            
            if (jsonMatch) {
                const json = JSON.parse(jsonMatch[0]);
                if (json.expressions && Array.isArray(json.expressions)) {
                    json.expressions.forEach(exp => {
                        const reqName = (exp.name || exp.characterName || exp.characterId || '').toLowerCase();
                        const isActive = exp.isActive !== false; 
                        
                        if (exp.isUser === true || reqName === safeUserName.toLowerCase() || reqName === 'user') {
                            updateDisplay(exp.expression, exp.transition || 'none', 'user', isActive);
                            return;
                        }
                        const matchedChar = activeSubChars.find(sc => sc.name.toLowerCase() === reqName);
                        if (matchedChar) {
                            updateDisplay(exp.expression, exp.transition || 'none', matchedChar.id, isActive);
                        } else if (activeSubChars.length === 1) {
                            updateDisplay(exp.expression, exp.transition || 'none', activeSubChars[0].id, isActive);
                        }
                    });
                }
            }
        } catch (e) { console.error(`[${MODULE_NAME}] 에러:`, e); }
    })();
}

function updateDisplay(expLabel, trans, targetId, isActive = true) {
    const assets = assetsMap[targetId] || [];
    if (assets.length === 0) return;
    
    let asset = assets.find(a => a.label.toLowerCase() === String(expLabel).toLowerCase());
    if (!asset) {
        console.warn(`[${MODULE_NAME}] 감정 지어내기 감지: ${expLabel}. 표정을 유지합니다.`);
        const $existingImg = $(`#display-${targetId} img`);
        if ($existingImg.length > 0) {
            const filterStyle = isActive ? 'brightness(1)' : 'brightness(0.4)';
            const opacityStyle = isActive ? '1' : '0.7';
            $existingImg.css({ filter: filterStyle, opacity: opacityStyle });
        }
        return; 
    }

    const filterStyle = isActive ? 'brightness(1)' : 'brightness(0.4)';
    const opacityStyle = isActive ? '1' : '0.7';
    const frameClass = (extSettings.frameType && extSettings.frameType !== 'none') ? `frame-${extSettings.frameType}` : '';

    const $box = $(`#display-${targetId}`);
    $box.empty().append(`<img src="${asset.path}" class="custom-sprite-img ${trans} ${frameClass}" style="pointer-events: none; -webkit-user-drag: none; max-height:85vh; filter: ${filterStyle}; opacity: ${opacityStyle}; transition: filter 0.3s ease, opacity 0.3s ease;">`);
    setTimeout(() => $box.find('img').removeClass(trans), 500);
}