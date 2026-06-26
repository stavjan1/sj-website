// ==========================================================================
// Application Logic for SJ Electrical Engineering Quote Generator (Phase 4)
// Projects Manager & Dual-Agent AI Architecture (Pricing & Phrasing)
// ==========================================================================

// ==========================================================================
// Gemini model selection + daily quota
// ==========================================================================
let selectedGeminiModel = 'gemini-2.0-flash';
const MODEL_QUOTAS = { 'gemini-2.0-flash': 30, 'gemini-1.5-flash': 100 };
const MODEL_CIRCUMFERENCE = 138.2; // 2ֿ€ֳ—22

function _todayKey() {
    return new Date().toISOString().slice(0, 10); // "2026-06-26"
}
function getDailyUsage(model) {
    const raw = localStorage.getItem('sj_quota_' + model + '_' + _todayKey());
    return parseInt(raw || '0', 10);
}
function incrementDailyUsage(model) {
    const key = 'sj_quota_' + model + '_' + _todayKey();
    localStorage.setItem(key, (getDailyUsage(model) + 1).toString());
    updateQuotaUI();
}
function isQuotaExceeded(model) {
    return getDailyUsage(model) >= MODEL_QUOTAS[model];
}
function getEffectiveModel() {
    if (!isQuotaExceeded(selectedGeminiModel)) return selectedGeminiModel;
    // Auto-fallback
    const fallback = selectedGeminiModel === 'gemini-2.0-flash' ? 'gemini-1.5-flash' : null;
    if (fallback && !isQuotaExceeded(fallback)) return fallback;
    return null; // both exhausted
}
function updateQuotaUI() {
    const model = selectedGeminiModel;
    const used  = getDailyUsage(model);
    const limit = MODEL_QUOTAS[model];
    const pct   = Math.min(100, Math.round((used / limit) * 100));
    const offset = MODEL_CIRCUMFERENCE * (1 - pct / 100);

    const arc = document.getElementById('quota-arc');
    if (arc) {
        arc.style.strokeDashoffset = offset;
        arc.style.stroke = pct >= 100 ? '#f05252' : pct >= 80 ? '#f0c040' : 'var(--color-accent)';
    }
    const pctEl = document.getElementById('quota-pct');
    if (pctEl) pctEl.textContent = pct + '%';
    const usedEl = document.getElementById('quota-used');
    if (usedEl) usedEl.textContent = used;
    const limitEl = document.getElementById('quota-limit');
    if (limitEl) limitEl.textContent = limit;
    const nameEl = document.getElementById('quota-model-name');
    if (nameEl) nameEl.textContent = (model === 'gemini-2.0-flash' ? 'Flash 2.0' : 'Flash 1.5') + ' ׳”׳™׳•׳';
}
function changeGeminiModel(model) {
    selectedGeminiModel = model;
    updateQuotaUI();
}

// Global (shared) Gemini API key ג€” admin sets once, everyone benefits
function getGeminiApiKey() {
    // Prefer user-specific key, then global fallback
    return appState.settings.geminiApiKey
        || localStorage.getItem('sj_gemini_key_global')
        || '';
}
function saveGlobalGeminiKey(key) {
    localStorage.setItem('sj_gemini_key_global', key);
}

// ==========================================================================
// Global state variables
let appState = {
    settings: {
        geminiApiKey: '',
        googleClientId: '4351198135-oltod8jremuq7pgn2e5bad4ahkupufkp.apps.googleusercontent.com',
        googleFolderId: '1FHfFPd5S9EtphEcGxKqw9oAZstKyQbjv',
        phrasingDb: '',
        logoStyle: { align: 'center', width: '75', marginTop: '0', marginBottom: '10' },
        businessDetails: {
            name: 'SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳',
            owner: "׳¡׳×׳™׳• ׳’'׳׳",
            id: '׳¢׳•׳¡׳§ ׳₪׳˜׳•׳¨: 207382920',
            phone: '053-530-2887',
            email: 'info@sj-eng.co.il',
            web: 'www.sj-eng.co.il',
            address: '׳“׳¨׳ ׳‘׳ ׳’׳•׳¨׳™׳•׳ 138, ׳‘׳× ׳™׳, ׳™׳—׳™׳“׳” 1304',
            terms: `׳×׳ ׳׳™ ׳×׳©׳׳•׳:
ג€¢ 50% ׳׳§׳“׳׳” ׳¢׳ ׳׳™׳©׳•׳¨ ׳”׳¦׳¢׳× ׳”׳׳—׳™׳¨ ׳•׳×׳—׳™׳׳× ׳”׳¢׳‘׳•׳“׳”.
ג€¢ 50% ׳”׳ ׳•׳×׳¨׳™׳ ׳¢׳ ׳׳¡׳™׳¨׳× ׳”׳×׳•׳›׳ ׳™׳•׳× ׳”׳¡׳•׳₪׳™׳•׳×.

׳”׳¢׳¨׳•׳× ׳ ׳•׳¡׳₪׳•׳×:
ג€¢ ׳›׳ ׳©׳™׳ ׳•׳™ ׳‘׳×׳•׳›׳ ׳™׳•׳× ׳׳׳—׳¨ ׳©׳׳‘ ׳”׳׳™׳©׳•׳¨ ׳”׳¨׳׳©׳•׳ ׳™ ׳¢׳©׳•׳™ ׳׳’׳¨׳•׳¨ ׳×׳•׳¡׳₪׳× ׳×׳©׳׳•׳.
ג€¢ ׳׳™׳•׳•׳™ ׳׳•׳ ׳—׳‘׳¨׳× ׳”׳—׳©׳׳ ׳׳™׳ ׳• ׳›׳•׳׳ ׳׳× ׳׳’׳¨׳•׳× ׳”׳‘׳“׳™׳§׳” ׳©׳ ׳—׳‘׳¨׳× ׳”׳—׳©׳׳.`
        }
    },
    currentQuote: {
        id: null,
        clientName: '',
        clientSub: '',
        quoteNumber: '',
        date: '',
        subject: '',
        items: [],
        basePrice: 0,
        vatType: 'exempt',
        finalPrice: 0,
        summary: '',
        showItemizedPrices: false
    },
    history: []
};

// Projects state
let projectsList = [];
let activeProjectId = null;

// Global variables for Stern Pricing and Google OAuth
let sternPricingDatabase = [];
let googleTokenClient = null;
let googleAccessToken = null;

// Initialize Application on Page Load
document.addEventListener('DOMContentLoaded', () => {
    // One-time Gemini key setup via URL: /sale/?key=AIza...
    const _urlParams = new URLSearchParams(window.location.search);
    const _urlKey = _urlParams.get('key');
    if (_urlKey) {
        saveGlobalGeminiKey(_urlKey);
        history.replaceState({}, '', window.location.pathname);
        showToast('׳׳₪׳×׳— Gemini ׳”׳•׳’׳“׳¨ ׳‘׳”׳¦׳׳—׳”');
    }

    // Load global Google Client ID from localStorage
    let globalClientId = localStorage.getItem('sj_global_google_client_id');
    if (!globalClientId) {
        globalClientId = '4351198135-oltod8jremuq7pgn2e5bad4ahkupufkp.apps.googleusercontent.com';
        localStorage.setItem('sj_global_google_client_id', globalClientId);
    }
    const lockClientId = document.getElementById('lock-google-client-id');
    if (lockClientId) lockClientId.value = globalClientId;
    const settingsClientId = document.getElementById('settings-drive-client-id');
    if (settingsClientId) settingsClientId.value = globalClientId;

    const activeUser = getActiveUser();
    if (!activeUser) {
        document.getElementById('lock-screen').style.display = 'flex';
        document.querySelector('.app-container').style.display = 'none';
        toggleLockForm('login');
    } else {
        document.getElementById('lock-screen').style.display = 'none';
        document.querySelector('.app-container').style.display = 'flex';
        initUserSession();
    }
    updateQuotaUI(); // initialize the quota ring on page load
});

function getActiveUser() {
    return localStorage.getItem('sj_logged_in_user') || sessionStorage.getItem('sj_logged_in_user');
}

function getSessionOrLocalStorageItem(key) {
    return localStorage.getItem(key) || sessionStorage.getItem(key);
}

function getStorageKey(key) {
    const activeUser = getActiveUser();
    if (!activeUser) return key;
    return `sj_user_${activeUser.toLowerCase()}_${key}`;
}

function initUserSession() {
    loadSettings();
    loadHistory();
    loadProjects();
    loadSternPricing();
    loadUploadedImages();
    checkGoogleSession();
    
    // Set default date to today
    document.getElementById('form-quote-date').value = getTodayDateString();
    
    // Switch to projects tab initially
    switchTab('projects');
    
    // Update user profile display in Settings
    updateUserProfileUI();
}

// Helper: Get today's date in YYYY-MM-DD
function getTodayDateString() {
    const today = new Date();
    const yyyy = today.getFullYear();
    let mm = today.getMonth() + 1;
    let dd = today.getDate();
    
    if (dd < 10) dd = '0' + dd;
    if (mm < 10) mm = '0' + mm;
    
    return `${yyyy}-${mm}-${dd}`;
}

// Helper: Format date for Hebrew display (DD/MM/YYYY)
function formatHebrewDate(dateString) {
    if (!dateString) return '';
    const parts = dateString.split('-');
    if (parts.length !== 3) return dateString;
    return `${parts[2]}/${parts[1]}/${parts[0]}`;
}

// Switch between panels (tabs)
function switchTab(tabId) {
    // If attempting to go to pricing or quote tabs without an active project, block it
    if ((tabId === 'wizard' || tabId === 'create') && !activeProjectId) {
        showToast('׳׳ ׳ ׳‘׳—׳¨ ׳׳• ׳¦׳•׳¨ ׳₪׳¨׳•׳™׳§׳˜ ׳×׳—׳™׳׳” ׳‘׳׳©׳•׳ ׳™׳× ׳ ׳™׳”׳•׳ ׳₪׳¨׳•׳™׳§׳˜׳™׳', 'error');
        switchTab('projects');
        return;
    }

    // Update nav buttons classes
    document.querySelectorAll('.nav-menu .nav-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    const targetTabBtn = document.getElementById(`tab-${tabId}`);
    if (targetTabBtn) targetTabBtn.classList.add('active');
    
    // Update content panels visibility
    document.querySelectorAll('.content-panel').forEach(panel => {
        panel.classList.remove('active');
    });
    const targetPanel = document.getElementById(`panel-${tabId}`);
    if (targetPanel) targetPanel.classList.add('active');
    
    if (tabId === 'history') {
        renderHistoryList();
    }
}

// ==========================================================================
// Projects State Management
// ==========================================================================
function loadProjects() {
    const saved = localStorage.getItem(getStorageKey('sj_projects'));
    if (saved) {
        try {
            projectsList = JSON.parse(saved);
        } catch (e) {
            console.error('Error loading projects', e);
        }
    } else {
        projectsList = [];
    }
    filterProjectsList();
    
    // Auto load last active or first project
    const savedActiveId = localStorage.getItem(getStorageKey('sj_active_project_id'));
    if (savedActiveId && projectsList.some(p => p.id === savedActiveId)) {
        loadProject(savedActiveId, false);
    } else if (projectsList.length > 0) {
        loadProject(projectsList[0].id, false);
    } else {
        updateActiveProjectBanner(null);
        switchTab('projects');
    }
}

function saveProjects() {
    localStorage.setItem(getStorageKey('sj_projects'), JSON.stringify(projectsList));
    localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
    syncDatabaseToDrive(true);
}

function createNewProject() {
    const input = document.getElementById('new-project-name');
    const name = input.value.trim();
    if (!name) {
        showToast('׳׳ ׳ ׳”׳–׳ ׳©׳ ׳₪׳¨׳•׳™׳§׳˜/׳׳§׳•׳—', 'error');
        return;
    }
    
    const newProj = {
        id: 'proj_' + Date.now(),
        name: name,
        created: getTodayDateString(),
        status: '׳˜׳™׳•׳˜׳”',
        chatHistory: [
            {
                role: 'model',
                parts: [{ text: `׳©׳׳•׳ ׳¡׳×׳™׳•! ׳׳ ׳™ ׳¡׳•׳›׳ ׳”-AI ׳”׳׳•׳׳—׳” ׳©׳׳ ׳׳×׳׳—׳•׳¨ ׳•׳ ׳™׳”׳•׳ ׳¢׳‘׳•׳“׳•׳× ׳—׳©׳׳.
׳×׳׳¨ ׳׳™ ׳׳× ׳”׳¢׳‘׳•׳“׳” ׳©׳׳×׳” ׳¨׳•׳¦׳” ׳׳×׳׳—׳¨ (׳׳׳©׳: "׳”׳×׳§׳ ׳× ׳¢׳׳“׳× ׳˜׳¢׳™׳ ׳” ׳‘׳׳¨׳—׳§ 15 ׳׳˜׳¨ ׳׳”׳׳•׳—"), 
׳•׳׳ ׳™ ׳׳¢׳–׳•׳¨ ׳׳ ׳׳—׳©׳‘ ׳¢׳׳•׳™׳•׳×, ׳׳׳×׳¨ ׳—׳•׳׳¨׳™׳ ׳ ׳“׳¨׳©׳™׳, ׳׳”׳©׳•׳•׳× ׳׳—׳™׳¨׳™׳ ׳‘׳©׳•׳§ (׳›׳׳• ׳‘׳׳×׳¨ ׳׳¨׳›׳”) ׳•׳׳–׳”׳•׳× ׳ ׳§׳•׳“׳•׳× ׳¢׳™׳•׳•׳¨׳•׳.` }]
            }
        ],
        materials: [],
        laborPrice: 0,
        quoteData: {
            clientName: name.split('-')[1]?.trim() || name,
            clientSub: '',
            quoteNumber: getNextQuoteNumber(),
            date: getTodayDateString(),
            subject: name.split('-')[0]?.trim() || name,
            items: [
                { title: '׳₪׳¨׳§ ׳\': ׳¢׳‘׳•׳“׳•׳× ׳”׳›׳ ׳”', description: '׳‘׳™׳¦׳•׳¢ ׳¢׳‘׳•׳“׳•׳× ׳”׳›׳ ׳” ׳•׳”׳×׳׳¨׳’׳ ׳•׳× ׳‘׳©׳˜׳—.', price: 0 }
            ],
            basePrice: 0,
            vatType: 'exempt',
            finalPrice: 0,
            summary: appState.settings.businessDetails.terms,
            showItemizedPrices: false
        }
    };
    
    projectsList.unshift(newProj);
    saveProjects();
    filterProjectsList();
    input.value = '';
    
    loadProject(newProj.id);
    showToast(`׳₪׳¨׳•׳™׳§׳˜ "${name}" ׳ ׳•׳¦׳¨ ׳‘׳”׳¦׳׳—׳”`);
    switchTab('wizard'); // Auto switch to pricing chat
}

function loadProject(id, navigate = true) {
    const proj = projectsList.find(p => p.id === id);
    if (!proj) return;
    
    activeProjectId = id;
    localStorage.setItem(getStorageKey('sj_active_project_id'), id);
    
    updateActiveProjectBanner(proj);
    filterProjectsList();
    
    // Load Gemini Pricing Chat log
    renderChatHistory(proj.chatHistory);
    
    // Load Materials checklist
    renderMaterialsChecklist(proj.materials);
    
    // Load labor price
    const laborInput = document.getElementById('wizard-labor-price');
    if (laborInput) {
        laborInput.value = proj.laborPrice || 0;
    }
    
    // Load Quote editor state
    appState.currentQuote = {
        id: proj.id,
        ...proj.quoteData
    };
    
    // Fill Quote Form
    fillFormFromState();
    
    // Apply checkboxes sync
    const toggleCheckbox = document.getElementById('form-itemized-prices-toggle');
    if (toggleCheckbox) {
        toggleCheckbox.checked = appState.currentQuote.showItemizedPrices || false;
    }
    const settingsToggle = document.getElementById('set-show-itemized-prices');
    if (settingsToggle) {
        settingsToggle.checked = appState.currentQuote.showItemizedPrices || false;
    }
    
    // Re-render form grid layout based on state
    toggleItemizedPrices(appState.currentQuote.showItemizedPrices, false);
    
    // Update PDF sheet
    updatePreviewFromForm();
    
    if (navigate) {
        switchTab('wizard');
        showToast(`׳₪׳¨׳•׳™׳§׳˜ "${proj.name}" ׳ ׳˜׳¢׳ ׳‘׳”׳¦׳׳—׳”`);
    }
}

function deleteProject(id, event) {
    if (event) event.stopPropagation();
    
    const proj = projectsList.find(p => p.id === id);
    if (!proj) return;
    
    if (!confirm(`׳”׳׳ ׳׳×׳” ׳‘׳˜׳•׳— ׳©׳‘׳¨׳¦׳•׳ ׳ ׳׳׳—׳•׳§ ׳׳× ׳”׳₪׳¨׳•׳™׳§׳˜ "${proj.name}" ׳׳¦׳׳™׳×׳•׳×?`)) {
        return;
    }
    
    projectsList = projectsList.filter(p => p.id !== id);
    saveProjects();
    filterProjectsList();
    
    if (activeProjectId === id) {
        activeProjectId = null;
        localStorage.removeItem(getStorageKey('sj_active_project_id'));
        updateActiveProjectBanner(null);
        initNewQuote();
        switchTab('projects');
    }
    
    showToast('׳”׳₪׳¨׳•׳™׳§׳˜ ׳ ׳׳—׳§ ׳‘׳”׳¦׳׳—׳”');
}

function updateActiveProjectBanner(proj) {
    const bannerName = document.getElementById('active-project-name');
    const bannerStatus = document.getElementById('active-project-status');
    
    if (proj) {
        bannerName.textContent = proj.name;
        bannerStatus.textContent = proj.status || '׳˜׳™׳•׳˜׳”';
        bannerStatus.style.display = 'inline-block';
    } else {
        bannerName.textContent = '׳׳™׳ ׳₪׳¨׳•׳™׳§׳˜ ׳₪׳¢׳™׳ (׳‘׳—׳¨ ׳׳• ׳¦׳•׳¨ ׳₪׳¨׳•׳™׳§׳˜ ׳×׳—׳™׳׳”)';
        bannerStatus.style.display = 'none';
    }
}

function filterProjectsList() {
    const q = (document.getElementById('project-search-q')?.value || '').trim().toLowerCase();
    const sort = document.getElementById('project-sort')?.value || 'newest';
    const statusFilter = document.getElementById('project-status-filter')?.value || 'all';

    let filtered = projectsList.slice();

    if (q) filtered = filtered.filter(p => p.name.toLowerCase().includes(q));
    if (statusFilter !== 'all') filtered = filtered.filter(p => (p.status || '׳˜׳™׳•׳˜׳”') === statusFilter);

    if (sort === 'newest')    filtered.sort((a, b) => new Date(b.created) - new Date(a.created));
    else if (sort === 'oldest')   filtered.sort((a, b) => new Date(a.created) - new Date(b.created));
    else if (sort === 'name-asc') filtered.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    else if (sort === 'name-desc') filtered.sort((a, b) => b.name.localeCompare(a.name, 'he'));

    renderProjectsList(filtered);
}

function cycleProjectStatus(projectId, e) {
    e.stopPropagation();
    const statuses = ['׳˜׳™׳•׳˜׳”', '׳ ׳©׳׳—', '׳”׳•׳©׳׳'];
    const proj = projectsList.find(p => p.id === projectId);
    if (!proj) return;
    const idx = statuses.indexOf(proj.status || '׳˜׳™׳•׳˜׳”');
    proj.status = statuses[(idx + 1) % statuses.length];
    saveProjects();
    filterProjectsList();
}

function renderProjectsList(list) {
    if (!list) list = projectsList;
    const container = document.getElementById('projects-list-container');
    if (!container) return;

    container.innerHTML = '';

    if (projectsList.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:40px;">׳׳™׳ ׳₪׳¨׳•׳™׳§׳˜׳™׳ ׳₪׳¢׳™׳׳™׳. ׳¦׳•׳¨ ׳₪׳¨׳•׳™׳§׳˜ ׳—׳“׳© ׳׳™׳׳™׳.</div>`;
        return;
    }
    if (list.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:40px;">׳׳ ׳ ׳׳¦׳׳• ׳₪׳¨׳•׳™׳§׳˜׳™׳ ׳”׳×׳•׳׳׳™׳ ׳׳—׳™׳₪׳•׳©.</div>`;
        return;
    }

    list.forEach(p => {
        const isActive = p.id === activeProjectId;
        const status = p.status || '׳˜׳™׳•׳˜׳”';
        const card = document.createElement('div');
        card.className = `project-card ${isActive ? 'active' : ''}`;
        card.onclick = () => loadProject(p.id);

        card.innerHTML = `
            <div class="project-info">
                <div class="project-title" style="display:flex; align-items:center; gap:8px;">
                    ${p.name}
                    <span class="project-status-badge status-badge-${status}"
                          onclick="cycleProjectStatus('${p.id}', event)"
                          title="׳׳—׳¥ ׳׳©׳™׳ ׳•׳™ ׳¡׳˜׳˜׳•׳¡">${status}</span>
                </div>
                <div class="project-meta">
                    <span><i class="fa-solid fa-calendar"></i> ${formatHebrewDate(p.created)}</span>
                </div>
            </div>
            <div class="project-actions">
                <button class="btn btn-secondary btn-small" onclick="loadProject('${p.id}', true)">
                    <i class="fa-solid fa-folder-open"></i> ׳˜׳¢׳
                </button>
                <button class="btn btn-danger btn-small" onclick="deleteProject('${p.id}', event)">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </div>
        `;
        container.appendChild(card);
    });
}

function syncCurrentQuoteToProject() {
    if (!activeProjectId) return;
    const proj = projectsList.find(p => p.id === activeProjectId);
    if (proj) {
        proj.quoteData = {
            clientName: document.getElementById('form-client-name').value,
            clientSub: document.getElementById('form-client-sub').value,
            quoteNumber: document.getElementById('form-quote-number').value,
            date: document.getElementById('form-quote-date').value,
            subject: document.getElementById('form-quote-subject').value,
            items: getWorkItemsFromForm(),
            basePrice: parseFloat(document.getElementById('form-base-price').value) || 0,
            vatType: document.getElementById('form-vat-type').value,
            finalPrice: appState.currentQuote.finalPrice,
            summary: document.getElementById('form-summary').value,
            showItemizedPrices: appState.currentQuote.showItemizedPrices || false
        };
        saveProjects();
    }
}

// ==========================================================================
// Settings & Config
// ==========================================================================
function loadSettings() {
    const saved = localStorage.getItem(getStorageKey('sj_quote_settings'));
    if (saved) {
        try {
            appState.settings = JSON.parse(saved);
            
            document.getElementById('settings-gemini-key').value = appState.settings.geminiApiKey || '';
            document.getElementById('settings-drive-client-id').value = appState.settings.googleClientId || localStorage.getItem('sj_global_google_client_id') || '';
            document.getElementById('settings-drive-folder-id').value = appState.settings.googleFolderId || '';
            document.getElementById('set-phrasing-db').value = appState.settings.phrasingDb || '';
            
            const biz = appState.settings.businessDetails;
            if (biz) {
                document.getElementById('set-biz-name').value = biz.name || '';
                document.getElementById('set-biz-owner').value = biz.owner || '';
                document.getElementById('set-biz-id').value = biz.id || '';
                document.getElementById('set-biz-phone').value = biz.phone || '';
                document.getElementById('set-biz-email').value = biz.email || '';
                document.getElementById('set-biz-web').value = biz.web || '';
                document.getElementById('set-biz-address').value = biz.address || '';
                document.getElementById('set-biz-terms').value = biz.terms || '';
            }
            
            if (appState.settings.logoStyle) {
                const ls = appState.settings.logoStyle;
                document.getElementById('set-logo-align').value = ls.align || 'center';
                document.getElementById('set-logo-width').value = ls.width || '75';
                document.getElementById('set-logo-margin-top').value = ls.marginTop || '0';
                document.getElementById('set-logo-margin-bottom').value = ls.marginBottom || '10';
                setTimeout(updateLogoStyles, 100);
            }
            
            if (appState.settings.profession) {
                const professionInput = document.getElementById('settings-profession-input');
                if (professionInput) professionInput.value = appState.settings.profession;
            }
        } catch (e) {
            console.error('Error loading settings', e);
        }
    }
}

function saveBusinessSettings() {
    appState.settings.businessDetails = {
        name: document.getElementById('set-biz-name').value,
        owner: document.getElementById('set-biz-owner').value,
        id: document.getElementById('set-biz-id').value,
        phone: document.getElementById('set-biz-phone').value,
        email: document.getElementById('set-biz-email').value,
        web: document.getElementById('set-biz-web').value,
        address: document.getElementById('set-biz-address').value,
        terms: document.getElementById('set-biz-terms').value
    };
    appState.settings.phrasingDb = document.getElementById('set-phrasing-db').value;
    
    localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
    localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
    showToast('׳”׳’׳“׳¨׳•׳× ׳”׳¢׳¡׳§ ׳ ׳©׳׳¨׳• ׳‘׳”׳¦׳׳—׳”');
    
    updatePreviewFromForm();
    syncCurrentQuoteToProject();
    syncDatabaseToDrive(true);
}

function saveGeminiKey() {
    const key = document.getElementById('settings-gemini-key').value.trim();
    appState.settings.geminiApiKey = key;
    saveGlobalGeminiKey(key); // ׳©׳׳•׳¨ ׳’׳׳•׳‘׳׳™׳× ג€” ׳›׳ ׳”׳׳©׳×׳׳©׳™׳ ׳׳©׳×׳׳©׳™׳ ׳‘׳׳₪׳×׳— ׳”׳–׳”
    localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
    localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
    syncDatabaseToDrive(true);
    showToast('׳׳₪׳×׳— API ׳ ׳©׳׳¨ ׳‘׳”׳¦׳׳—׳”');
}

function loadHistory() {
    const saved = localStorage.getItem(getStorageKey('sj_quote_history'));
    if (saved) {
        try {
            appState.history = JSON.parse(saved);
        } catch (e) {
            console.error('Error loading history', e);
        }
    } else {
        appState.history = [];
    }
}

function saveHistory() {
    localStorage.setItem(getStorageKey('sj_quote_history'), JSON.stringify(appState.history));
    localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
    syncDatabaseToDrive(true);
}

function getNextQuoteNumber() {
    const year = new Date().getFullYear();
    const yearQuotes = appState.history.filter(q => q.quoteNumber && q.quoteNumber.startsWith(year.toString()));
    let nextNum = yearQuotes.length + 101;
    
    while (appState.history.some(q => q.quoteNumber === `${year}-${nextNum}`)) {
        nextNum++;
    }
    
    return `${year}-${nextNum}`;
}

function initNewQuote() {
    appState.currentQuote = {
        id: null,
        clientName: '',
        clientSub: '',
        quoteNumber: getNextQuoteNumber(),
        date: getTodayDateString(),
        subject: '',
        items: [
            { title: '׳₪׳¨׳§ ׳\': ׳¢׳‘׳•׳“׳•׳× ׳”׳›׳ ׳”', description: '׳‘׳™׳¦׳•׳¢ ׳¢׳‘׳•׳“׳•׳× ׳”׳›׳ ׳” ׳•׳”׳×׳׳¨׳’׳ ׳•׳× ׳‘׳©׳˜׳—.', price: 0 }
        ],
        basePrice: 0,
        vatType: 'exempt',
        finalPrice: 0,
        summary: appState.settings.businessDetails.terms,
        showItemizedPrices: false
    };
    
    fillFormFromState();
    updatePreviewFromForm();
}

function fillFormFromState() {
    const q = appState.currentQuote;
    
    document.getElementById('form-client-name').value = q.clientName;
    document.getElementById('form-client-sub').value = q.clientSub;
    document.getElementById('form-quote-number').value = q.quoteNumber;
    document.getElementById('form-quote-date').value = q.date;
    document.getElementById('form-quote-subject').value = q.subject;
    document.getElementById('form-base-price').value = q.basePrice;
    document.getElementById('form-vat-type').value = q.vatType;
    document.getElementById('form-summary').value = q.summary;
    
    const container = document.getElementById('work-items-container');
    container.innerHTML = '';
    
    if (q.items && q.items.length > 0) {
        q.items.forEach((item) => {
            addWorkItemRow(item.title, item.description, item.price);
        });
    } else {
        addWorkItemRow('', '', 0);
    }
    
    calculateTotal();
}

function addWorkItemRow(title = '', description = '', price = 0) {
    const container = document.getElementById('work-items-container');
    const index = container.children.length + 1;
    const isItemized = appState.currentQuote.showItemizedPrices;
    
    const row = document.createElement('div');
    row.className = 'work-item-form-row';
    row.innerHTML = `
        <div class="work-item-form-grid ${isItemized ? '' : 'no-price-col'}">
            <div class="row-index">${index}</div>
            <div class="form-group" style="margin-bottom:0">
                <input type="text" class="item-title-input" placeholder="׳ ׳•׳©׳ ׳”׳¡׳¢׳™׳£ (׳׳׳©׳: ׳—׳™׳•׳•׳˜ ׳›׳‘׳׳™ ׳×׳§׳©׳•׳¨׳×)" value="${title}" oninput="updatePreviewFromForm()">
            </div>
            <div class="form-group" style="margin-bottom:0">
                <textarea class="item-desc-input" rows="2" placeholder="׳₪׳™׳¨׳•׳˜ ׳×׳›׳•׳׳× ׳”׳¢׳‘׳•׳“׳”..." oninput="updatePreviewFromForm()">${description}</textarea>
            </div>
            ${isItemized ? `
            <div class="form-group" style="margin-bottom:0">
                <input type="number" class="item-price-input" placeholder="׳׳—׳™׳¨" value="${price || ''}" oninput="calculateItemizedTotal()">
            </div>
            ` : ''}
            <button type="button" class="btn btn-danger btn-small" onclick="deleteWorkItemRow(this)" style="height:38px; width:38px; padding:0; justify-content:center;">
                <i class="fa-solid fa-trash-can"></i>
            </button>
        </div>
    `;
    
    container.appendChild(row);
    updateRowIndices();
    updatePreviewFromForm();
}

function deleteWorkItemRow(button) {
    const row = button.closest('.work-item-form-row');
    const container = document.getElementById('work-items-container');
    
    if (container.children.length <= 1) {
        showToast('׳—׳•׳‘׳” ׳׳”׳©׳׳™׳¨ ׳׳₪׳—׳•׳× ׳¡׳¢׳™׳£ ׳¢׳‘׳•׳“׳” ׳׳—׳“ ׳‘׳”׳¦׳¢׳× ׳”׳׳—׳™׳¨', 'error');
        return;
    }
    
    row.remove();
    updateRowIndices();
    
    if (appState.currentQuote.showItemizedPrices) {
        calculateItemizedTotal();
    } else {
        calculateTotal();
    }
    updatePreviewFromForm();
}

function updateRowIndices() {
    const container = document.getElementById('work-items-container');
    Array.from(container.children).forEach((row, idx) => {
        row.querySelector('.row-index').textContent = idx + 1;
    });
}

function getWorkItemsFromForm() {
    const items = [];
    const container = document.getElementById('work-items-container');
    
    Array.from(container.children).forEach(row => {
        const title = row.querySelector('.item-title-input').value.trim();
        const desc = row.querySelector('.item-desc-input').value.trim();
        const priceInput = row.querySelector('.item-price-input');
        const price = priceInput ? (parseFloat(priceInput.value) || 0) : 0;
        
        if (title || desc) {
            items.push({ title, description: desc, price });
        }
    });
    
    return items;
}

function calculateItemizedTotal() {
    const container = document.getElementById('work-items-container');
    let sum = 0;
    Array.from(container.children).forEach(row => {
        const priceInput = row.querySelector('.item-price-input');
        if (priceInput) {
            sum += parseFloat(priceInput.value) || 0;
        }
    });
    
    const basePriceInput = document.getElementById('form-base-price');
    basePriceInput.value = sum;
    basePriceInput.readOnly = true;
    basePriceInput.classList.add('readonly-highlight');
    
    calculateTotal();
}

function calculateTotal() {
    const basePriceInput = document.getElementById('form-base-price').value;
    const basePrice = parseFloat(basePriceInput) || 0;
    const vatType = document.getElementById('form-vat-type').value;
    
    let finalPrice = basePrice;
    let vatLabel = '׳₪׳˜׳•׳¨ ׳׳׳¢"׳ (׳¢׳•׳¡׳§ ׳₪׳˜׳•׳¨)';
    
    if (vatType === 'exclude') {
        finalPrice = basePrice * 1.17;
        vatLabel = '׳׳ ׳›׳•׳׳ ׳׳¢"׳ (׳ ׳•׳¡׳£ 17% ׳׳¢"׳)';
    } else if (vatType === 'include') {
        vatLabel = '׳›׳•׳׳ ׳׳¢"׳ (׳‘׳©׳™׳¢׳•׳¨ 17%)';
    }
    
    const roundedPrice = Number(finalPrice.toFixed(2));
    
    document.getElementById('form-final-price').value = formatPriceString(roundedPrice) + ' ׳©"׳—';
    document.getElementById('pdf-total-price').textContent = formatPriceString(roundedPrice) + ' ׳©"׳—';
    document.getElementById('pdf-vat-label').textContent = vatLabel;
    
    appState.currentQuote.basePrice = basePriceInput;
    appState.currentQuote.vatType = vatType;
    appState.currentQuote.finalPrice = roundedPrice;
    
    syncCurrentQuoteToProject();
}

function formatPriceString(val) {
    if (val === undefined || val === null) return '0';
    return val.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function updatePreviewFromForm() {
    const biz = appState.settings.businessDetails;
    
    const clientName = document.getElementById('form-client-name').value || '׳©׳ ׳”׳׳§׳•׳—';
    const clientSub = document.getElementById('form-client-sub').value || '׳›׳×׳•׳‘׳× ׳”׳׳§׳•׳— / ׳˜׳׳₪׳•׳';
    const quoteNumber = document.getElementById('form-quote-number').value || '2026-101';
    const quoteDate = document.getElementById('form-quote-date').value;
    const subject = document.getElementById('form-quote-subject').value || '׳ ׳•׳©׳ ׳”׳¦׳¢׳”';
    const summary = document.getElementById('form-summary').value;
    
    document.getElementById('pdf-client-name').textContent = clientName;
    document.getElementById('pdf-client-sub').textContent = clientSub;
    document.getElementById('pdf-number').textContent = quoteNumber;
    document.getElementById('pdf-date').textContent = formatHebrewDate(quoteDate);
    document.getElementById('pdf-subject').textContent = subject;
    document.getElementById('pdf-summary').textContent = summary;
    
    const footerTextElement = document.querySelector('.pdf-company-footer');
    if (footerTextElement && biz) {
        footerTextElement.innerHTML = `
            <div class="footer-row font-bold">
                <span>${biz.name}</span>
                <span class="bullet">|</span>
                <span>${biz.owner}</span>
                <span class="bullet">|</span>
                <span>${biz.id}</span>
            </div>
            <div class="footer-row text-secondary">
                <span>׳׳™׳׳™׳™׳: ${biz.email}</span>
                <span class="bullet">|</span>
                <span>׳¡׳׳•׳׳¨׳™: ${biz.phone}</span>
                <span class="bullet">|</span>
                <span>׳׳×׳¨: ${biz.web}</span>
            </div>
            <div class="footer-row text-secondary">
                <span>׳›׳×׳•׳‘׳×: ${biz.address}</span>
            </div>
            <div class="footer-notice">
                ׳”׳¦׳¢׳× ׳׳—׳™׳¨ ׳–׳• ׳×׳§׳₪׳” ׳׳©׳׳•׳©׳” ׳—׳•׳“׳©׳™׳. ׳¢׳ ׳׳™׳©׳•׳¨ ׳•׳—׳×׳™׳׳× ׳”׳׳§׳•׳— ׳×׳©׳׳© ׳›׳”׳¡׳›׳ ׳׳‘׳™׳¦׳•׳¢ ׳”׳¢׳‘׳•׳“׳” ׳‘׳”׳×׳׳ ׳׳׳׳•׳¨ ׳‘׳”.
            </div>
        `;
    }
    
    const itemsList = getWorkItemsFromForm();
    const pdfItemsContainer = document.getElementById('pdf-work-items');
    pdfItemsContainer.innerHTML = '';
    
    const isItemized = appState.currentQuote.showItemizedPrices;
    
    if (isItemized) {
        const table = document.createElement('table');
        table.className = 'pdf-table';
        table.innerHTML = `
            <thead>
                <tr>
                    <th style="width: 8%; text-align: center;">׳¡׳¢׳™׳£</th>
                    <th style="width: 72%;">׳×׳™׳׳•׳¨ ׳•׳×׳›׳•׳׳× ׳”׳¢׳‘׳•׳“׳”</th>
                    <th style="width: 20%; text-align: left;">׳׳—׳™׳¨ (ג‚×)</th>
                </tr>
            </thead>
            <tbody>
            </tbody>
        `;
        const tbody = table.querySelector('tbody');
        
        itemsList.forEach((item, idx) => {
            const tr = document.createElement('tr');
            tr.innerHTML = `
                <td style="font-family: 'Outfit', sans-serif; font-weight: 700; text-align: center;">${idx + 1}</td>
                <td>
                    <div style="font-weight: 700; color: var(--pdf-primary); text-decoration: underline; margin-bottom: 4px;">${item.title || '׳¡׳¢׳™׳£ ׳׳׳ ׳›׳•׳×׳¨׳×'}</div>
                    <div style="white-space: pre-line; line-height: 1.5; color: var(--pdf-text-main); font-size: 0.9rem;">${item.description || '׳׳™׳ ׳₪׳™׳¨׳•׳˜ ׳׳¡׳¢׳™׳£ ׳–׳”'}</div>
                </td>
                <td style="font-family: 'Outfit', 'Rubik', sans-serif; font-weight: 700; text-align: left; color: var(--pdf-primary);">${formatPriceString(item.price || 0)} ג‚×</td>
            `;
            tbody.appendChild(tr);
        });
        pdfItemsContainer.appendChild(table);
    } else {
        itemsList.forEach((item, idx) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'pdf-work-item';
            itemEl.innerHTML = `
                <div class="pdf-item-title">${idx + 1}. ${item.title || '׳¡׳¢׳™׳£ ׳׳׳ ׳›׳•׳×׳¨׳×'}</div>
                <div class="pdf-item-desc">${item.description || '׳׳™׳ ׳₪׳™׳¨׳•׳˜ ׳׳¡׳¢׳™׳£ ׳–׳”'}</div>
            `;
            pdfItemsContainer.appendChild(itemEl);
        });
    }
    
    syncCurrentQuoteToProject();
}

function toggleItemizedPrices(checked, syncProject = true) {
    appState.currentQuote.showItemizedPrices = checked;
    
    // Sync checkmarks
    const editToggle = document.getElementById('form-itemized-prices-toggle');
    if (editToggle) editToggle.checked = checked;
    
    const settingsToggle = document.getElementById('set-show-itemized-prices');
    if (settingsToggle) settingsToggle.checked = checked;
    
    const items = getWorkItemsFromForm();
    
    const container = document.getElementById('work-items-container');
    container.innerHTML = '';
    items.forEach(item => {
        addWorkItemRow(item.title, item.description, item.price || 0);
    });
    
    const basePriceInput = document.getElementById('form-base-price');
    if (checked) {
        basePriceInput.readOnly = true;
        basePriceInput.classList.add('readonly-highlight');
        calculateItemizedTotal();
    } else {
        basePriceInput.readOnly = false;
        basePriceInput.classList.remove('readonly-highlight');
        calculateTotal();
    }
    
    if (syncProject) {
        syncCurrentQuoteToProject();
    }
    updatePreviewFromForm();
}

function updatePriceDisplayMode() {
    const showItemized = document.getElementById('set-show-itemized-prices').checked;
    toggleItemizedPrices(showItemized);
}

// ==========================================================================
// Gemini Pricing Chat (׳¡׳•׳›׳ ׳×׳׳—׳•׳¨ ׳׳•׳׳—׳”)
// ==========================================================================
async function sendChatMessage() {
    if (!activeProjectId) {
        showToast('׳׳ ׳ ׳‘׳—׳¨ ׳׳• ׳¦׳•׳¨ ׳₪׳¨׳•׳™׳§׳˜ ׳×׳—׳™׳׳” ׳‘׳׳©׳•׳ ׳™׳× ׳ ׳™׳”׳•׳ ׳₪׳¨׳•׳™׳§׳˜׳™׳', 'error');
        switchTab('projects');
        return;
    }
    
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
        showToast('׳׳ ׳ ׳”׳’׳“׳¨ ׳׳₪׳×׳— Gemini API ׳‘׳׳¡׳ ׳”׳”׳’׳“׳¨׳•׳× ׳×׳—׳™׳׳”', 'error');
        switchTab('settings');
        return;
    }

    const effectiveModel = getEffectiveModel();
    if (!effectiveModel) {
        showToast('׳”׳׳›׳¡׳” ׳”׳™׳•׳׳™׳× ׳ ׳•׳¦׳׳” ׳¢׳‘׳•׳¨ ׳©׳ ׳™ ׳”׳׳•׳“׳׳™׳. ׳ ׳¡׳” ׳©׳•׳‘ ׳׳—׳¨.', 'error');
        return;
    }
    if (effectiveModel !== selectedGeminiModel) {
        showToast(`׳׳›׳¡׳× Flash 2.0 ׳ ׳•׳¦׳׳” ג€” ׳¢׳•׳‘׳¨ ׳׳•׳˜׳•׳׳˜׳™׳× ׳-Flash 1.5`, 'error');
        document.getElementById('gemini-model-select').value = effectiveModel;
        changeGeminiModel(effectiveModel);
    }

    const inputArea = document.getElementById('chat-user-input');
    const userText = inputArea.value.trim();
    if (!userText) return;

    const activeProject = projectsList.find(p => p.id === activeProjectId);
    if (!activeProject) return;

    // Add user message to state
    activeProject.chatHistory.push({
        role: 'user',
        parts: [{ text: userText }]
    });
    saveProjects();

    // Render and scroll to bottom
    renderChatHistory(activeProject.chatHistory);
    inputArea.value = '';
    
    // Show typing
    showTypingIndicator(true);
    
    const systemInstructionText = getProfessionSystemInstruction();

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                systemInstruction: { parts: [{ text: systemInstructionText }] },
                contents: activeProject.chatHistory
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || '׳©׳’׳™׳׳” ׳‘׳×׳§׳©׳•׳¨׳× ׳¢׳ ׳©׳¨׳× Gemini');
        }

        incrementDailyUsage(effectiveModel);

        const data = await response.json();
        const responseText = data.candidates[0].content.parts[0].text;

        // Save reply to history
        activeProject.chatHistory.push({
            role: 'model',
            parts: [{ text: responseText }]
        });
        saveProjects();
        
        showTypingIndicator(false);
        renderChatHistory(activeProject.chatHistory);
        
        // Parse and sync materials JSON
        const jsonMatch = responseText.match(/```json\s*([\s\S]*?)\s*```/) || responseText.match(/({[\s\S]*?})/);
        if (jsonMatch) {
            try {
                const parsed = JSON.parse(jsonMatch[1] || jsonMatch[0]);
                if (parsed) {
                    activeProject.laborPrice = parsed.laborPriceEstimate || 0;
                    document.getElementById('wizard-labor-price').value = activeProject.laborPrice;
                    
                    const existingMaterials = activeProject.materials || [];
                    const newMaterials = (parsed.materials || []).map(newMat => {
                        const matched = existingMaterials.find(m => m.name === newMat.name);
                        return {
                            name: newMat.name,
                            price: newMat.price || 0,
                            details: newMat.details || '',
                            checked: matched ? matched.checked : true
                        };
                    });
                    activeProject.materials = newMaterials;
                    
                    renderMaterialsChecklist(newMaterials);
                    
                    const tipsBox = document.getElementById('wizard-tips-box');
                    if (tipsBox && parsed.blindSpots && parsed.blindSpots.length > 0) {
                        tipsBox.style.display = 'block';
                        tipsBox.innerHTML = `<strong>׳ ׳§׳•׳“׳•׳× ׳¢׳™׳•׳•׳¨׳•׳ ׳©׳›׳“׳׳™ ׳׳‘׳“׳•׳§:</strong><ul>` + parsed.blindSpots.map(s => `<li>${s}</li>`).join('') + `</ul>`;
                    }
                    
                    saveProjects();
                }
            } catch (e) {
                console.error("Failed to parse JSON blocks from Gemini response", e);
            }
        }
    } catch (err) {
        console.error(err);
        showTypingIndicator(false);
        showToast('׳׳™׳¨׳¢׳” ׳©׳’׳™׳׳” ׳‘׳¦\'׳׳˜: ' + err.message, 'error');
    }
}

function sendSuggestedChatPrompt(text) {
    const input = document.getElementById('chat-user-input');
    if (input) {
        input.value = text;
        sendChatMessage();
    }
}

function handleChatKeyDown(event) {
    if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        sendChatMessage();
    }
}

function renderChatHistory(chatHistory) {
    const log = document.getElementById('chat-messages-log');
    if (!log) return;
    
    log.innerHTML = '';
    
    chatHistory.forEach(msg => {
        const bubble = document.createElement('div');
        const role = msg.role === 'user' ? 'user' : 'model';
        bubble.className = `chat-bubble ${role}`;
        
        let text = msg.parts[0].text;
        text = text.replace(/```json\s*[\s\S]*?\s*```/, '').trim();
        text = text.replace(/({[\s\S]*?})/, '').trim();
        
        bubble.textContent = text;
        log.appendChild(bubble);
    });
    
    log.scrollTop = log.scrollHeight;
}

function showTypingIndicator(show) {
    const log = document.getElementById('chat-messages-log');
    if (!log) return;
    
    const existing = document.getElementById('chat-typing-bubble');
    if (existing) existing.remove();
    
    if (show) {
        const bubble = document.createElement('div');
        bubble.id = 'chat-typing-bubble';
        bubble.className = 'chat-bubble model';
        bubble.innerHTML = `
            <div class="typing-indicator">
                <span></span>
                <span></span>
                <span></span>
            </div>
        `;
        log.appendChild(bubble);
        log.scrollTop = log.scrollHeight;
    }
}

function renderMaterialsChecklist(materials) {
    const container = document.getElementById('wizard-materials-list');
    if (!container) return;
    
    container.innerHTML = '';
    
    if (!materials || materials.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem; text-align:center; padding:20px;">׳׳™׳ ׳—׳•׳׳¨׳™׳ ׳‘׳׳•׳׳“׳. ׳”׳×׳—׳ ׳©׳™׳—׳” ׳¢׳ ׳”-AI ׳›׳“׳™ ׳׳₪׳¨׳§ ׳¢׳‘׳•׳“׳” ׳׳—׳•׳׳¨׳™׳.</div>`;
        return;
    }
    
    materials.forEach((mat, idx) => {
        const row = document.createElement('div');
        row.className = 'material-check-row';
        row.innerHTML = `
            <input type="checkbox" id="mat-chk-${idx}" ${mat.checked ? 'checked' : ''} onchange="toggleMaterialChecked(${idx}, this.checked)">
            <div class="material-check-text">
                <span class="material-item-name">${mat.name}</span>
                <span class="material-item-details">(${mat.details}) - <b style="color:var(--color-success)">${mat.price} ג‚×</b></span>
            </div>
        `;
        container.appendChild(row);
    });
}

function toggleMaterialChecked(idx, checked) {
    if (!activeProjectId) return;
    const proj = projectsList.find(p => p.id === activeProjectId);
    if (proj && proj.materials && proj.materials[idx]) {
        proj.materials[idx].checked = checked;
        saveProjects();
    }
}

function calculateWizardTotal() {
    if (!activeProjectId) return;
    const proj = projectsList.find(p => p.id === activeProjectId);
    if (proj) {
        proj.laborPrice = parseFloat(document.getElementById('wizard-labor-price').value) || 0;
        saveProjects();
    }
}

// ==========================================================================
// Gemini Phrasing Agent (׳¡׳•׳›׳ ׳ ׳™׳¡׳•׳— ׳”׳¦׳¢׳× ׳׳—׳™׳¨)
// ==========================================================================
async function exportChatToQuote() {
    if (!activeProjectId) {
        showToast('׳׳™׳ ׳₪׳¨׳•׳™׳§׳˜ ׳₪׳¢׳™׳ ׳׳™׳™׳¦׳•׳', 'error');
        return;
    }
    
    const proj = projectsList.find(p => p.id === activeProjectId);
    if (!proj) return;
    
    const apiKey = getGeminiApiKey();
    if (!apiKey) {
        showToast('׳׳ ׳ ׳”׳’׳“׳¨ ׳׳₪׳×׳— Gemini API ׳‘׳׳¡׳ ׳”׳”׳’׳“׳¨׳•׳× ׳×׳—׳™׳׳”', 'error');
        switchTab('settings');
        return;
    }

    const effectiveModel = getEffectiveModel();
    if (!effectiveModel) {
        showToast('׳”׳׳›׳¡׳” ׳”׳™׳•׳׳™׳× ׳ ׳•׳¦׳׳” ׳¢׳‘׳•׳¨ ׳©׳ ׳™ ׳”׳׳•׳“׳׳™׳. ׳ ׳¡׳” ׳©׳•׳‘ ׳׳—׳¨.', 'error');
        return;
    }

    const btn = document.getElementById('btn-export-to-quote');
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ׳׳ ׳¡׳— ׳”׳¦׳¢׳× ׳׳—׳™׳¨...`;
    
    // Format conversation history
    const conversationText = proj.chatHistory.map(msg => {
        const senderName = msg.role === 'user' ? '׳¡׳×׳™׳•' : '׳׳•׳׳—׳” ׳×׳׳—׳•׳¨';
        let text = msg.parts[0].text.replace(/```json\s*[\s\S]*?\s*```/, '').trim();
        text = text.replace(/({[\s\S]*?})/, '').trim();
        return `${senderName}: ${text}`;
    }).join('\n\n');
    
    // Checked materials list
    const checkedMats = (proj.materials || []).filter(m => m.checked);
    const checkedMatsText = checkedMats.map(m => `ג€¢ ${m.name} (${m.details}) - ${m.price} ג‚×`).join('\n');
    const materialsCost = checkedMats.reduce((sum, m) => sum + m.price, 0);
    const estimatedCost = (proj.laborPrice || 0) + materialsCost;
    
    const phrasingDb = appState.settings.phrasingDb || '';
    
    const prompt = `
׳׳×׳” ׳¡׳•׳›׳ ׳”׳ ׳™׳¡׳•׳— (Quote Writer) ׳”׳׳•׳׳—׳” ׳©׳ ׳¡׳×׳™׳• ׳’'׳׳ - SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳.
׳×׳₪׳§׳™׳“׳ ׳׳×׳¨׳’׳ ׳׳× ׳©׳™׳—׳× ׳”׳×׳׳—׳•׳¨ ׳•׳׳•׳׳“׳ ׳”׳—׳•׳׳¨׳™׳ ׳׳”׳¦׳¢׳× ׳׳—׳™׳¨ ׳¨׳©׳׳™׳×, ׳׳ ׳•׳¡׳—׳× ׳”׳™׳˜׳‘ ׳‘׳¢׳‘׳¨׳™׳× ׳׳§׳¦׳•׳¢׳™׳× ׳•׳׳©׳₪׳˜׳™׳×.

׳¢׳׳™׳ ׳׳”׳©׳×׳׳© ׳‘"׳׳׳’׳¨ ׳”׳ ׳™׳¡׳•׳—׳™׳" ׳©׳ ׳¡׳×׳™׳• ׳›׳׳•׳“׳ ׳•׳“׳•׳’׳׳” ׳׳¡׳’׳ ׳•׳ ׳”׳›׳×׳™׳‘׳” ׳•׳”׳׳‘׳ ׳” ׳©׳ ׳”׳¦׳¢׳× ׳”׳׳—׳™׳¨.
׳”׳ ׳” ׳׳׳’׳¨ ׳”׳ ׳™׳¡׳•׳—׳™׳ ׳©׳ ׳¡׳×׳™׳• ׳׳׳׳™׳“׳× ׳¡׳’׳ ׳•׳ ׳”׳›׳×׳™׳‘׳”:
"""
${phrasingDb}
"""

׳”׳ ׳” ׳¡׳™׳›׳•׳ ׳©׳™׳—׳× ׳”׳×׳׳—׳•׳¨ ׳©׳ ׳¢׳¨׳›׳” ׳–׳” ׳¢׳×׳”:
"""
${conversationText}
"""

׳•׳”׳ ׳” ׳¨׳©׳™׳׳× ׳”׳—׳•׳׳¨׳™׳ ׳•׳”׳׳—׳™׳¨׳™׳ ׳©׳ ׳‘׳—׳¨׳•:
"""
׳׳—׳™׳¨ ׳¢׳‘׳•׳“׳” ׳׳•׳¢׳¨׳: ${proj.laborPrice || 0} ׳©"׳—
׳—׳•׳׳¨׳™׳ ׳©׳ ׳‘׳—׳¨׳•:
${checkedMatsText}
"""

׳׳©׳™׳׳×׳ ׳”׳™׳ ׳׳”׳₪׳™׳§ ׳§׳•׳‘׳¥ JSON ׳׳•׳‘׳ ׳” ׳”׳׳₪׳¨׳˜ ׳׳× ׳¡׳¢׳™׳₪׳™ ׳”׳¦׳¢׳× ׳”׳׳—׳™׳¨ ׳”׳¡׳•׳₪׳™׳™׳. 
׳›׳ ׳¡׳¢׳™׳£ ׳¦׳¨׳™׳ ׳׳›׳׳•׳ ׳›׳•׳×׳¨׳× ׳•׳×׳™׳׳•׳¨ ׳׳•׳¨׳—׳‘ ׳•׳׳§׳¦׳•׳¢׳™ (׳‘׳¢׳‘׳¨׳™׳× ׳¨׳©׳׳™׳× ׳•׳×׳§׳ ׳™׳×, ׳”׳׳–׳›׳™׳¨׳” ׳׳× ׳¡׳’׳ ׳•׳ ׳”׳ ׳™׳¡׳•׳—׳™׳ ׳‘׳׳׳’׳¨).
׳׳ ׳™׳© ׳׳¡׳₪׳¨ ׳¢׳‘׳•׳“׳•׳× ׳׳• ׳©׳׳‘׳™׳ ׳©׳•׳ ׳™׳, ׳₪׳¦׳ ׳׳•׳×׳ ׳-2-4 ׳¡׳¢׳™׳₪׳™׳ ׳ ׳₪׳¨׳“׳™׳ (׳׳׳©׳: ׳¡׳¢׳™׳£ ׳”׳›׳ ׳•׳× ׳•׳›׳‘׳™׳׳”, ׳¡׳¢׳™׳£ ׳׳‘׳™׳–׳¨׳™׳ ׳•׳”׳×׳§׳ ׳•׳×).
׳׳›׳ ׳¡׳¢׳™׳£ ׳§׳‘׳¢ ׳׳—׳™׳¨ ׳׳©׳•׳¢׳¨ ׳”׳’׳™׳•׳ ׳™ ׳©׳¡׳›׳•׳׳• ׳”׳›׳׳׳™ (׳׳• ׳׳—׳™׳¨ ׳”׳‘׳¡׳™׳¡) ׳™׳©׳§׳£ ׳׳× ׳¢׳׳•׳× ׳”׳¢׳‘׳•׳“׳” ׳•׳”׳—׳•׳׳¨׳™׳ ׳”׳׳¦׳˜׳‘׳¨׳™׳ (׳©׳¡׳›׳•׳׳ ׳›׳¨׳’׳¢ ׳”׳•׳ ${estimatedCost} ׳©"׳—).

׳”׳₪׳׳˜ ׳©׳׳ ׳—׳™׳™׳‘ ׳׳”׳™׳•׳× ׳׳ ׳•׳¨׳§ JSON ׳‘׳׳‘׳ ׳” ׳”׳‘׳, ׳׳׳ ׳©׳•׳ ׳˜׳§׳¡׳˜ ׳ ׳•׳¡׳£ ׳׳₪׳ ׳™׳• ׳׳• ׳׳—׳¨׳™׳•:
{
  "subject": "׳ ׳•׳©׳ ׳”׳¦׳¢׳× ׳”׳׳—׳™׳¨ (׳׳׳©׳: ׳”׳×׳§׳ ׳× ׳¢׳׳“׳× ׳˜׳¢׳™׳ ׳” ׳׳¨׳›׳‘ ׳—׳©׳׳׳™)",
  "items": [
    {
      "title": "׳›׳•׳×׳¨׳× ׳”׳¡׳¢׳™׳£ (׳׳׳©׳: ׳₪׳¨׳§ ׳': ׳¢׳‘׳•׳“׳•׳× ׳”׳›׳ ׳” ׳•׳”׳ ׳—׳× ׳›׳‘׳׳™׳)",
      "description": "׳₪׳™׳¨׳•׳˜ ׳©׳ ׳”׳¢׳‘׳•׳“׳” ׳•׳×׳›׳•׳׳×׳” ׳‘׳¨׳׳” ׳׳§׳¦׳•׳¢׳™׳× ׳’׳‘׳•׳”׳”...",
      "price": 1200
    }
  ],
  "basePrice": 3500, // ׳׳—׳™׳¨ ׳›׳•׳׳ ׳׳•׳׳׳¥ (׳©׳•׳•׳” ׳׳¡׳›׳•׳ ׳׳—׳™׳¨׳™ ׳”׳¡׳¢׳™׳₪׳™׳)
  "summary": "׳”׳¢׳¨׳•׳× ׳¡׳₪׳¦׳™׳₪׳™׳•׳× ׳׳¢׳‘׳•׳“׳” ׳–׳• ׳©׳™׳© ׳׳›׳׳•׳ ׳‘׳ ׳•׳¡׳£ ׳׳×׳ ׳׳™׳ ׳”׳›׳׳׳™׳™׳ (׳×׳ ׳׳™ ׳×׳©׳׳•׳ ׳•׳›׳•')."
}
`;

    try {
        const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${effectiveModel}:generateContent?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { responseMimeType: "application/json" }
            })
        });

        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error?.message || '׳©׳’׳™׳׳” ׳‘׳ ׳™׳¡׳•׳— ׳׳•׳ Gemini API');
        }
        
        incrementDailyUsage(effectiveModel);

        const data = await response.json();
        const resultText = data.candidates[0].content.parts[0].text;
        const result = JSON.parse(resultText);

        // Sync quote editor
        proj.quoteData.subject = result.subject || proj.quoteData.subject;
        proj.quoteData.items = result.items || [];
        proj.quoteData.basePrice = result.basePrice || (result.items || []).reduce((sum, i) => sum + (i.price || 0), 0);
        proj.quoteData.summary = (result.summary ? result.summary + '\n\n' : '') + appState.settings.businessDetails.terms;
        
        saveProjects();
        
        // Load into app state
        appState.currentQuote = {
            id: proj.id,
            ...proj.quoteData
        };
        
        fillFormFromState();
        updatePreviewFromForm();
        
        switchTab('create');
        showToast('׳¡׳•׳›׳ ׳”׳ ׳™׳¡׳•׳— ׳”׳₪׳™׳§ ׳׳× ׳”׳¦׳¢׳× ׳”׳׳—׳™׳¨ ׳”׳׳׳׳” ׳‘׳”׳¦׳׳—׳”!');
    } catch (err) {
        console.error(err);
        showToast('׳©׳’׳™׳׳” ׳‘׳ ׳™׳¡׳•׳— ׳¢׳ ׳™׳“׳™ AI: ' + err.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = origText;
    }
}

// ==========================================================================
// Logo Styling settings
// ==========================================================================
function updateLogoStyles() {
    const align = document.getElementById('set-logo-align').value;
    const width = document.getElementById('set-logo-width').value;
    const marginTop = document.getElementById('set-logo-margin-top').value;
    const marginBottom = document.getElementById('set-logo-margin-bottom').value;
    
    document.getElementById('val-logo-width').textContent = width + 'px';
    document.getElementById('val-logo-margin-top').textContent = marginTop + 'px';
    document.getElementById('val-logo-margin-bottom').textContent = marginBottom + 'px';
    
    const sheet = document.getElementById('quote-pdf-sheet');
    if (sheet) {
        sheet.style.setProperty('--logo-align', align === 'left' ? 'flex-end' : (align === 'right' ? 'flex-start' : 'center'));
        sheet.style.setProperty('--logo-text-align', align);
        sheet.style.setProperty('--logo-width', width + 'px');
        sheet.style.setProperty('--logo-margin-top', marginTop + 'px');
        sheet.style.setProperty('--logo-margin-bottom', marginBottom + 'px');
    }
    
    appState.settings.logoStyle = { align, width, marginTop, marginBottom };
    localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
}

// ==========================================================================
// Watermark & Logo Upload
// ==========================================================================
function handleImageUpload(event, type) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        const base64Data = e.target.result;
        
        if (type === 'logo') {
            localStorage.setItem(getStorageKey('sj_uploaded_logo'), base64Data);
            appState.settings.uploadedLogo = base64Data;
            localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
            localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
            renderLogo(base64Data);
            syncDatabaseToDrive(true);
            showToast('׳׳•׳’׳• ׳”׳¢׳¡׳§ ׳¢׳•׳“׳›׳ ׳‘׳”׳¦׳׳—׳”');
        } else if (type === 'bg') {
            localStorage.setItem(getStorageKey('sj_uploaded_bg'), base64Data);
            appState.settings.uploadedBg = base64Data;
            localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
            localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
            renderWatermark(base64Data);
            syncDatabaseToDrive(true);
            showToast('׳×׳׳•׳ ׳× ׳¨׳§׳¢ ׳¢׳•׳“׳›׳ ׳” ׳‘׳”׳¦׳׳—׳”');
        }
    };
    reader.readAsDataURL(file);
}

function clearUploadedImage(type) {
    if (type === 'logo') {
        localStorage.removeItem(getStorageKey('sj_uploaded_logo'));
        appState.settings.uploadedLogo = null;
        localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
        localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
        renderLogo(null);
        syncDatabaseToDrive(true);
        showToast('׳׳•׳’׳• ׳”׳—׳‘׳¨׳” ׳”׳•׳—׳–׳¨ ׳׳‘׳¨׳™׳¨׳× ׳”׳׳—׳“׳');
    } else if (type === 'bg') {
        localStorage.removeItem(getStorageKey('sj_uploaded_bg'));
        appState.settings.uploadedBg = null;
        localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
        localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
        renderWatermark(null);
        syncDatabaseToDrive(true);
        showToast('׳×׳׳•׳ ׳× ׳”׳¨׳§׳¢ ׳”׳•׳¡׳¨׳”');
    }
}

function loadUploadedImages() {
    const savedLogo = appState.settings.uploadedLogo || localStorage.getItem(getStorageKey('sj_uploaded_logo'));
    if (savedLogo) {
        if (!appState.settings.uploadedLogo) {
            appState.settings.uploadedLogo = savedLogo;
            localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
        }
        renderLogo(savedLogo);
    }
    
    const savedBg = appState.settings.uploadedBg || localStorage.getItem(getStorageKey( 'sj_uploaded_bg'));
    if (savedBg) {
        if (!appState.settings.uploadedBg) {
            appState.settings.uploadedBg = savedBg;
            localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
        }
        renderWatermark(savedBg);
    }
}

function renderLogo(base64Data) {
    const container = document.getElementById('pdf-logo-container');
    const settingsPreview = document.getElementById('logo-settings-preview');
    
    if (base64Data) {
        container.innerHTML = `<img src="${base64Data}" alt="׳׳•׳’׳• ׳¢׳¡׳§">`;
        settingsPreview.innerHTML = `<img src="${base64Data}" style="max-height:100%; max-width:100%;">`;
    } else {
        container.innerHTML = `
            <svg viewBox="0 0 100 100" class="pdf-logo-svg" id="fallback-logo">
                <circle cx="50" cy="50" r="46" fill="#0f172a" stroke="#3b82f6" stroke-width="3" />
                <path d="M 32 40 C 32 28, 68 28, 68 40 C 68 52, 32 48, 32 60 C 32 72, 68 72, 68 60" fill="none" stroke="#60a5fa" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M 58 46 L 58 70 C 58 80, 32 80, 32 70" fill="none" stroke="#3b82f6" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        settingsPreview.innerHTML = '<span style="color:var(--text-muted); font-size:0.8rem;">׳‘׳¨׳™׳¨׳× ׳׳—׳“׳</span>';
    }
}

function renderWatermark(base64Data) {
    const watermarkBg = document.getElementById('pdf-watermark-bg');
    const settingsPreview = document.getElementById('bg-settings-preview');
    
    if (base64Data) {
        watermarkBg.style.backgroundImage = `url('${base64Data}')`;
        settingsPreview.innerHTML = `<img src="${base64Data}" style="max-height:100%; max-width:100%;">`;
    } else {
        watermarkBg.style.backgroundImage = 'none';
        settingsPreview.innerHTML = '<span style="color:var(--text-muted); font-size:0.8rem;">׳׳™׳ ׳×׳׳•׳ ׳× ׳¨׳§׳¢</span>';
    }
}

// ==========================================================================
// Collapsible Stern Pricing Sidebar Drawer
// ==========================================================================
function openSternDrawer() {
    const drawer = document.getElementById('stern-pricing-drawer');
    if (drawer) {
        drawer.classList.add('open');
        renderSternList(sternPricingDatabase);
    }
}

function closeSternDrawer() {
    const drawer = document.getElementById('stern-pricing-drawer');
    if (drawer) {
        drawer.classList.remove('open');
    }
}

// ==========================================================================
// Stern Pricing database
// ==========================================================================
async function loadSternPricing() {
    try {
        const response = await fetch('stern-pricing.json');
        if (response.ok) {
            sternPricingDatabase = await response.json();
            renderSternList(sternPricingDatabase);
        } else {
            console.warn('Could not load stern-pricing.json');
        }
    } catch (err) {
        console.error('Error fetching Stern Price list:', err);
    }
}

function renderSternList(items) {
    const list = document.getElementById('stern-results-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (items.length === 0) {
        list.innerHTML = '<div style="color:var(--text-muted); padding:20px; text-align:center;">׳׳ ׳ ׳׳¦׳׳• ׳×׳•׳¦׳׳•׳× ׳”׳×׳•׳׳׳•׳× ׳׳—׳™׳₪׳•׳©.</div>';
        return;
    }
    
    items.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'stern-result-card';
        card.innerHTML = `
            <div class="stern-card-info">
                <div class="stern-card-desc">${item.description}</div>
                <div class="stern-card-unit">${item.unit ? '׳₪׳™׳¨׳•׳˜/׳™׳—׳™׳“׳”: ' + item.unit : ''}</div>
            </div>
            <div class="stern-card-action">
                <div class="stern-card-price">${formatPriceString(item.price)} ג‚×</div>
                <button class="btn btn-accent btn-small" onclick="addSternItemToQuote(${index})">
                    <i class="fa-solid fa-plus"></i> ׳”׳•׳¡׳£
                </button>
            </div>
        `;
        list.appendChild(card);
    });
}

function filterSternPricing() {
    const query = document.getElementById('stern-search-input').value.toLowerCase().trim();
    if (!query) {
        renderSternList(sternPricingDatabase);
        return;
    }
    
    const filtered = sternPricingDatabase.filter(item => 
        item.description.toLowerCase().includes(query) || 
        (item.unit && item.unit.toLowerCase().includes(query))
    );
    renderSternList(filtered);
}

function addSternItemToQuote(dbIndex) {
    const item = sternPricingDatabase[dbIndex];
    if (!item) return;
    
    const container = document.getElementById('work-items-container');
    if (container.children.length === 1) {
        const firstRow = container.children[0];
        const titleVal = firstRow.querySelector('.item-title-input').value.trim();
        const descVal = firstRow.querySelector('.item-desc-input').value.trim();
        if (!titleVal && !descVal) {
            firstRow.remove();
        }
    }
    
    addWorkItemRow(item.description, item.unit || '', item.price);
    
    if (!appState.currentQuote.showItemizedPrices) {
        const basePriceInput = document.getElementById('form-base-price');
        const currentBasePrice = parseFloat(basePriceInput.value) || 0;
        basePriceInput.value = (currentBasePrice + item.price).toFixed(2);
        calculateTotal();
    } else {
        calculateItemizedTotal();
    }
    
    updatePreviewFromForm();
    showToast(`׳ ׳•׳¡׳£ ׳¡׳¢׳™׳£: "${item.description.substring(0, 30)}..." ׳‘׳׳—׳™׳¨ ${item.price} ׳©"׳—`);
}

// ==========================================================================
// PDF Generation & Download
// ==========================================================================
function downloadPDF() {
    const clientName = document.getElementById('form-client-name').value.trim() || '׳׳§׳•׳—';
    const subject = document.getElementById('form-quote-subject').value.trim() || '׳”׳¦׳¢׳× ׳׳—׳™׳¨';
    const quoteNumber = document.getElementById('form-quote-number').value.trim() || '000';
    
    appState.currentQuote.clientName = clientName;
    appState.currentQuote.clientSub = document.getElementById('form-client-sub').value.trim();
    appState.currentQuote.quoteNumber = quoteNumber;
    appState.currentQuote.date = document.getElementById('form-quote-date').value;
    appState.currentQuote.subject = subject;
    appState.currentQuote.items = getWorkItemsFromForm();
    appState.currentQuote.summary = document.getElementById('form-summary').value;
    
    updatePreviewFromForm();
    
    const element = document.getElementById('quote-pdf-sheet');
    const filename = `׳”׳¦׳¢׳× ׳׳—׳™׳¨_${quoteNumber}_${clientName.replace(/\s+/g, '_')}.pdf`;
    
    const options = {
        margin: 10,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
            scale: 2, 
            useCORS: true,
            logging: false,
            letterRendering: true
        },
        jsPDF: { 
            unit: 'mm', 
            format: 'a4', 
            orientation: 'portrait' 
        }
    };
    
    showToast('׳׳›׳™׳ ׳§׳•׳‘׳¥ PDF ׳׳”׳•׳¨׳“׳”...');
    
    return html2pdf().set(options).from(element).save()
        .then(() => {
            showToast('׳§׳•׳‘׳¥ PDF ׳”׳•׳¨׳“ ׳‘׳”׳¦׳׳—׳”');
            saveToHistory(false);
        })
        .catch(err => {
            console.error('PDF error:', err);
            showToast('׳©׳’׳™׳׳” ׳‘׳™׳¦׳™׳¨׳× ׳§׳•׳‘׳¥ ׳”-PDF', 'error');
        });
}

function shareWhatsApp() {
    const clientName = document.getElementById('form-client-name').value.trim();
    const subject = document.getElementById('form-quote-subject').value.trim();
    const finalPrice = document.getElementById('form-final-price').value;
    const vatType = document.getElementById('form-vat-type').value;
    
    let vatLabel = '׳₪׳˜׳•׳¨ ׳׳׳¢"׳';
    if (vatType === 'exclude') vatLabel = '׳׳ ׳›׳•׳׳ ׳׳¢"׳';
    if (vatType === 'include') vatLabel = '׳›׳•׳׳ ׳׳¢"׳';
    
    if (!clientName || !subject) {
        showToast('׳׳ ׳ ׳׳׳ ׳©׳ ׳׳§׳•׳— ׳•׳ ׳•׳©׳ ׳›׳“׳™ ׳׳”׳₪׳™׳§ ׳”׳•׳“׳¢׳”', 'error');
        return;
    }
    
    const msg = `׳©׳׳•׳ ${clientName},\n\n׳”׳₪׳§׳×׳™ ׳¢׳‘׳•׳¨׳ ׳”׳¦׳¢׳× ׳׳—׳™׳¨ ׳׳₪׳•׳¨׳˜׳× ׳‘׳ ׳•׳©׳: *${subject}*.\n׳¡׳”"׳› ׳׳×׳©׳׳•׳: *${finalPrice}* (${vatLabel}).\n\n׳©׳׳—׳×׳™ ׳׳ ׳׳× ׳§׳•׳‘׳¥ ׳”-PDF ׳”׳׳₪׳•׳¨׳˜ ׳‘׳׳™׳™׳. ׳׳©׳׳— ׳׳¢׳‘׳•׳¨ ׳¢׳׳™׳• ׳™׳—׳“ ׳׳™׳×׳.\n\n׳‘׳‘׳¨׳›׳”,\n*׳¡׳×׳™׳• ׳’'׳׳ - SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳*`;
    const encodedMsg = encodeURIComponent(msg);
    
    window.open(`https://api.whatsapp.com/send?text=${encodedMsg}`, '_blank');
}

function saveToHistory(showToastFlag = true) {
    const q = appState.currentQuote;
    
    q.clientName = document.getElementById('form-client-name').value.trim();
    q.clientSub = document.getElementById('form-client-sub').value.trim();
    q.quoteNumber = document.getElementById('form-quote-number').value.trim();
    q.date = document.getElementById('form-quote-date').value;
    q.subject = document.getElementById('form-quote-subject').value.trim();
    q.items = getWorkItemsFromForm();
    q.summary = document.getElementById('form-summary').value;
    
    if (!q.clientName || !q.subject) {
        if (showToastFlag) showToast('׳—׳•׳‘׳” ׳׳”׳–׳™׳ ׳©׳ ׳׳§׳•׳— ׳•׳ ׳•׳©׳ ׳׳₪׳ ׳™ ׳”׳©׳׳™׳¨׳”', 'error');
        return;
    }
    
    if (q.id && q.id.startsWith('proj_') === false) { // it is a local history item, not a project ID
        const idx = appState.history.findIndex(item => item.id === q.id);
        if (idx !== -1) {
            appState.history[idx] = JSON.parse(JSON.stringify(q));
            if (showToastFlag) showToast('׳”׳¦׳¢׳× ׳”׳׳—׳™׳¨ ׳¢׳•׳“׳›׳ ׳” ׳‘׳”׳™׳¡׳˜׳•׳¨׳™׳”');
        }
    } else {
        q.id = 'hist_' + Date.now().toString();
        appState.history.unshift(JSON.parse(JSON.stringify(q)));
        if (showToastFlag) showToast('׳”׳¦׳¢׳× ׳”׳׳—׳™׳¨ ׳ ׳©׳׳¨׳” ׳‘׳”׳™׳¡׳˜׳•׳¨׳™׳”');
    }
    
    saveHistory();
    syncCurrentQuoteToProject();
}

function loadQuoteFromHistory(id) {
    const quote = appState.history.find(item => item.id === id);
    if (!quote) return;
    
    appState.currentQuote = JSON.parse(JSON.stringify(quote));
    
    fillFormFromState();
    updatePreviewFromForm();
    
    switchTab('create');
    showToast(`׳”׳¦׳¢׳× ׳׳—׳™׳¨ ׳׳¡' ${quote.quoteNumber} ׳ ׳˜׳¢׳ ׳” ׳׳¢׳¨׳™׳›׳”`);
}

function deleteQuoteFromHistory(id, event) {
    if (event) event.stopPropagation();
    
    if (!confirm('׳”׳׳ ׳׳×׳” ׳‘׳˜׳•׳— ׳©׳‘׳¨׳¦׳•׳ ׳ ׳׳׳—׳•׳§ ׳”׳¦׳¢׳× ׳׳—׳™׳¨ ׳–׳• ׳׳¦׳׳™׳×׳•׳×?')) {
        return;
    }
    
    appState.history = appState.history.filter(item => item.id !== id);
    saveHistory();
    renderHistoryList();
    showToast('׳”׳¦׳¢׳× ׳”׳׳—׳™׳¨ ׳ ׳׳—׳§׳” ׳‘׳”׳¦׳׳—׳”');
}

function renderHistoryList() {
    const listContainer = document.getElementById('history-list');
    const emptyState = document.getElementById('history-empty');
    if (!listContainer) return;
    listContainer.innerHTML = '';
    
    if (appState.history.length === 0) {
        if (emptyState) emptyState.style.display = 'flex';
        return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    
    appState.history.forEach(q => {
        const row = document.createElement('tr');
        row.style.cursor = 'pointer';
        row.onclick = () => loadQuoteFromHistory(q.id);
        
        let vatText = '׳₪׳˜׳•׳¨';
        if (q.vatType === 'exclude') vatText = '+ ׳׳¢"׳';
        if (q.vatType === 'include') vatText = '׳›׳•׳׳ ׳׳¢"׳';
        
        row.innerHTML = `
            <td style="font-family: 'Outfit', sans-serif; font-weight:700;">${q.quoteNumber}</td>
            <td style="font-family: 'Outfit', sans-serif;">${formatHebrewDate(q.date)}</td>
            <td style="font-weight:600; color: var(--color-accent);">${q.clientName}</td>
            <td>${q.subject}</td>
            <td style="font-family: 'Outfit', 'Rubik', sans-serif; font-weight:600;">${formatPriceString(q.finalPrice)} ׳©"׳— <span style="font-size:0.75rem; color:var(--text-muted);">${vatText}</span></td>
            <td><span class="badge active">׳©׳׳•׳¨</span></td>
            <td class="actions-cell">
                <button class="btn btn-secondary btn-small" onclick="loadQuoteFromHistory('${q.id}')">
                    <i class="fa-solid fa-pen"></i> ׳¢׳¨׳•׳
                </button>
                <button class="btn btn-danger btn-small" onclick="deleteQuoteFromHistory('${q.id}', event)">
                    <i class="fa-solid fa-trash-can"></i> ׳׳—׳§
                </button>
            </td>
        `;
        
        listContainer.appendChild(row);
    });
}

function filterHistory() {
    const query = document.getElementById('history-search').value.toLowerCase().trim();
    const rows = document.querySelectorAll('#history-list tr');
    let visibleCount = 0;
    
    rows.forEach(row => {
        const clientName = row.children[2].textContent.toLowerCase();
        const subject = row.children[3].textContent.toLowerCase();
        const quoteNum = row.children[0].textContent.toLowerCase();
        
        if (clientName.includes(query) || subject.includes(query) || quoteNum.includes(query)) {
            row.style.display = '';
            visibleCount++;
        } else {
            row.style.display = 'none';
        }
    });
    
    const emptyState = document.getElementById('history-empty');
    if (visibleCount === 0) {
        if (emptyState) {
            emptyState.style.display = 'flex';
            emptyState.querySelector('p').textContent = '׳׳ ׳ ׳׳¦׳׳• ׳”׳¦׳¢׳•׳× ׳׳—׳™׳¨ ׳”׳×׳•׳׳׳•׳× ׳׳—׳™׳₪׳•׳©.';
        }
    } else {
        if (emptyState) emptyState.style.display = 'none';
    }
}

function exportHistoryData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify({
        settings: appState.settings,
        history: appState.history,
        projects: projectsList
    }, null, 2));
    
    const downloadAnchor = document.createElement('a');
    downloadAnchor.setAttribute("href",     dataStr);
    downloadAnchor.setAttribute("download", `׳’׳™׳‘׳•׳™_׳”׳¦׳¢׳•׳×_׳׳—׳™׳¨_SJ_${getTodayDateString()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    
    showToast('׳ ׳×׳•׳ ׳™ ׳”׳׳¢׳¨׳›׳× ׳™׳•׳¦׳׳• ׳׳§׳•׳‘׳¥ ׳’׳™׳‘׳•׳™ ׳‘׳”׳¦׳׳—׳”');
}

function importHistoryClick() {
    document.getElementById('import-file').click();
}

function importHistoryData(event) {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (imported.history && Array.isArray(imported.history)) {
                if (confirm(`׳ ׳׳¦׳׳• ${imported.history.length} ׳”׳¦׳¢׳•׳× ׳׳—׳™׳¨ ׳‘׳§׳•׳‘׳¥. ׳”׳׳ ׳‘׳¨׳¦׳•׳ ׳ ׳׳™׳™׳‘׳?`)) {
                    appState.history = imported.history;
                    if (imported.settings) {
                        appState.settings = imported.settings;
                        loadSettings();
                    }
                    if (imported.projects) {
                        projectsList = imported.projects;
                        saveProjects();
                        filterProjectsList();
                    }
                    saveHistory();
                    renderHistoryList();
                    showToast('׳”׳ ׳×׳•׳ ׳™׳ ׳™׳•׳‘׳׳• ׳‘׳”׳¦׳׳—׳”');
                }
            } else {
                showToast('׳§׳•׳‘׳¥ ׳’׳™׳‘׳•׳™ ׳׳ ׳×׳§׳™׳', 'error');
            }
        } catch (err) {
            showToast('׳©׳’׳™׳׳” ׳‘׳₪׳¢׳ ׳•׳— ׳§׳•׳‘׳¥ ׳”׳’׳™׳‘׳•׳™', 'error');
        }
    };
    reader.readAsText(file);
}

// ==========================================================================
// Google Drive Integration
// ==========================================================================
function checkGoogleSession() {
    const savedToken = getSessionOrLocalStorageItem(getStorageKey('sj_drive_access_token'));
    if (savedToken) {
        googleAccessToken = savedToken;
        updateDriveStatus(true);
        // Sync on startup (delayed slightly so settings and projects render first)
        setTimeout(async () => {
            try {
                await resolveSjDriveFolders();
                syncDatabaseFromDrive(true);
            } catch (err) {
                console.error('Error resolving folders on startup:', err);
            }
        }, 800);
    }
}

function updateDriveStatus(connected) {
    const statusLabel = document.getElementById('drive-status');
    const btn = document.getElementById('btn-connect-drive');
    const syncSection = document.getElementById('drive-sync-section');
    if (!statusLabel || !btn) return;
    
    if (connected) {
        statusLabel.className = 'status-connected';
        statusLabel.innerHTML = '<i class="fa-solid fa-circle-dot"></i> ׳׳—׳•׳‘׳¨ ׳-Google Drive';
        btn.textContent = '׳”׳—׳׳£ ׳—׳©׳‘׳•׳ / ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳©';
        if (syncSection) syncSection.style.display = 'flex';
        loadDriveFoldersList();
    } else {
        statusLabel.className = 'status-disconnected';
        statusLabel.innerHTML = '<i class="fa-solid fa-circle-dot"></i> ׳׳ ׳•׳×׳§';
        btn.textContent = '׳’׳‘׳” ׳׳× ׳¢׳‘׳•׳“׳×׳ ׳¢"׳™ ׳™׳¦׳™׳¨׳× ׳×׳™׳§׳™׳™׳× ׳”׳¦׳¢׳•׳× ׳׳—׳™׳¨ ׳‘-DRIVE ׳©׳ ׳’׳•׳’׳';
        if (syncSection) syncSection.style.display = 'none';
        const container = document.getElementById('drive-folder-select-container');
        if (container) container.innerHTML = '';
    }
}

function clearDriveSession() {
    localStorage.removeItem(getStorageKey('sj_drive_access_token'));
    sessionStorage.removeItem(getStorageKey('sj_drive_access_token'));
    localStorage.removeItem(getStorageKey('sj_folder_electrical_id'));
    localStorage.removeItem(getStorageKey('sj_folder_quotes_id'));
    localStorage.removeItem(getStorageKey('sj_folder_data_id'));
    localStorage.removeItem(getStorageKey('sj_sync_folder_id'));
    googleAccessToken = null;
    updateDriveStatus(false);
    
    const pathStatus = document.getElementById('drive-folder-path-status');
    if (pathStatus) {
        pathStatus.innerHTML = `
            <i class="fa-solid fa-file-pdf"></i> ׳§׳•׳‘׳¦׳™ PDF ׳™׳™׳©׳׳¨׳• ׳‘׳×׳™׳§׳™׳™׳” ׳”׳ ׳‘׳—׳¨׳×<br>
            <i class="fa-solid fa-database"></i> ׳’׳™׳‘׳•׳™ ׳•׳¡׳ ׳›׳¨׳•׳ ׳ ׳×׳•׳ ׳™׳: <strong>׳×׳™׳§׳™׳™׳× ׳׳¢׳¨׳›׳× ׳׳•׳¡׳×׳¨׳× (.sysdata)</strong>
        `;
        pathStatus.style.color = '';
    }
    const folderInput = document.getElementById('settings-drive-folder-id');
    if (folderInput) {
        folderInput.value = '';
    }
}

function connectGoogleDrive() {
    const clientId = document.getElementById('settings-drive-client-id').value.trim();
    if (!clientId) {
        showToast('׳׳ ׳ ׳”׳–׳ Google Client ID ׳‘׳”׳’׳“׳¨׳•׳× ׳×׳—׳™׳׳”', 'error');
        return;
    }
    
    appState.settings.googleClientId = clientId;
    localStorage.setItem('sj_global_google_client_id', clientId);
    const lockClientId = document.getElementById('lock-google-client-id');
    if (lockClientId) lockClientId.value = clientId;
    localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
    
    try {
        googleTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly',
            callback: async (response) => {
                if (response.error !== undefined) {
                    showToast('׳©׳’׳™׳׳” ׳‘׳—׳™׳‘׳•׳¨ ׳׳’׳•׳’׳ ׳“׳¨׳™׳™׳‘: ' + response.error, 'error');
                    return;
                }
                googleAccessToken = response.access_token;
                localStorage.setItem(getStorageKey('sj_drive_access_token'), googleAccessToken);
                
                // Clear old cache
                localStorage.removeItem(getStorageKey('sj_folder_electrical_id'));
                localStorage.removeItem(getStorageKey('sj_folder_quotes_id'));
                localStorage.removeItem(getStorageKey('sj_folder_data_id'));
                localStorage.removeItem(getStorageKey('sj_sync_folder_id'));
                
                updateDriveStatus(true);
                showToast('׳”׳×׳—׳‘׳¨׳× ׳-Google Drive ׳‘׳”׳¦׳׳—׳”!');
                
                try {
                    showToast('׳׳–׳”׳” ׳•׳׳¡׳ ׳›׳¨׳ ׳׳× ׳×׳™׳§׳™׳™׳× ׳”׳¢׳ ׳ ׳©׳ SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳...');
                    await resolveSjDriveFolders();
                    autoDetectQuoteNumber(false);
                    syncDatabaseFromDrive(false); // Cloud sync
                } catch (folderErr) {
                    showToast('׳©׳’׳™׳׳” ׳‘׳™׳¦׳™׳¨׳× ׳ ׳×׳™׳‘ ׳”׳×׳™׳§׳™׳•׳× ׳‘׳“׳¨׳™׳™׳‘: ' + folderErr.message, 'error');
                }
            },
        });
        
        googleTokenClient.requestAccessToken({ prompt: '' });
    } catch (e) {
        console.error(e);
        showToast('׳©׳’׳™׳׳” ׳‘׳׳×׳—׳•׳ Google OAuth: ׳•׳“׳ ׳©׳”-Client ID ׳×׳§׳™׳', 'error');
    }
}

// ==========================================================================
// Google Drive Cloud Database Synchronization
// ==========================================================================
function setSyncLoading(loading) {
    const spinner = document.getElementById('sync-spinner');
    const bannerSync = document.getElementById('banner-sync-indicator');
    
    if (spinner) {
        spinner.style.display = loading ? 'inline-flex' : 'none';
    }
    if (bannerSync) {
        bannerSync.style.display = loading ? 'inline-flex' : 'none';
    }
}

async function findOrCreateFolder(name, parentId) {
    const escapedName = name.replace(/'/g, "\\'");
    const query = `name = '${escapedName}' and '${parentId}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&access_token=${googleAccessToken}`);
    if (!res.ok) {
        const errText = await res.text();
        throw new Error(`׳—׳™׳₪׳•׳© ׳×׳™׳§׳™׳™׳” '${name}' ׳ ׳›׳©׳: ${errText}`);
    }
    const data = await res.json();
    if (data.files && data.files.length > 0) {
        return data.files[0].id;
    }

    // Create folder only when search succeeded but returned nothing
    const metadata = {
        name: name,
        mimeType: 'application/vnd.google-apps.folder'
    };
    if (parentId !== 'root') {
        metadata.parents = [parentId];
    }
    
    const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${googleAccessToken}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(metadata)
    });
    
    if (createRes.ok) {
        const created = await createRes.json();
        return created.id;
    }
    return null;
}

async function resolveSjDriveFolders() {
    if (!googleAccessToken) return null;
    
    const sjElectricalId = localStorage.getItem(getStorageKey('sj_folder_electrical_id'));
    const quotesId = localStorage.getItem(getStorageKey('sj_folder_quotes_id'));
    const dataId = localStorage.getItem(getStorageKey('sj_folder_data_id'));
    
    if (sjElectricalId && quotesId && dataId) {
        try {
            const checkRes = await fetch(`https://www.googleapis.com/drive/v3/files/${quotesId}?fields=trashed&access_token=${googleAccessToken}`);
            if (checkRes.ok) {
                const checkData = await checkRes.json();
                if (checkData.trashed) {
                    throw new Error('Folder is in trash');
                }
                const folderInput = document.getElementById('settings-drive-folder-id');
                if (folderInput) folderInput.value = quotesId;
                
                const pathStatus = document.getElementById('drive-folder-path-status');
                if (pathStatus) {
                    pathStatus.innerHTML = `
                        <i class="fa-solid fa-circle-check" style="color: var(--color-success)"></i> ׳×׳™׳§׳™׳•׳× ׳₪׳¢׳™׳׳•׳× ׳‘׳“׳¨׳™׳™׳‘:<br>
                        <i class="fa-solid fa-file-pdf" style="margin-right: 15px;"></i> ׳׳–׳”׳” ׳×׳™׳§׳™׳™׳× PDF: <strong>${quotesId}</strong><br>
                        <i class="fa-solid fa-database" style="margin-right: 15px;"></i> ׳׳–׳”׳” ׳×׳™׳§׳™׳™׳× ׳“׳׳˜׳: <strong>${dataId}</strong>
                    `;
                    pathStatus.style.color = 'var(--color-success)';
                }
                return { sjElectrical: sjElectricalId, quotes: quotesId, data: dataId };
            } else {
                throw new Error('Folder not accessible');
            }
        } catch (e) {
            console.warn('Cached folder IDs are no longer valid, clearing cache:', e);
            localStorage.removeItem(getStorageKey('sj_folder_electrical_id'));
            localStorage.removeItem(getStorageKey('sj_folder_quotes_id'));
            localStorage.removeItem(getStorageKey('sj_folder_data_id'));
            localStorage.removeItem(getStorageKey('sj_sync_folder_id'));
        }
    }
    
    try {
        let sjId = 'root';
        let qId = appState.settings.googleFolderId;
        
        if (!qId || qId === 'auto_sj' || qId === '1FHfFPd5S9EtphEcGxKqw9oAZstKyQbjv') {
            sjId = await findOrCreateFolder('SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳', 'root');
            if (!sjId) throw new Error("׳©׳’׳™׳׳” ׳‘׳™׳¦׳™׳¨׳× ׳×׳™׳§׳™׳™׳× 'SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳'");
            qId = await findOrCreateFolder('׳”׳¦׳¢׳•׳× ׳׳—׳™׳¨', sjId);
            if (!qId) throw new Error("׳©׳’׳™׳׳” ׳‘׳™׳¦׳™׳¨׳× ׳×׳™׳§׳™׳™׳× '׳”׳¦׳¢׳•׳× ׳׳—׳™׳¨'");
        } else {
            sjId = 'custom';
        }
        
        const dId = await findOrCreateFolder('.sysdata', qId);
        if (!dId) throw new Error("׳©׳’׳™׳׳” ׳‘׳™׳¦׳™׳¨׳× ׳×׳™׳§׳™׳™׳× '.sysdata'");
        
        localStorage.setItem(getStorageKey('sj_folder_electrical_id'), sjId);
        localStorage.setItem(getStorageKey('sj_folder_quotes_id'), qId);
        localStorage.setItem(getStorageKey('sj_folder_data_id'), dId);
        localStorage.setItem(getStorageKey('sj_sync_folder_id'), dId);
        
        appState.settings.googleFolderId = qId;
        localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
        
        const folderInput = document.getElementById('settings-drive-folder-id');
        if (folderInput) folderInput.value = qId;
        
        const pathStatus = document.getElementById('drive-folder-path-status');
        if (pathStatus) {
            pathStatus.innerHTML = `
                <i class="fa-solid fa-circle-check" style="color: var(--color-success)"></i> ׳×׳™׳§׳™׳•׳× ׳₪׳¢׳™׳׳•׳× ׳‘׳“׳¨׳™׳™׳‘:<br>
                <i class="fa-solid fa-file-pdf" style="margin-right: 15px;"></i> ׳׳–׳”׳” ׳×׳™׳§׳™׳™׳× PDF: <strong>${qId}</strong><br>
                <i class="fa-solid fa-database" style="margin-right: 15px;"></i> ׳׳–׳”׳” ׳×׳™׳§׳™׳™׳× ׳“׳׳˜׳: <strong>${dId}</strong>
            `;
            pathStatus.style.color = 'var(--color-success)';
        }
        
        return { sjElectrical: sjId, quotes: qId, data: dId };
    } catch (e) {
        console.error('Failed to resolve SJ Drive Folders:', e);
        throw e;
    }
}

async function getOrCreateSyncFolder() {
    const folders = await resolveSjDriveFolders();
    return folders ? folders.data : null;
}

// Scan a Drive folder for old-format JSON files and extract recognisable data
async function scanForLegacyData(folderId) {
    if (!googleAccessToken || !folderId) return null;
    try {
        // List all JSON files in the folder AND one level of subfolders
        const q = `'${folderId}' in parents and trashed = false and (mimeType = 'application/json' or name contains '.json' or name contains '.dat')`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime desc&access_token=${googleAccessToken}`);
        if (!res.ok) return null;
        const data = await res.json();
        const files = data.files || [];
        if (files.length === 0) return null;

        let bestSettings = null, bestHistory = [], bestProjects = [];

        for (const file of files.slice(0, 8)) {
            try {
                const dlRes = await fetch(`https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`, {
                    headers: { 'Authorization': `Bearer ${googleAccessToken}` }
                });
                if (!dlRes.ok) continue;
                const parsed = await dlRes.json();

                // Full backup format: { settings, history, projects }
                if (parsed.settings && typeof parsed.settings === 'object') {
                    bestSettings = bestSettings || parsed.settings;
                    if (parsed.history && parsed.history.length > bestHistory.length) bestHistory = parsed.history;
                    if (parsed.projects && parsed.projects.length > bestProjects.length) bestProjects = parsed.projects;
                    continue;
                }
                // Flat settings blob (old format)
                const knownKeys = ['profession','geminiApiKey','businessDetails','googleFolderId','phrasingDb','logoStyle'];
                if (knownKeys.some(k => parsed[k] !== undefined)) {
                    bestSettings = bestSettings ? Object.assign({}, parsed, bestSettings) : parsed;
                }
                // History array
                if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].id) {
                    if (parsed.length > bestHistory.length) bestHistory = parsed;
                }
            } catch (e) { /* skip unparseable file */ }
        }

        if (!bestSettings && bestHistory.length === 0) return null;
        return { settings: bestSettings, history: bestHistory, projects: bestProjects };
    } catch (e) {
        console.warn('Legacy scan failed:', e);
        return null;
    }
}

// Manual trigger: scan current sync folder for old JSON and import
async function manualLegacyScan() {
    if (!googleAccessToken) { showToast('׳™׳© ׳׳”׳×׳—׳‘׳¨ ׳׳’׳•׳’׳ ׳×׳—׳™׳׳”', 'error'); return; }
    showToast('׳¡׳•׳¨׳§ ׳×׳™׳§׳™׳™׳× Drive ׳׳ ׳×׳•׳ ׳™׳ ׳™׳©׳ ׳™׳...');
    try {
        const syncFolderId = await getOrCreateSyncFolder();
        if (!syncFolderId) { showToast('׳׳ ׳ ׳׳¦׳׳” ׳×׳™׳§׳™׳™׳× Drive', 'error'); return; }
        const recovered = await scanForLegacyData(syncFolderId);
        if (!recovered) { showToast('׳׳ ׳ ׳׳¦׳׳• ׳ ׳×׳•׳ ׳™׳ ׳™׳©׳ ׳™׳ ׳‘׳×׳™׳§׳™׳™׳”', 'error'); return; }
        if (recovered.settings) {
            appState.settings = Object.assign({}, appState.settings, recovered.settings);
            localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
        }
        if (recovered.history && recovered.history.length > 0) {
            appState.history = recovered.history;
            localStorage.setItem(getStorageKey('sj_quote_history'), JSON.stringify(appState.history));
        }
        if (recovered.projects && recovered.projects.length > 0) {
            projectsList = recovered.projects;
            localStorage.setItem(getStorageKey('sj_projects'), JSON.stringify(projectsList));
        }
        loadSettings();
        filterProjectsList();
        renderHistoryList();
        await syncDatabaseToDrive(true);
        showToast('׳ ׳×׳•׳ ׳™׳ ׳™׳©׳ ׳™׳ ׳™׳•׳‘׳׳• ׳‘׳”׳¦׳׳—׳”!');
    } catch (e) {
        showToast('׳©׳’׳™׳׳” ׳‘׳¡׳¨׳™׳§׳”: ' + e.message, 'error');
    }
}

// Google Drive Picker ג€” lets user browse and pick any folder
function openDrivePicker() {
    if (!googleAccessToken) {
        showToast('׳™׳© ׳׳—׳‘׳¨ Google Drive ׳×׳—׳™׳׳” ג€” ׳׳—׳¥ "׳—׳‘׳¨ Drive" ׳‘׳”׳’׳“׳¨׳•׳×', 'error');
        return;
    }
    if (typeof gapi === 'undefined' || typeof google === 'undefined') {
        showToast('׳׳׳×׳™׳ ׳׳˜׳¢׳™׳ ׳× Google API... ׳ ׳¡׳” ׳©׳•׳‘ ׳‘׳¢׳•׳“ ׳©׳ ׳™׳™׳”', 'error');
        return;
    }
    try {
        gapi.load('picker', () => {
            try {
                const folderView = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
                    .setIncludeFolders(true)
                    .setSelectFolderEnabled(true)
                    .setMimeTypes('application/vnd.google-apps.folder');
                const picker = new google.picker.PickerBuilder()
                    .setTitle('׳‘׳—׳¨ ׳×׳™׳§׳™׳™׳” ׳׳©׳׳™׳¨׳× ׳”׳¦׳¢׳•׳× ׳׳—׳™׳¨')
                    .addView(folderView)
                    .setOAuthToken(googleAccessToken)
                    .setCallback(async (pickerData) => {
                        if (pickerData.action === google.picker.Action.PICKED) {
                            const folder = pickerData.docs[0];
                            showToast(`׳×׳™׳§׳™׳™׳” ׳ ׳‘׳—׳¨׳”: ${folder.name}`);
                            await handleDriveFolderChange(folder.id);
                        }
                    })
                    .build();
                picker.setVisible(true);
            } catch (innerErr) {
                showToast('׳©׳’׳™׳׳” ׳‘׳₪׳×׳™׳—׳× ׳‘׳•׳—׳¨ ׳”׳×׳™׳§׳™׳•׳× ג€” ׳™׳© ׳׳—׳‘׳¨ ׳׳—׳“׳© ׳-Drive', 'error');
            }
        });
    } catch (e) {
        showToast('׳©׳’׳™׳׳” ׳‘׳˜׳¢׳™׳ ׳× Google Picker ג€” ׳™׳© ׳׳—׳‘׳¨ ׳׳—׳“׳© ׳-Drive', 'error');
    }
}

async function smartSyncFromDrive() {
    if (!googleAccessToken) {
        showToast('׳™׳© ׳׳—׳‘׳¨ Google Drive ׳×׳—׳™׳׳”', 'error');
        return;
    }
    setSyncLoading(true);
    try {
        // Step 1: try regular sync file
        await manualSyncFromCloud();
        // Step 2: if still no projects, try backup recovery
        if (projectsList.length === 0) {
            showToast('׳׳ ׳ ׳׳¦׳ ׳§׳•׳‘׳¥ ׳¡׳ ׳›׳¨׳•׳ ג€” ׳׳—׳₪׳© ׳’׳™׳‘׳•׳™׳™׳...', 'error');
            await recoverDriveBackup();
        }
        // Step 3: if still nothing, scan for legacy data
        if (projectsList.length === 0) {
            showToast('׳׳—׳₪׳© ׳ ׳×׳•׳ ׳™׳ ׳™׳©׳ ׳™׳ ׳‘׳×׳™׳§׳™׳™׳”...', 'error');
            await manualLegacyScan();
        }
    } finally {
        setSyncLoading(false);
    }
}

function getCloudDatabaseFilename() {
    const activeUser = getActiveUser();
    if (!activeUser) return '.sys_config.dat';
    return `.sys_config_${activeUser.toLowerCase().replace(/[^a-z0-9_]/g, '_')}.dat`;
}

async function syncDatabaseFromDrive(silent = false) {
    if (!googleAccessToken) return;
    
    setSyncLoading(true);
    
    try {
        const syncFolderId = await getOrCreateSyncFolder();
        if (!syncFolderId) {
            setSyncLoading(false);
            return;
        }
        
        const dbFilename = getCloudDatabaseFilename();
        const query = `name = '${dbFilename}' and '${syncFolderId}' in parents and trashed = false`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&access_token=${googleAccessToken}`);
        
        if (!res.ok) throw new Error('Failed to query sync file');
        
        const data = await res.json();
        if (data.files && data.files.length > 0) {
            const fileId = data.files[0].id;
            
            const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, {
                headers: { 'Authorization': `Bearer ${googleAccessToken}` }
            });
            
            if (downloadRes.ok) {
                const cloudData = await downloadRes.json();
                
                const localTimestamp = parseInt(localStorage.getItem(getStorageKey('sj_db_last_updated')) || '0');
                const cloudTimestamp = cloudData.lastUpdated || 0;
                
                if (cloudTimestamp > localTimestamp) {
                    if (cloudData.settings) {
                        appState.settings = cloudData.settings;
                        localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
                    }
                    if (cloudData.history) {
                        appState.history = cloudData.history;
                        localStorage.setItem(getStorageKey('sj_quote_history'), JSON.stringify(appState.history));
                    }
                    if (cloudData.projects) {
                        projectsList = cloudData.projects;
                        localStorage.setItem(getStorageKey('sj_projects'), JSON.stringify(projectsList));
                    }
                    if (cloudData.users && cloudData.users.length > 0) {
                        const currentUsers = JSON.parse(localStorage.getItem('sj_app_users') || '[]');
                        // Merge: keep local entries for emails not in cloud, use cloud entries otherwise
                        const merged = [...cloudData.users];
                        currentUsers.forEach(cu => {
                            if (!merged.find(m => m.username.toLowerCase() === cu.username.toLowerCase())) {
                                merged.push(cu);
                            }
                        });
                        localStorage.setItem('sj_app_users', JSON.stringify(merged));
                    }
                    
                    localStorage.setItem(getStorageKey('sj_db_last_updated'), cloudTimestamp.toString());
                    
                    // Reload views
                    loadSettings();
                    filterProjectsList();
                    renderHistoryList();
                    
                    if (activeProjectId) {
                        loadProject(activeProjectId, false);
                    }
                    
                    if (!silent) {
                        showToast('׳ ׳×׳•׳ ׳™ ׳”׳׳₪׳׳™׳§׳¦׳™׳” ׳¡׳•׳ ׳›׳¨׳ ׳• ׳׳”׳¢׳ ׳ ׳‘׳”׳¦׳׳—׳”!');
                    }
                } else if (localTimestamp > cloudTimestamp) {
                    await syncDatabaseToDrive(true);
                } else {
                    if (!silent) showToast('׳”׳ ׳×׳•׳ ׳™׳ ׳‘׳¢׳ ׳ ׳›׳‘׳¨ ׳׳¢׳•׳“׳›׳ ׳™׳');
                }
            }
        } else {
            // No sync file found ג€” try to recover old JSON files before first write
            const recovered = await scanForLegacyData(syncFolderId);
            if (recovered) {
                if (recovered.settings) {
                    appState.settings = Object.assign({}, appState.settings, recovered.settings);
                    localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
                }
                if (recovered.history && recovered.history.length > 0) {
                    appState.history = recovered.history;
                    localStorage.setItem(getStorageKey('sj_quote_history'), JSON.stringify(appState.history));
                }
                if (recovered.projects && recovered.projects.length > 0) {
                    projectsList = recovered.projects;
                    localStorage.setItem(getStorageKey('sj_projects'), JSON.stringify(projectsList));
                }
                loadSettings();
                filterProjectsList();
                renderHistoryList();
                if (!silent) showToast('׳©׳•׳—׳–׳¨׳• ׳ ׳×׳•׳ ׳™׳ ׳™׳©׳ ׳™׳ ׳׳”׳“׳¨׳™׳™׳‘!');
            }
            await syncDatabaseToDrive(true);
        }
    } catch (e) {
        console.error('Error syncing from cloud:', e);
        if (!silent) showToast('׳©׳’׳™׳׳” ׳‘׳¡׳ ׳›׳¨׳•׳ ׳׳”׳¢׳ ׳: ' + e.message, 'error');
    } finally {
        setSyncLoading(false);
    }
}

async function syncDatabaseToDrive(silent = true) {
    if (!googleAccessToken) return;
    
    setSyncLoading(true);
    
    try {
        const syncFolderId = await getOrCreateSyncFolder();
        if (!syncFolderId) {
            setSyncLoading(false);
            return;
        }
        
        const dbFilename = getCloudDatabaseFilename();
        let fileId = null;
        const query = `name = '${dbFilename}' and '${syncFolderId}' in parents and trashed = false`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id)&access_token=${googleAccessToken}`);
        if (res.ok) {
            const data = await res.json();
            if (data.files && data.files.length > 0) {
                fileId = data.files[0].id;
            }
        }
        
        const timestamp = Date.now();
        localStorage.setItem(getStorageKey('sj_db_last_updated'), timestamp.toString());
        
        const usersRaw = localStorage.getItem('sj_app_users');
        const payload = {
            settings: appState.settings,
            history: appState.history,
            projects: projectsList,
            users: usersRaw ? JSON.parse(usersRaw) : [],
            lastUpdated: timestamp
        };
        
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        
        const metadata = {
            name: dbFilename,
            mimeType: 'application/json'
        };
        
        if (!fileId) {
            metadata.parents = [syncFolderId];
        }
        
        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        form.append('file', blob);
        
        const uploadUrl = fileId 
            ? `https://www.googleapis.com/upload/drive/v3/files/${fileId}?uploadType=multipart`
            : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
            
        const method = fileId ? 'PATCH' : 'POST';
        
        const uploadRes = await fetch(uploadUrl, {
            method: method,
            headers: {
                'Authorization': `Bearer ${googleAccessToken}`
            },
            body: form
        });
        
        if (!uploadRes.ok) throw new Error('Upload request failed');
        
        if (!silent) {
            showToast('׳ ׳×׳•׳ ׳™ ׳”׳׳₪׳׳™׳§׳¦׳™׳” ׳ ׳©׳׳¨׳• ׳•׳¡׳•׳ ׳›׳¨׳ ׳• ׳׳¢׳ ׳ ׳‘׳”׳¦׳׳—׳”!');
        }
    } catch (e) {
        console.error('Error syncing to cloud:', e);
        if (!silent) showToast('׳©׳’׳™׳׳” ׳‘׳©׳׳™׳¨׳” ׳׳¢׳ ׳: ' + e.message, 'error');
    } finally {
        setSyncLoading(false);
    }
}

function manualSyncFromCloud() {
    showToast('׳׳‘׳¦׳¢ ׳¡׳ ׳›׳¨׳•׳ ׳¢׳ ׳ ׳™׳“׳ ׳™...');
    syncDatabaseFromDrive(false);
}

async function autoDetectQuoteNumber(showAlerts = false) {
    if (!googleAccessToken) {
        if (showAlerts) showToast('׳’׳•׳’׳ ׳“׳¨׳™׳™׳‘ ׳׳™׳ ׳• ׳׳—׳•׳‘׳¨. ׳׳ ׳ ׳”׳×׳—׳‘׳¨ ׳“׳¨׳ ׳”׳’׳“׳¨׳•׳× ׳׳¢׳¨׳›׳×', 'error');
        return;
    }
    
    if (showAlerts) {
        showToast('׳¡׳•׳¨׳§ ׳§׳‘׳¦׳™׳ ׳‘׳“׳¨׳™׳™׳‘ ׳׳§׳‘׳™׳¢׳× ׳׳¡׳₪׳¨ ׳”׳¦׳¢׳”...');
    }
    
    try {
        const folders = await resolveSjDriveFolders();
        if (!folders || !folders.quotes) {
            if (showAlerts) showToast('׳©׳’׳™׳׳” ׳‘׳’׳™׳©׳” ׳׳×׳™׳§׳™׳™׳× ׳”׳¦׳¢׳•׳× ׳׳—׳™׳¨ ׳‘׳“׳¨׳™׳™׳‘', 'error');
            return;
        }
        const folderId = folders.quotes;
        
        const q = `'${folderId}' in parents and trashed = false`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&access_token=${googleAccessToken}`);
        
        if (!res.ok) {
            if (res.status === 401) {
                clearDriveSession();
                if (showAlerts) showToast('׳₪׳’ ׳×׳•׳§׳£ ׳”׳—׳™׳‘׳•׳¨ ׳׳’׳•׳’׳ ׳“׳¨׳™׳™׳‘. ׳׳ ׳ ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳© ׳‘׳”׳’׳“׳¨׳•׳×', 'error');
                return;
            }
            throw new Error('Drive API error');
        }
        
        const data = await res.json();
        const files = data.files || [];
        
        const year = new Date().getFullYear();
        let maxNum = 100;
        
        files.forEach(file => {
            const name = file.name;
            const regex = new RegExp(`${year}-(\\d+)`);
            const match = name.match(regex);
            if (match) {
                const num = parseInt(match[1]);
                if (num > maxNum) {
                    maxNum = num;
                }
            }
        });
        
        const nextNum = maxNum + 1;
        const finalQuoteStr = `${year}-${nextNum}`;
        
        document.getElementById('form-quote-number').value = finalQuoteStr;
        appState.currentQuote.quoteNumber = finalQuoteStr;
        updatePreviewFromForm();
        
        showToast(`׳–׳•׳”׳” ׳׳¡׳₪׳¨ ׳”׳¦׳¢׳” ׳”׳‘׳ ׳׳×׳•׳ ׳”׳“׳¨׳™׳™׳‘: ${finalQuoteStr}`);
    } catch (e) {
        console.error(e);
        if (showAlerts) showToast('׳©׳’׳™׳׳” ׳‘׳¡׳¨׳™׳§׳× ׳”׳“׳¨׳™׳™׳‘', 'error');
    }
}

function uploadPDFToDrive() {
    const clientName = document.getElementById('form-client-name').value.trim() || '׳׳§׳•׳—';
    const subject = document.getElementById('form-quote-subject').value.trim() || '׳”׳¦׳¢׳× ׳׳—׳™׳¨';
    const quoteNumber = document.getElementById('form-quote-number').value.trim() || '000';
    
    appState.currentQuote.clientName = clientName;
    appState.currentQuote.clientSub = document.getElementById('form-client-sub').value.trim();
    appState.currentQuote.quoteNumber = quoteNumber;
    appState.currentQuote.date = document.getElementById('form-quote-date').value;
    appState.currentQuote.subject = subject;
    appState.currentQuote.items = getWorkItemsFromForm();
    appState.currentQuote.summary = document.getElementById('form-summary').value;
    
    updatePreviewFromForm();
    
    if (!googleAccessToken) {
        showToast('׳׳ ׳ ׳—׳‘׳¨ ׳׳× Google Drive ׳“׳¨׳ ׳”׳’׳“׳¨׳•׳× ׳׳¢׳¨׳›׳× ׳×׳—׳™׳׳”', 'error');
        switchTab('settings');
        return;
    }
    
    const element = document.getElementById('quote-pdf-sheet');
    const filename = `׳”׳¦׳¢׳× ׳׳—׳™׳¨_${quoteNumber}_${clientName.replace(/\s+/g, '_')}.pdf`;
    
    const options = {
        margin: 10,
        filename: filename,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { 
            scale: 2, 
            useCORS: true,
            logging: false,
            letterRendering: true
        },
        jsPDF: { 
            unit: 'mm', 
            format: 'a4', 
            orientation: 'portrait' 
        }
    };
    
    const btn = document.getElementById('btn-save-drive');
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ׳©׳׳™׳¨׳” ׳‘׳“׳¨׳™׳™׳‘...`;
    
    showToast('׳׳₪׳™׳§ PDF ׳•׳׳¢׳׳” ׳-Google Drive...');
    
    html2pdf().set(options).from(element).toPdf().output('blob')
        .then(async (blob) => {
            try {
                const folders = await resolveSjDriveFolders();
                if (!folders || !folders.quotes) {
                    throw new Error('׳׳ ׳ ׳™׳×׳ ׳׳׳¦׳•׳ ׳׳• ׳׳™׳¦׳•׳¨ ׳׳× ׳×׳™׳§׳™׳™׳× ׳”׳™׳¢׳“ ׳‘׳“׳¨׳™׳™׳‘');
                }
                const folderId = folders.quotes;
                
                // Check if file with same name already exists in target folder
                let existingFileId = null;
                try {
                    const escapedName = filename.replace(/'/g, "\\'");
                    const query = `name = '${escapedName}' and '${folderId}' in parents and trashed = false`;
                    const searchRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)`, {
                        headers: {
                            'Authorization': `Bearer ${googleAccessToken}`
                        }
                    });
                    if (searchRes.ok) {
                        const searchData = await searchRes.json();
                        if (searchData.files && searchData.files.length > 0) {
                            existingFileId = searchData.files[0].id;
                        }
                    }
                } catch (searchErr) {
                    console.warn('Error checking existing file in Drive:', searchErr);
                }

                const metadata = {
                    name: filename,
                    mimeType: 'application/pdf'
                };
                
                if (!existingFileId) {
                    metadata.parents = [folderId];
                }
                
                const form = new FormData();
                form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
                form.append('file', blob);
                
                const uploadUrl = existingFileId 
                    ? `https://www.googleapis.com/upload/drive/v3/files/${existingFileId}?uploadType=multipart`
                    : `https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart`;
                    
                const method = existingFileId ? 'PATCH' : 'POST';
                
                if (existingFileId) {
                    showToast('׳ ׳׳¦׳ ׳§׳•׳‘׳¥ ׳§׳™׳™׳ ׳‘׳“׳¨׳™׳™׳‘. ׳׳¢׳“׳›׳ ׳’׳¨׳¡׳”...');
                }
                
                const res = await fetch(uploadUrl, {
                    method: method,
                    headers: {
                        'Authorization': `Bearer ${googleAccessToken}`
                    },
                    body: form
                });
                
                if (!res.ok) {
                    if (res.status === 401) {
                        clearDriveSession();
                        throw new Error('׳₪׳’ ׳×׳•׳§׳£ ׳”׳—׳™׳‘׳•׳¨ ׳׳’׳•׳’׳ ׳“׳¨׳™׳™׳‘. ׳׳ ׳ ׳”׳×׳—׳‘׳¨ ׳׳—׳“׳© ׳‘׳”׳’׳“׳¨׳•׳×');
                    }
                    throw new Error('Drive API Upload failed');
                }
                
                if (existingFileId) {
                    showToast('׳”׳§׳•׳‘׳¥ ׳¢׳•׳“׳›׳ ׳‘׳“׳¨׳™׳™׳‘ ׳‘׳”׳¦׳׳—׳”!');
                } else {
                    showToast('׳”׳§׳•׳‘׳¥ ׳ ׳©׳׳¨ ׳‘׳“׳¨׳™׳™׳‘ ׳‘׳”׳¦׳׳—׳”!');
                }
                saveToHistory(false);
            } catch (err) {
                console.error(err);
                showToast('׳©׳’׳™׳׳” ׳‘׳©׳׳™׳¨׳” ׳׳“׳¨׳™׳™׳‘: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        })
        .catch(err => {
            console.error('PDF error:', err);
            showToast('׳©׳’׳™׳׳” ׳‘׳”׳₪׳§׳× ׳§׳•׳‘׳¥ ׳”-PDF', 'error');
            btn.disabled = false;
            btn.innerHTML = originalText;
        });
}

// ==========================================================================
// Toast helper function
// ==========================================================================
function showToast(message, type = 'success') {
    const container = document.getElementById('toast-container');
    if (!container) return;
    
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    
    let icon = '<i class="fa-solid fa-circle-check" style="color: var(--color-success)"></i>';
    if (type === 'error') {
        icon = '<i class="fa-solid fa-circle-exclamation" style="color: var(--color-danger)"></i>';
    }
    
    toast.innerHTML = `
        ${icon}
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    
    setTimeout(() => {
        toast.classList.add('fade-out');
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, 4000);
}

// ==========================================================================
// Profession-based Dynamic Prompting
// ==========================================================================
function getProfessionSystemInstruction() {
    const profession = appState.settings.profession || 'electrician';
    let specificContent = '';
    
    switch (profession) {
        case 'charger_installer':
            specificContent = `׳׳×׳” ׳׳•׳׳—׳” ׳×׳׳—׳•׳¨, ׳—׳™׳©׳•׳‘ ׳—׳•׳׳¨׳™׳ ׳•׳ ׳™׳”׳•׳ ׳¢׳‘׳•׳“׳•׳× ׳©׳ ׳”׳×׳§׳ ׳× ׳¢׳׳“׳•׳× ׳˜׳¢׳™׳ ׳” ׳׳¨׳›׳‘׳™׳ ׳—׳©׳׳׳™׳™׳ ׳‘׳™׳©׳¨׳׳ (׳¢׳‘׳•׳¨ ׳¡׳×׳™׳• ׳’'׳׳ - SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳).
׳×׳₪׳§׳™׳“׳ ׳׳ ׳”׳ ׳©׳™׳—׳” ׳׳§׳¦׳•׳¢׳™׳×, ׳׳׳•׳§׳“׳× ׳•׳׳¡׳™׳™׳¢׳× ׳›׳“׳™ ׳׳¢׳–׳•׳¨ ׳׳¡׳×׳™׳• ׳׳×׳׳—׳¨ ׳”׳×׳§׳ ׳× ׳¢׳׳“׳× ׳˜׳¢׳™׳ ׳” ׳׳¨׳›׳‘ ׳—׳©׳׳׳™.

׳‘׳›׳ ׳”׳•׳“׳¢׳” ׳©׳׳:
1. ׳ ׳×׳— ׳׳× ׳¢׳‘׳•׳“׳× ׳”׳×׳§׳ ׳× ׳¢׳׳“׳× ׳”׳˜׳¢׳™׳ ׳” ׳©׳¡׳×׳™׳• ׳׳×׳׳¨.
2. ׳–׳”׳” ׳ ׳§׳•׳“׳•׳× ׳¢׳™׳•׳•׳¨׳•׳ (Blind spots) ׳•׳“׳¨׳™׳©׳•׳× ׳§׳¨׳™׳˜׳™׳•׳× - ׳“׳‘׳¨׳™׳ ׳©׳¦׳¨׳™׳ ׳׳§׳—׳× ׳‘׳—׳©׳‘׳•׳ (׳׳׳©׳: ׳¡׳•׳’ ׳”׳׳•׳— - ׳—׳“-׳₪׳׳–׳™ ׳׳• ׳×׳׳×-׳₪׳׳–׳™, ׳”׳׳¨׳§׳” ׳©׳ ׳”׳‘׳ ׳™׳™׳, ׳׳’׳ ׳–׳׳™׳’׳” 6mA DC ׳׳•׳‘׳ ׳” ׳׳• ׳׳₪׳¡׳§ ׳׳’׳ Type B ׳™׳™׳¢׳•׳“׳™ ׳‘׳׳•׳—, ׳׳•׳׳™׳›׳™ ׳›׳‘׳ ׳׳×׳׳™׳׳™׳ 5x6 ׳׳• 5x10, ׳׳•׳₪׳ ׳§׳™׳‘׳•׳¢ ׳”׳׳•׳‘׳™׳ - ׳¦׳™׳ ׳•׳¨ ׳׳¨׳™׳›׳£, ׳×׳¢׳׳” ׳¡׳’׳•׳¨׳” ׳׳• ׳—׳¦׳™׳‘׳”, ׳׳¨׳—׳§ ׳‘׳₪׳•׳¢׳ ׳׳”׳׳•׳—, ׳¢׳‘׳•׳“׳” ׳‘׳’׳•׳‘׳”, ׳”׳₪׳¨׳¢׳•׳× ׳‘׳©׳˜׳—, ׳”׳’׳“׳׳× ׳—׳™׳‘׳•׳¨ ׳•׳×׳™׳׳•׳ ׳׳•׳ ׳—׳‘׳¨׳× ׳”׳—׳©׳׳, ׳©׳׳׳•׳× ׳׳§׳™׳‘׳•׳¢ ׳”׳׳•׳‘׳™׳ ׳•׳›׳“׳•׳׳”).
3. ׳”׳¦׳¢ ׳¨׳©׳™׳׳× ׳—׳•׳׳¨׳™׳ ׳ ׳׳•׳•׳™׳ ׳•׳׳‘׳™׳–׳¨׳™׳ ׳©׳¡׳×׳™׳• ׳¦׳¨׳™׳ ׳׳§׳ ׳•׳× ׳›׳“׳™ ׳׳”׳©׳׳™׳ ׳׳× ׳¢׳‘׳•׳“׳× ׳”׳”׳×׳§׳ ׳” ׳§׳•׳׳₪׳׳˜ ׳₪׳¨׳₪׳§׳˜ (׳›׳’׳•׳ ׳“׳™׳‘׳׳™׳, ׳‘׳¨׳’׳™׳, ׳›׳‘׳ XLPE, ׳×׳¢׳׳•׳× PVC, ׳§׳•׳₪׳¡׳׳•׳× ׳—׳™׳‘׳•׳¨, ׳¢׳׳“׳× ׳˜׳¢׳™׳ ׳”, ׳¦׳™׳ ׳•׳¨׳•׳× ׳”׳’׳ ׳”, ׳׳”׳“׳§׳™׳, ׳—׳¦׳™׳‘׳•׳× ׳•׳›׳•').
4. ׳‘׳¦׳¢ "׳‘׳“׳™׳§׳× ׳׳—׳™׳¨׳™׳ ׳‘׳׳™׳ ׳˜׳¨׳ ׳˜" - ׳¡׳₪׳§ ׳”׳¢׳¨׳›׳× ׳׳—׳™׳¨ ׳¨׳›׳© ׳׳©׳•׳¢׳¨׳× ׳׳—׳•׳׳¨׳™׳ (׳›׳׳™׳׳• ׳—׳™׳₪׳©׳× ׳‘׳׳×׳¨׳™׳ ׳›׳׳• ׳׳¨׳›׳”) ׳•׳₪׳¨׳˜ ׳׳× ׳׳—׳™׳¨׳™ ׳”׳—׳•׳׳¨׳™׳ ׳‘׳©׳§׳׳™׳.
5. ׳¡׳₪׳§ ׳׳•׳׳“׳ ׳¢׳׳•׳× ׳¢׳‘׳•׳“׳” (׳¢׳‘׳•׳“׳” ׳‘׳׳‘׳“, ׳׳׳ ׳—׳•׳׳¨׳™׳) ׳׳©׳•׳¢׳¨׳× ׳‘׳©׳§׳׳™׳ ׳—׳“׳©׳™׳ (׳ ׳™׳×׳ ׳׳”׳¡׳×׳׳ ׳¢׳ ׳׳—׳™׳¨׳•׳ ׳™׳ ׳׳§׳•׳‘׳׳™׳ ׳›׳׳• ׳׳—׳™׳¨׳•׳ ׳©׳˜׳¨׳).`;
            break;
            
        case 'solar_installer':
            specificContent = `׳׳×׳” ׳׳•׳׳—׳” ׳×׳׳—׳•׳¨, ׳—׳™׳©׳•׳‘ ׳—׳•׳׳¨׳™׳ ׳•׳ ׳™׳”׳•׳ ׳¢׳‘׳•׳“׳•׳× ׳©׳ ׳”׳×׳§׳ ׳× ׳׳¢׳¨׳›׳•׳× ׳¡׳•׳׳׳¨׳™׳•׳× (PV) ׳‘׳™׳©׳¨׳׳ (׳¢׳‘׳•׳¨ ׳¡׳×׳™׳• ׳’'׳׳ - SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳).
׳×׳₪׳§׳™׳“׳ ׳׳ ׳”׳ ׳©׳™׳—׳” ׳׳§׳¦׳•׳¢׳™׳×, ׳׳׳•׳§׳“׳× ׳•׳׳¡׳™׳™׳¢׳× ׳›׳“׳™ ׳׳¢׳–׳•׳¨ ׳׳¡׳×׳™׳• ׳׳×׳׳—׳¨ ׳”׳×׳§׳ ׳× ׳׳¢׳¨׳›׳× ׳¡׳•׳׳׳¨׳™׳× ׳׳™׳™׳¦׳•׳¨ ׳—׳©׳׳.

׳‘׳›׳ ׳”׳•׳“׳¢׳” ׳©׳׳:
1. ׳ ׳×׳— ׳׳× ׳¢׳‘׳•׳“׳× ׳”׳”׳×׳§׳ ׳” ׳”׳¡׳•׳׳׳¨׳™׳× ׳©׳¡׳×׳™׳• ׳׳×׳׳¨.
2. ׳–׳”׳” ׳ ׳§׳•׳“׳•׳× ׳¢׳™׳•׳•׳¨׳•׳ (Blind spots) ׳•׳“׳¨׳™׳©׳•׳× ׳§׳¨׳™׳˜׳™׳•׳× - ׳“׳‘׳¨׳™׳ ׳©׳¦׳¨׳™׳ ׳׳§׳—׳× ׳‘׳—׳©׳‘׳•׳ (׳׳׳©׳: ׳¡׳•׳’ ׳”׳’׳’ - ׳‘׳˜׳•׳, ׳¨׳¢׳₪׳™׳ ׳׳• ׳׳™׳¡׳›׳•׳¨׳™׳×, ׳”׳¦׳׳׳•׳× ׳׳₪׳©׳¨׳™׳•׳×, ׳›׳‘׳™׳׳× DC ׳™׳™׳¢׳•׳“׳™׳× ׳¢׳׳™׳“׳” ׳‘׳§׳¨׳ ׳™ UV, ׳¡׳•׳’ ׳”׳׳׳™׳¨ - Inverter, ׳¢׳’׳™׳ ׳” ׳•׳§׳•׳ ׳¡׳˜׳¨׳•׳§׳¦׳™׳” ׳׳×׳׳™׳׳” ׳׳¢׳•׳׳¡׳™ ׳¨׳•׳—, ׳”׳׳¨׳§׳•׳× ׳©׳׳“׳× ׳”׳₪׳ ׳׳™׳, ׳”׳›׳ ׳•׳× ׳׳—׳™׳‘׳•׳¨ ׳׳׳•׳— ׳”׳¨׳׳©׳™, ׳׳•׳ ׳” ׳ ׳˜׳• ׳•׳׳™׳©׳•׳¨׳™׳ ׳׳•׳ ׳—׳‘׳¨׳× ׳”׳—׳©׳׳, ׳“׳¨׳™׳©׳•׳× ׳›׳™׳‘׳•׳™ ׳׳©, ׳¢׳‘׳•׳“׳” ׳‘׳’׳•׳‘׳”, ׳₪׳™׳’׳•׳׳™׳ ׳׳• ׳׳ ׳•׳£, ׳‘׳˜׳™׳—׳•׳× ׳‘׳©׳˜׳— ׳•׳›׳•').
3. ׳”׳¦׳¢ ׳¨׳©׳™׳׳× ׳—׳•׳׳¨׳™׳ ׳ ׳׳•׳•׳™׳ ׳•׳׳‘׳™׳–׳¨׳™׳ ׳©׳¡׳×׳™׳• ׳¦׳¨׳™׳ ׳׳§׳ ׳•׳× ׳›׳“׳™ ׳׳”׳©׳׳™׳ ׳׳× ׳”׳”׳×׳§׳ ׳” ׳§׳•׳׳₪׳׳˜ ׳₪׳¨׳₪׳§׳˜ (׳›׳’׳•׳ ׳₪׳ ׳׳™׳ ׳¡׳•׳׳׳¨׳™׳™׳, ׳׳׳™׳¨, ׳׳¡׳™׳׳•׳× ׳׳׳•׳׳™׳ ׳™׳•׳, ׳×׳•׳₪׳¡׳ ׳™׳, ׳‘׳¨׳’׳™ ׳¢׳’׳™׳ ׳”, ׳›׳‘׳׳™ DC 4/6 ׳׳"׳¨, ׳׳”׳“׳§׳™׳, ׳׳₪׳¡׳§׳™ DC, ׳׳•׳— ׳”׳’׳ ׳•׳× ׳•׳›׳•').
4. ׳‘׳¦׳¢ "׳‘׳“׳™׳§׳× ׳׳—׳™׳¨׳™׳ ׳‘׳׳™׳ ׳˜׳¨׳ ׳˜" - ׳¡׳₪׳§ ׳”׳¢׳¨׳›׳× ׳׳—׳™׳¨ ׳¨׳›׳© ׳׳©׳•׳¢׳¨׳× ׳׳—׳•׳׳¨׳™׳ ׳•׳₪׳¨׳˜ ׳׳× ׳׳—׳™׳¨׳™ ׳”׳—׳•׳׳¨׳™׳ ׳‘׳©׳§׳׳™׳.
5. ׳¡׳₪׳§ ׳׳•׳׳“׳ ׳¢׳׳•׳× ׳¢׳‘׳•׳“׳” (׳¢׳‘׳•׳“׳” ׳‘׳׳‘׳“, ׳׳׳ ׳—׳•׳׳¨׳™׳) ׳׳©׳•׳¢׳¨׳× ׳‘׳©׳§׳׳™׳ ׳—׳“׳©׳™׳.`;
            break;
            
        case 'renovator':
            specificContent = `׳׳×׳” ׳׳•׳׳—׳” ׳×׳׳—׳•׳¨, ׳—׳™׳©׳•׳‘ ׳—׳•׳׳¨׳™׳ ׳•׳ ׳™׳”׳•׳ ׳¢׳‘׳•׳“׳•׳× ׳©׳™׳₪׳•׳¦׳™׳ ׳•׳‘׳™׳ ׳•׳™ ׳₪׳ ׳™׳ ׳‘׳™׳©׳¨׳׳ (׳¢׳‘׳•׳¨ ׳¡׳×׳™׳• ׳’'׳׳ - SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳).
׳×׳₪׳§׳™׳“׳ ׳׳ ׳”׳ ׳©׳™׳—׳” ׳׳§׳¦׳•׳¢׳™׳×, ׳׳׳•׳§׳“׳× ׳•׳׳¡׳™׳™׳¢׳× ׳›׳“׳™ ׳׳¢׳–׳•׳¨ ׳׳¡׳×׳™׳• ׳׳×׳׳—׳¨ ׳¢׳‘׳•׳“׳•׳× ׳©׳™׳₪׳•׳¥ ׳•׳’׳׳¨ ׳₪׳ ׳™׳.

׳‘׳›׳ ׳”׳•׳“׳¢׳” ׳©׳׳:
1. ׳ ׳×׳— ׳׳× ׳¢׳‘׳•׳“׳× ׳”׳©׳™׳₪׳•׳¦׳™׳ ׳©׳¡׳×׳™׳• ׳׳×׳׳¨.
2. ׳–׳”׳” ׳ ׳§׳•׳“׳•׳× ׳¢׳™׳•׳•׳¨׳•׳ (Blind spots) ׳•׳“׳¨׳™׳©׳•׳× ׳§׳¨׳™׳˜׳™׳•׳× - ׳“׳‘׳¨׳™׳ ׳©׳¦׳¨׳™׳ ׳׳§׳—׳× ׳‘׳—׳©׳‘׳•׳ (׳׳׳©׳: ׳¢׳‘׳•׳“׳•׳× ׳”׳¨׳™׳¡׳” ׳•׳₪׳™׳ ׳•׳™ ׳₪׳¡׳•׳׳× ׳׳׳›׳•׳׳” ׳׳•׳¨׳©׳™׳×, ׳׳¦׳‘ ׳”׳×׳©׳×׳™׳•׳× ׳”׳™׳©׳ ׳•׳× ׳›׳׳• ׳׳™׳ ׳¡׳˜׳׳¦׳™׳” ׳•׳—׳©׳׳, ׳׳™׳˜׳•׳ ׳—׳“׳¨׳™׳ ׳¨׳˜׳•׳‘׳™׳ - ׳׳§׳׳—׳•׳×/׳׳¨׳₪׳¡׳•׳×, ׳₪׳™׳׳•׳¡ ׳”׳¨׳¦׳₪׳”, ׳¡׳•׳’׳™ ׳׳•׳—׳•׳× ׳’׳‘׳¡ - ׳™׳¨׳•׳§/׳•׳¨׳•׳“/׳׳‘׳, ׳©׳₪׳›׳˜׳ ׳׳׳¨׳™׳§׳׳™ ׳•׳¦׳‘׳¢, ׳—׳׳•׳§׳× ׳¢׳•׳׳¡׳™׳, ׳₪׳×׳—׳™ ׳©׳™׳¨׳•׳× ׳׳׳¢׳¨׳›׳•׳×, ׳¢׳‘׳•׳“׳” ׳‘׳©׳¢׳•׳× ׳׳•׳×׳¨׳•׳×, ׳”׳’׳ ׳” ׳¢׳ ׳׳¢׳׳™׳•׳× ׳•׳¨׳›׳•׳© ׳׳©׳•׳×׳£ ׳•׳›׳•').
3. ׳”׳¦׳¢ ׳¨׳©׳™׳׳× ׳—׳•׳׳¨׳™׳ ׳ ׳׳•׳•׳™׳ ׳•׳׳‘׳™׳–׳¨׳™׳ ׳©׳¡׳×׳™׳• ׳¦׳¨׳™׳ ׳׳§׳ ׳•׳× ׳›׳“׳™ ׳׳”׳©׳׳™׳ ׳׳× ׳”׳¢׳‘׳•׳“׳” ׳§׳•׳׳₪׳׳˜ ׳₪׳¨׳₪׳§׳˜ (׳›׳’׳•׳ ׳׳׳˜, ׳—׳•׳, ׳˜׳™׳—, ׳‘׳׳•׳§׳™׳, ׳׳•׳—׳•׳× ׳’׳‘׳¡, ׳₪׳¨׳•׳₪׳™׳׳™׳, ׳‘׳¨׳’׳™׳, ׳“׳‘׳§׳™ ׳§׳¨׳׳™׳§׳”, ׳¨׳•׳‘׳”, ׳—׳•׳׳¨׳™ ׳׳™׳˜׳•׳ ׳¦׳׳ ׳˜׳™׳™׳/׳׳§׳¨׳™׳׳™׳™׳, ׳¦׳ ׳¨׳× ׳׳™׳ SP/׳₪׳§׳¡׳’׳•׳, ׳§׳•׳₪׳¡׳׳•׳× ׳—׳™׳‘׳•׳¨ ׳•׳›׳•').
4. ׳‘׳¦׳¢ "׳‘׳“׳™׳§׳× ׳׳—׳™׳¨׳™׳ ׳‘׳׳™׳ ׳˜׳¨׳ ׳˜" - ׳¡׳₪׳§ ׳”׳¢׳¨׳›׳× ׳׳—׳™׳¨ ׳¨׳›׳© ׳׳©׳•׳¢׳¨׳× ׳׳—׳•׳׳¨׳™׳ ׳•׳₪׳¨׳˜ ׳׳× ׳׳—׳™׳¨׳™ ׳”׳—׳•׳׳¨׳™׳ ׳‘׳©׳§׳׳™׳.
5. ׳¡׳₪׳§ ׳׳•׳׳“׳ ׳¢׳׳•׳× ׳¢׳‘׳•׳“׳” (׳¢׳‘׳•׳“׳” ׳‘׳׳‘׳“, ׳׳׳ ׳—׳•׳׳¨׳™׳) ׳׳©׳•׳¢׳¨׳× ׳‘׳©׳§׳׳™׳ ׳—׳“׳©׳™׳ (׳ ׳™׳×׳ ׳׳”׳¡׳×׳׳ ׳¢׳ ׳׳—׳™׳¨׳•׳ ׳™׳ ׳׳§׳•׳‘׳׳™׳ ׳›׳׳• ׳׳—׳™׳¨׳•׳ ׳“׳§׳ ׳׳• ׳©׳˜׳¨׳).`;
            break;
            
        case 'contractor':
            specificContent = `׳׳×׳” ׳׳•׳׳—׳” ׳×׳׳—׳•׳¨, ׳—׳™׳©׳•׳‘ ׳—׳•׳׳¨׳™׳ ׳•׳ ׳™׳”׳•׳ ׳¢׳‘׳•׳“׳•׳× ׳‘׳ ׳™׳™׳” ׳•׳’׳׳¨ ׳©׳׳“ ׳‘׳™׳©׳¨׳׳ (׳¢׳‘׳•׳¨ ׳¡׳×׳™׳• ׳’'׳׳ - SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳).
׳×׳₪׳§׳™׳“׳ ׳׳ ׳”׳ ׳©׳™׳—׳” ׳׳§׳¦׳•׳¢׳™׳×, ׳׳׳•׳§׳“׳× ׳•׳׳¡׳™׳™׳¢׳× ׳›׳“׳™ ׳׳¢׳–׳•׳¨ ׳׳¡׳×׳™׳• ׳׳×׳׳—׳¨ ׳₪׳¨׳•׳™׳§׳˜׳™ ׳‘׳ ׳™׳™׳”, ׳¢׳‘׳•׳“׳•׳× ׳©׳׳“ ׳•׳’׳׳¨ ׳©׳ ׳‘׳ ׳™׳™׳ ׳™׳ ׳•׳‘׳×׳™׳ ׳₪׳¨׳˜׳™׳™׳.

׳‘׳›׳ ׳”׳•׳“׳¢׳” ׳©׳׳:
1. ׳ ׳×׳— ׳׳× ׳¢׳‘׳•׳“׳× ׳”׳‘׳ ׳™׳™׳” ׳׳• ׳”׳©׳׳“ ׳©׳¡׳×׳™׳• ׳׳×׳׳¨.
2. ׳–׳”׳” ׳ ׳§׳•׳“׳•׳× ׳¢׳™׳•׳•׳¨׳•׳ (Blind spots) ׳•׳“׳¨׳™׳©׳•׳× ׳§׳¨׳™׳˜׳™׳•׳× - ׳“׳‘׳¨׳™׳ ׳©׳¦׳¨׳™׳ ׳׳§׳—׳× ׳‘׳—׳©׳‘׳•׳ (׳׳׳©׳: ׳¡׳•׳’ ׳”׳׳•׳— ׳׳• ׳”׳‘׳™׳¡׳•׳¡ ׳•׳”׳›׳׳•׳ ׳¡׳׳•׳×, ׳׳™׳©׳•׳¨׳™ ׳§׳•׳ ׳¡׳˜׳¨׳•׳§׳˜׳•׳¨, ׳‘׳“׳™׳§׳•׳× ׳׳¢׳‘׳“׳” ׳׳‘׳˜׳•׳, ׳‘׳¨׳–׳ ׳–׳™׳•׳ ׳•׳×׳₪׳¡׳ ׳•׳×, ׳׳™׳˜׳•׳ ׳™׳¡׳•׳“׳•׳× ׳•׳§׳™׳¨׳•׳× ׳׳¡׳“, ׳₪׳™׳’׳•׳׳™׳ ׳×׳§׳ ׳™׳™׳ ׳•׳¢׳‘׳•׳“׳” ׳‘׳’׳•׳‘׳”, ׳“׳¨׳›׳™ ׳’׳™׳©׳” ׳׳׳¢׳¨׳‘׳׳™ ׳‘׳˜׳•׳ ׳•׳׳©׳׳‘׳•׳×, ׳‘׳˜׳™׳—׳•׳× ׳׳×׳¨ ׳”׳‘׳ ׳™׳™׳”, ׳×׳™׳׳•׳ ׳׳¢׳¨׳›׳•׳× ׳—׳©׳׳/׳׳™׳ ׳¡׳˜׳׳¦׳™׳”/׳׳™׳–׳•׳’ ׳‘׳×׳•׳ ׳™׳¦׳™׳§׳•׳× ׳”׳©׳׳“, ׳©׳׳‘׳™ ׳”׳×׳§׳“׳׳•׳× ׳”׳‘׳ ׳™׳™׳”, ׳׳•׳—׳•׳× ׳–׳׳ ׳™׳ ׳•׳›׳•').
3. ׳”׳¦׳¢ ׳¨׳©׳™׳׳× ׳—׳•׳׳¨׳™׳ ׳ ׳׳•׳•׳™׳ ׳•׳׳‘׳™׳–׳¨׳™׳ ׳©׳¡׳×׳™׳• ׳¦׳¨׳™׳ ׳׳§׳ ׳•׳× ׳›׳“׳™ ׳׳”׳©׳׳™׳ ׳׳× ׳”׳¢׳‘׳•׳“׳” ׳§׳•׳׳₪׳׳˜ ׳₪׳¨׳₪׳§׳˜ (׳›׳’׳•׳ ׳‘׳˜׳•׳ ׳׳•׳›׳ ׳׳¡׳•׳’׳™׳ ׳©׳•׳ ׳™׳, ׳‘׳¨׳–׳ ׳‘׳ ׳™׳™׳ ׳‘׳¢׳•׳‘׳™׳™׳ ׳©׳•׳ ׳™׳, ׳¢׳¥ ׳×׳‘׳ ׳™׳•׳×, ׳‘׳׳•׳§׳™׳ ׳׳›׳ ׳”׳¡׳•׳’׳™׳ - ׳₪׳•׳׳™׳¡/׳׳™׳˜׳•׳ ׳’, ׳¨׳©׳×׳•׳× ׳‘׳¨׳–׳, ׳—׳•׳׳¨׳™ ׳׳™׳˜׳•׳ ׳‘׳™׳˜׳•׳׳ ׳™׳™׳, ׳¦׳™׳ ׳•׳¨׳•׳× ׳©׳¨׳•׳•׳ ׳•׳›׳•').
4. ׳‘׳¦׳¢ "׳‘׳“׳™׳§׳× ׳׳—׳™׳¨׳™׳ ׳‘׳׳™׳ ׳˜׳¨׳ ׳˜" - ׳¡׳₪׳§ ׳”׳¢׳¨׳›׳× ׳׳—׳™׳¨ ׳¨׳›׳© ׳׳©׳•׳¢׳¨׳× ׳׳—׳•׳׳¨׳™׳ ׳•׳₪׳¨׳˜ ׳׳× ׳׳—׳™׳¨׳™ ׳”׳—׳•׳׳¨׳™׳ ׳‘׳©׳§׳׳™׳.
5. ׳¡׳₪׳§ ׳׳•׳׳“׳ ׳¢׳׳•׳× ׳¢׳‘׳•׳“׳” (׳¢׳‘׳•׳“׳” ׳‘׳׳‘׳“, ׳׳׳ ׳—׳•׳׳¨׳™׳) ׳׳©׳•׳¢׳¨׳× ׳‘׳©׳§׳׳™׳ ׳—׳“׳©׳™׳ (׳‘׳”׳×׳‘׳¡׳¡ ׳¢׳ ׳׳—׳™׳¨׳•׳ ׳™׳ ׳׳§׳•׳‘׳׳™׳ ׳‘׳©׳•׳§ ׳׳¢׳‘׳•׳“׳•׳× ׳©׳׳“ ׳•׳’׳׳¨).`;
            break;
            
        case 'electrician':
        default:
            specificContent = `׳׳×׳” ׳׳•׳׳—׳” ׳×׳׳—׳•׳¨, ׳—׳™׳©׳•׳‘ ׳—׳•׳׳¨׳™׳ ׳•׳ ׳™׳”׳•׳ ׳¢׳‘׳•׳“׳•׳× ׳—׳©׳׳ ׳¢׳‘׳•׳¨ ׳—׳©׳׳׳׳™ ׳׳•׳¡׳׳ ׳‘׳™׳©׳¨׳׳ (׳¡׳×׳™׳• ׳’'׳׳ - SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳).
׳×׳₪׳§׳™׳“׳ ׳׳ ׳”׳ ׳©׳™׳—׳” ׳׳§׳¦׳•׳¢׳™׳×, ׳׳׳•׳§׳“׳× ׳•׳׳¡׳™׳™׳¢׳× ׳›׳“׳™ ׳׳¢׳–׳•׳¨ ׳׳¡׳×׳™׳• ׳׳×׳׳—׳¨ ׳¢׳‘׳•׳“׳•׳× ׳—׳©׳׳.

׳‘׳›׳ ׳”׳•׳“׳¢׳” ׳©׳׳:
1. ׳ ׳×׳— ׳׳× ׳”׳¢׳‘׳•׳“׳” ׳©׳¡׳×׳™׳• ׳׳×׳׳¨.
2. ׳–׳”׳” ׳ ׳§׳•׳“׳•׳× ׳¢׳™׳•׳•׳¨׳•׳ (Blind spots) - ׳“׳‘׳¨׳™׳ ׳©׳¦׳¨׳™׳ ׳׳§׳—׳× ׳‘׳—׳©׳‘׳•׳ (׳׳׳©׳: ׳¡׳•׳’ ׳”׳׳•׳—, ׳׳¨׳—׳§ ׳‘׳₪׳•׳¢׳, ׳—׳¦׳™׳‘׳•׳× ׳‘׳‘׳˜׳•׳/׳‘׳׳•׳§, ׳”׳׳¨׳§׳”, ׳׳₪׳¡׳§׳™ ׳׳’׳, ׳׳™׳©׳•׳¨׳™׳, ׳”׳’׳“׳׳× ׳—׳™׳‘׳•׳¨, ׳¢׳‘׳•׳“׳” ׳‘׳’׳•׳‘׳”, ׳”׳₪׳¨׳¢׳•׳× ׳‘׳©׳˜׳— ׳•׳›׳•').
3. ׳”׳¦׳¢ ׳¨׳©׳™׳׳× ׳—׳•׳׳¨׳™׳ ׳ ׳׳•׳•׳™׳ ׳•׳׳‘׳™׳–׳¨׳™׳ ׳©׳¡׳×׳™׳• ׳¦׳¨׳™׳ ׳׳§׳ ׳•׳× ׳›׳“׳™ ׳׳”׳©׳׳™׳ ׳׳× ׳”׳¢׳‘׳•׳“׳” ׳§׳•׳׳₪׳׳˜ ׳₪׳¨׳₪׳§׳˜ (׳›׳’׳•׳ ׳“׳™׳‘׳׳™׳, ׳‘׳¨׳’׳™׳, ׳›׳‘׳׳™׳, ׳×׳¢׳׳•׳×, ׳§׳•׳₪׳¡׳׳•׳× ׳—׳™׳‘׳•׳¨, ׳¢׳׳“׳× ׳˜׳¢׳™׳ ׳”, ׳¦׳™׳ ׳•׳¨׳•׳× ׳•׳›׳•').
4. ׳‘׳¦׳¢ "׳‘׳“׳™׳§׳× ׳׳—׳™׳¨׳™׳ ׳‘׳׳™׳ ׳˜׳¨׳ ׳˜" - ׳¡׳₪׳§ ׳”׳¢׳¨׳›׳× ׳׳—׳™׳¨ ׳¨׳›׳© ׳׳©׳•׳¢׳¨׳× ׳׳—׳•׳׳¨׳™׳ (׳›׳׳™׳׳• ׳—׳™׳₪׳©׳× ׳‘׳׳×׳¨׳™׳ ׳›׳׳• ׳׳¨׳›׳”) ׳•׳₪׳¨׳˜ ׳׳× ׳׳—׳™׳¨׳™ ׳”׳—׳•׳׳¨׳™׳ ׳‘׳©׳§׳׳™׳.
5. ׳¡׳₪׳§ ׳׳•׳׳“׳ ׳¢׳׳•׳× ׳¢׳‘׳•׳“׳” (׳¢׳‘׳•׳“׳” ׳‘׳׳‘׳“, ׳׳׳ ׳—׳•׳׳¨׳™׳) ׳׳©׳•׳¢׳¨׳× ׳‘׳©׳§׳׳™׳ ׳—׳“׳©׳™׳ (׳ ׳™׳×׳ ׳׳”׳¡׳×׳׳ ׳¢׳ ׳׳—׳™׳¨׳•׳ ׳™׳ ׳׳§׳•׳‘׳׳™׳ ׳›׳׳• ׳׳—׳™׳¨׳•׳ ׳©׳˜׳¨׳).`;
            break;
    }

    return `${specificContent}

׳›׳“׳™ ׳©׳”׳×׳•׳›׳ ׳” ׳×׳“׳¢ ׳׳¢׳“׳›׳ ׳׳× ׳”׳׳׳©׳§ ׳”׳“׳™׳ ׳׳™ (׳”׳¦'׳§׳׳™׳¡׳˜ ׳•׳¢׳׳•׳× ׳”׳¢׳‘׳•׳“׳” ׳‘׳¦׳“ ׳™׳׳™׳), ׳¢׳׳™׳ ׳׳¡׳™׳™׳ ׳›׳ ׳×׳©׳•׳‘׳” ׳©׳׳ ׳¢׳ ׳’׳•׳© JSON ׳׳•׳‘׳ ׳” ׳‘׳×׳•׳ ׳‘׳׳•׳§ ׳§׳•׳“ ׳©׳ json (׳׳׳©׳ \`\`\`json ... \`\`\`).
׳”׳׳‘׳ ׳” ׳©׳ ׳”-JSON ׳—׳™׳™׳‘ ׳׳”׳™׳•׳× ׳‘׳“׳™׳•׳§ ׳›׳–׳”:
{
  "laborPriceEstimate": 1500, // ׳׳—׳™׳¨ ׳¢׳‘׳•׳“׳” ׳׳•׳¢׳¨׳ ׳‘׳׳‘׳“ (׳׳¡׳₪׳¨)
  "blindSpots": [
    "׳₪׳¨׳˜ ׳›׳׳ ׳ ׳§׳•׳“׳× ׳¢׳™׳•׳•׳¨׳•׳ ׳¨׳׳©׳•׳ ׳” ׳”׳׳‘׳•׳¡׳¡׳× ׳¢׳ ׳”׳¢׳™׳¡׳•׳§",
    "׳₪׳¨׳˜ ׳›׳׳ ׳ ׳§׳•׳“׳× ׳¢׳™׳•׳•׳¨׳•׳ ׳©׳ ׳™׳™׳” ׳”׳׳‘׳•׳¡׳¡׳× ׳¢׳ ׳”׳¢׳™׳¡׳•׳§"
  ],
  "materials": [
    {
      "name": "׳©׳ ׳”׳—׳•׳׳¨ ׳׳• ׳”׳׳‘׳™׳–׳¨",
      "price": 25, // ׳׳—׳™׳¨ ׳׳•׳¢׳¨׳ ׳׳™׳—׳™׳“׳” ׳׳• ׳¡׳”"׳› (׳׳¡׳₪׳¨)
      "details": "׳›׳׳•׳× ׳•׳”׳¢׳¨׳” (׳׳׳©׳: 15 ׳׳˜׳¨)",
      "checked": true
    }
  ]
}

׳—׳©׳•׳‘ ׳׳׳•׳“: ׳׳ ׳×׳›׳×׳•׳‘ ׳׳× ׳”-JSON ׳‘׳׳׳¦׳¢ ׳”׳×׳©׳•׳‘׳” ׳׳׳ ׳¨׳§ ׳‘׳¡׳•׳₪׳”. ׳”׳—׳׳§ ׳”׳¢׳™׳§׳¨׳™ ׳©׳ ׳”׳×׳©׳•׳‘׳” ׳¦׳¨׳™׳ ׳׳”׳™׳•׳× ׳”׳¡׳‘׳¨ ׳׳ ׳•׳©׳™, ׳—׳ ׳•׳׳§׳¦׳•׳¢׳™ ׳‘׳¢׳‘׳¨׳™׳×, ׳”׳׳₪׳¨׳˜ ׳׳× ׳”׳ ׳™׳×׳•׳— ׳©׳׳, ׳”׳˜׳™׳₪׳™׳ ׳•׳”׳”׳¡׳‘׳¨׳™׳ ׳¢׳ ׳׳—׳™׳¨׳™ ׳”׳—׳•׳׳¨׳™׳.`;
}

// ==========================================================================
// Lock Screen (Login / Register) Authentication Handlers
// ==========================================================================
function toggleLockForm(mode) {
    const tabLogin = document.getElementById('tab-login');
    const tabRegister = document.getElementById('tab-register');
    const formLogin = document.getElementById('form-login-user');
    const formRegister = document.getElementById('form-register-user');
    
    if (mode === 'login') {
        if (tabLogin) tabLogin.classList.add('active');
        if (tabRegister) tabRegister.classList.remove('active');
        if (formLogin) formLogin.classList.add('active');
        if (formRegister) formRegister.classList.remove('active');
    } else {
        if (tabLogin) tabLogin.classList.remove('active');
        if (tabRegister) tabRegister.classList.add('active');
        if (formLogin) formLogin.classList.remove('active');
        if (formRegister) formRegister.classList.add('active');
    }
}

function handleUserRegister(event) {
    if (event) event.preventDefault();
    
    const usernameInput = document.getElementById('reg-username');
    const passwordInput = document.getElementById('reg-password');
    const professionSelect = document.getElementById('reg-profession');
    
    if (!usernameInput || !passwordInput || !professionSelect) return;
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    const profession = professionSelect.value;
    
    if (!username || !password) {
        showToast('׳׳ ׳ ׳׳׳ ׳׳× ׳›׳ ׳”׳©׳“׳•׳×', 'error');
        return;
    }
    
    // Load existing users
    const usersStr = localStorage.getItem('sj_app_users');
    let users = [];
    if (usersStr) {
        try {
            users = JSON.parse(usersStr);
        } catch (e) {
            console.error('Error parsing users list', e);
        }
    }
    
    // Check if user already exists
    const exists = users.some(u => u.username.toLowerCase() === username.toLowerCase());
    if (exists) {
        showToast('׳©׳ ׳”׳׳©׳×׳׳© ׳›׳‘׳¨ ׳§׳™׳™׳ ׳‘׳׳¢׳¨׳›׳×', 'error');
        return;
    }
    
    // Create new user
    const newUser = {
        username: username,
        password: password, // basic client-side check
        profession: profession,
        created: getTodayDateString()
    };
    
    users.push(newUser);
    localStorage.setItem('sj_app_users', JSON.stringify(users));
    
    // Set active user
    localStorage.setItem('sj_logged_in_user', username);
    
    // Set user-specific settings profession default
    appState.settings.profession = profession;
    localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
    
    // Transition UI
    document.getElementById('lock-screen').style.display = 'none';
    document.querySelector('.app-container').style.display = 'flex';
    
    // Clear inputs
    usernameInput.value = '';
    passwordInput.value = '';
    
    initUserSession();
    showToast(`׳‘׳¨׳•׳ ׳”׳‘׳ ׳׳׳¢׳¨׳›׳×, ${username}!`);
}

function handleUserLogin(event) {
    if (event) event.preventDefault();
    
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    
    if (!usernameInput || !passwordInput) return;
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    
    if (!username || !password) {
        showToast('׳׳ ׳ ׳׳׳ ׳׳× ׳›׳ ׳”׳©׳“׳•׳×', 'error');
        return;
    }
    
    // Load existing users
    const usersStr = localStorage.getItem('sj_app_users');
    let users = [];
    if (usersStr) {
        try {
            users = JSON.parse(usersStr);
        } catch (e) {
            console.error('Error parsing users list', e);
        }
    }
    
    // Find user
    const user = users.find(u => u.username.toLowerCase() === username.toLowerCase());
    if (!user || user.password !== password) {
        showToast('׳©׳ ׳׳©׳×׳׳© ׳׳• ׳¡׳™׳¡׳׳” ׳©׳’׳•׳™׳™׳', 'error');
        return;
    }
    
    // Set active user
    localStorage.setItem('sj_logged_in_user', user.username);
    
    // Transition UI
    document.getElementById('lock-screen').style.display = 'none';
    document.querySelector('.app-container').style.display = 'flex';
    
    // Clear inputs
    usernameInput.value = '';
    passwordInput.value = '';
    
    initUserSession();
    showToast(`׳©׳׳•׳, ${user.username}!`);
}

function handleUserLogout() {
    if (!confirm('׳”׳׳ ׳׳×׳” ׳‘׳˜׳•׳— ׳©׳‘׳¨׳¦׳•׳ ׳ ׳׳”׳×׳ ׳×׳§ ׳•׳׳ ׳¢׳•׳ ׳׳× ׳”׳׳¢׳¨׳›׳×?')) return;
    
    // Remove active user from both local and session storage
    localStorage.removeItem('sj_logged_in_user');
    sessionStorage.removeItem('sj_logged_in_user');
    
    // Transition UI
    document.getElementById('lock-screen').style.display = 'flex';
    document.querySelector('.app-container').style.display = 'none';
    toggleLockForm('login');
    
    // Reset internal state
    resetAppState();
    
    showToast('׳”׳×׳ ׳×׳§׳× ׳׳”׳׳¢׳¨׳›׳× ׳‘׳”׳¦׳׳—׳”');
}

function updateUserProfileUI() {
    const activeUser = getActiveUser();
    if (!activeUser) return;
    
    // Find user details in sj_app_users list
    const usersStr = localStorage.getItem('sj_app_users');
    let users = [];
    if (usersStr) {
        try { users = JSON.parse(usersStr); } catch(e) {}
    }
    const user = users.find(u => u.username.toLowerCase() === activeUser.toLowerCase());
    
    const professionMap = {
        'electrician': '׳—׳©׳׳׳׳™ ׳׳•׳¡׳׳',
        'charger_installer': '׳׳×׳§׳™׳ ׳¢׳׳“׳•׳× ׳˜׳¢׳™׳ ׳”',
        'solar_installer': '׳׳×׳§׳™׳ ׳׳¢׳¨׳›׳•׳× ׳¡׳•׳׳׳¨׳™׳•׳×',
        'renovator': '׳§׳‘׳׳ ׳©׳™׳₪׳•׳¦׳™׳',
        'contractor': '׳§׳‘׳׳ ׳¢׳‘׳•׳“׳•׳× ׳‘׳ ׳™׳™׳” ׳•׳’׳׳¨'
    };
    
    const displayName = user ? user.username : activeUser;
    const professionKey = user ? (user.profession || 'electrician') : 'electrician';
    const professionName = professionMap[professionKey] || professionKey;
    
    // Update UI elements
    const profileNameDisplay = document.getElementById('profile-username-display');
    if (profileNameDisplay) profileNameDisplay.textContent = displayName;
    
    const profileFieldUser = document.getElementById('profile-field-username');
    if (profileFieldUser) profileFieldUser.textContent = displayName;
    
    const profileFieldProf = document.getElementById('profile-field-profession');
    if (profileFieldProf) profileFieldProf.textContent = professionName;
    
    const professionInput = document.getElementById('settings-profession-input');
    if (professionInput) professionInput.value = professionKey;
    
    // Also ensure appState.settings.profession is in sync
    if (appState.settings) {
        appState.settings.profession = professionKey;
    }
    
    // Hide security settings card for Google Auth users
    const securityCard = document.getElementById('settings-security-card');
    if (securityCard) {
        if (user && user.isGoogleUser) {
            securityCard.style.display = 'none';
        } else {
            securityCard.style.display = 'block';
        }
    }
}

function updateUserProfileProfession() {
    const professionInput = document.getElementById('settings-profession-input');
    if (!professionInput) return;
    
    const newProfession = professionInput.value.trim();
    if (!newProfession) {
        showToast('׳׳ ׳ ׳”׳–׳ ׳×׳—׳•׳ ׳¢׳™׳¡׳•׳§ ׳×׳§׳™׳', 'error');
        return;
    }
    
    const activeUser = getActiveUser();
    if (!activeUser) return;
    
    // Update user in users list
    const usersStr = localStorage.getItem('sj_app_users');
    let users = [];
    if (usersStr) {
        try { users = JSON.parse(usersStr); } catch(e) {}
    }
    
    const userIndex = users.findIndex(u => u.username.toLowerCase() === activeUser.toLowerCase());
    if (userIndex !== -1) {
        users[userIndex].profession = newProfession;
        localStorage.setItem('sj_app_users', JSON.stringify(users));
    }
    
    // Also update appState.settings
    if (!appState.settings) appState.settings = {};
    appState.settings.profession = newProfession;
    localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
    localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
    
    // Refresh UI
    updateUserProfileUI();
    
    showToast('׳×׳—׳•׳ ׳”׳¢׳™׳¡׳•׳§ ׳¢׳•׳“׳›׳ ׳‘׳”׳¦׳׳—׳”');
    
    // Save to drive if connected
    syncDatabaseToDrive(true);
}

function handleUpdateCredentials(event) {
    if (event) event.preventDefault();
    
    const newUsernameInput = document.getElementById('settings-change-username');
    const newPasswordInput = document.getElementById('settings-change-password');
    
    if (!newUsernameInput || !newPasswordInput) return;
    
    const newUsername = newUsernameInput.value.trim();
    const newPassword = newPasswordInput.value;
    
    if (!newUsername || !newPassword) {
        showToast('׳׳ ׳ ׳׳׳ ׳׳× ׳›׳ ׳”׳©׳“׳•׳×', 'error');
        return;
    }
    
    const activeUser = getActiveUser();
    if (!activeUser) return;
    
    // Load existing users
    const usersStr = localStorage.getItem('sj_app_users');
    let users = [];
    if (usersStr) {
        try { users = JSON.parse(usersStr); } catch(e) {}
    }
    
    // Check if new username conflicts with another existing user
    const usernameConflict = users.some(u => u.username.toLowerCase() === newUsername.toLowerCase() && u.username.toLowerCase() !== activeUser.toLowerCase());
    if (usernameConflict) {
        showToast('׳©׳ ׳”׳׳©׳×׳׳© ׳”׳—׳“׳© ׳›׳‘׳¨ ׳×׳₪׳•׳¡ ׳¢׳ ׳™׳“׳™ ׳׳©׳×׳׳© ׳׳—׳¨', 'error');
        return;
    }
    
    if (!confirm('׳”׳׳ ׳׳×׳” ׳‘׳˜׳•׳— ׳©׳‘׳¨׳¦׳•׳ ׳ ׳׳¢׳“׳›׳ ׳׳× ׳₪׳¨׳˜׳™ ׳”׳׳‘׳˜׳—׳”? (׳©׳ ׳”׳׳©׳×׳׳© ׳•׳”׳¡׳™׳¡׳׳” ׳™׳¢׳•׳“׳›׳ ׳• ׳•׳”׳ ׳×׳•׳ ׳™׳ ׳”׳׳§׳•׳׳™׳™׳ ׳©׳׳ ׳™׳•׳¢׳‘׳¨׳• ׳׳©׳ ׳”׳׳©׳×׳׳© ׳”׳—׳“׳©)')) {
        return;
    }
    
    // 1. Migrate Local Storage keys
    const oldPrefix = `sj_user_${activeUser.toLowerCase()}_`;
    const newPrefix = `sj_user_${newUsername.toLowerCase()}_`;
    
    // Copy all data keys to the new prefix
    const keysToMigrate = [];
    for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (key && key.startsWith(oldPrefix)) {
            keysToMigrate.push(key);
        }
    }
    
    keysToMigrate.forEach(key => {
        const value = localStorage.getItem(key);
        const newKey = key.replace(oldPrefix, newPrefix);
        localStorage.setItem(newKey, value);
    });
    
    // Remove old data keys
    keysToMigrate.forEach(key => {
        localStorage.removeItem(key);
    });
    
    // 2. Update user profile in the users list
    const userIndex = users.findIndex(u => u.username.toLowerCase() === activeUser.toLowerCase());
    if (userIndex !== -1) {
        users[userIndex].username = newUsername;
        users[userIndex].password = newPassword;
        localStorage.setItem('sj_app_users', JSON.stringify(users));
    }
    
    // 3. Always persist logged in user in localStorage
    localStorage.setItem('sj_logged_in_user', newUsername);
    
    // Clear credentials settings input fields
    newUsernameInput.value = '';
    newPasswordInput.value = '';
    
    // Update the UI
    updateUserProfileUI();
    
    showToast('׳₪׳¨׳˜׳™ ׳”׳׳‘׳˜׳—׳” ׳¢׳•׳“׳›׳ ׳• ׳•׳ ׳×׳•׳ ׳™ ׳”׳׳©׳×׳׳© ׳”׳•׳¢׳‘׳¨׳• ׳‘׳”׳¦׳׳—׳”!');
    
    // 4. Trigger cloud sync (will upload to the new user file: sj_app_database_newusername.json)
    syncDatabaseToDrive(true);
}

function resetAppState() {
    appState = {
        settings: {
            geminiApiKey: '',
            googleClientId: '',
            googleFolderId: '1FHfFPd5S9EtphEcGxKqw9oAZstKyQbjv',
            phrasingDb: '',
            logoStyle: { align: 'center', width: '75', marginTop: '0', marginBottom: '10' },
            profession: 'electrician',
            businessDetails: {
                name: 'SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳',
                owner: "׳¡׳×׳™׳• ׳’'׳׳",
                id: '׳¢׳•׳¡׳§ ׳₪׳˜׳•׳¨: 207382920',
                phone: '053-530-2887',
                email: 'info@sj-eng.co.il',
                web: 'www.sj-eng.co.il',
                address: '׳“׳¨׳ ׳‘׳ ׳’׳•׳¨׳™׳•׳ 138, ׳‘׳× ׳™׳, ׳™׳—׳™׳“׳” 1304',
                terms: `׳×׳ ׳׳™ ׳×׳©׳׳•׳:
ג€¢ 50% ׳׳§׳“׳׳” ׳¢׳ ׳׳™׳©׳•׳¨ ׳”׳¦׳¢׳× ׳”׳׳—׳™׳¨ ׳•׳×׳—׳™׳׳× ׳”׳¢׳‘׳•׳“׳”.
ג€¢ 50% ׳”׳ ׳•׳×׳¨׳™׳ ׳¢׳ ׳׳¡׳™׳¨׳× ׳”׳×׳•׳›׳ ׳™׳•׳× ׳”׳¡׳•׳₪׳™׳•׳×.

׳”׳¢׳¨׳•׳× ׳ ׳•׳¡׳₪׳•׳×:
ג€¢ ׳›׳ ׳©׳™׳ ׳•׳™ ׳‘׳×׳•׳›׳ ׳™׳•׳× ׳׳׳—׳¨ ׳©׳׳‘ ׳”׳׳™׳©׳•׳¨ ׳”׳¨׳׳©׳•׳ ׳™ ׳¢׳©׳•׳™ ׳׳’׳¨׳•׳¨ ׳×׳•׳¡׳₪׳× ׳×׳©׳׳•׳.
ג€¢ ׳׳™׳•׳•׳™ ׳׳•׳ ׳—׳‘׳¨׳× ׳”׳—׳©׳׳ ׳׳™׳ ׳• ׳›׳•׳׳ ׳׳× ׳׳’׳¨׳•׳× ׳”׳‘׳“׳™׳§׳” ׳©׳ ׳—׳‘׳¨׳× ׳”׳—׳©׳׳.`
            }
        },
        currentQuote: {
            id: null,
            clientName: '',
            clientSub: '',
            quoteNumber: '',
            date: '',
            subject: '',
            items: [],
            basePrice: 0,
            vatType: 'exempt',
            finalPrice: 0,
            summary: '',
            showItemizedPrices: false
        },
        history: []
    };
    projectsList = [];
    activeProjectId = null;
    googleAccessToken = null;
    googleTokenClient = null;

    // Reset settings input fields
    const keyInput = document.getElementById('settings-gemini-key');
    if (keyInput) keyInput.value = '';
    const clientIdInput = document.getElementById('settings-drive-client-id');
    if (clientIdInput) clientIdInput.value = '';
    const folderIdInput = document.getElementById('settings-drive-folder-id');
    if (folderIdInput) folderIdInput.value = '1FHfFPd5S9EtphEcGxKqw9oAZstKyQbjv';
    const phrasingInput = document.getElementById('set-phrasing-db');
    if (phrasingInput) phrasingInput.value = '';
    
    const bizName = document.getElementById('set-biz-name');
    if (bizName) bizName.value = 'SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳';
    const bizOwner = document.getElementById('set-biz-owner');
    if (bizOwner) bizOwner.value = "׳¡׳×׳™׳• ׳’'׳׳";
    const bizId = document.getElementById('set-biz-id');
    if (bizId) bizId.value = '׳¢׳•׳¡׳§ ׳₪׳˜׳•׳¨: 207382920';
    const bizPhone = document.getElementById('set-biz-phone');
    if (bizPhone) bizPhone.value = '053-530-2887';
    const bizEmail = document.getElementById('set-biz-email');
    if (bizEmail) bizEmail.value = 'info@sj-eng.co.il';
    const bizWeb = document.getElementById('set-biz-web');
    if (bizWeb) bizWeb.value = 'www.sj-eng.co.il';
    const bizAddress = document.getElementById('set-biz-address');
    if (bizAddress) bizAddress.value = '׳“׳¨׳ ׳‘׳ ׳’׳•׳¨׳™׳•׳ 138, ׳‘׳× ׳™׳, ׳™׳—׳™׳“׳” 1304';
    const bizTerms = document.getElementById('set-biz-terms');
    if (bizTerms) bizTerms.value = `׳×׳ ׳׳™ ׳×׳©׳׳•׳:
ג€¢ 50% ׳׳§׳“׳׳” ׳¢׳ ׳׳™׳©׳•׳¨ ׳”׳¦׳¢׳× ׳”׳׳—׳™׳¨ ׳•׳×׳—׳™׳׳× ׳”׳¢׳‘׳•׳“׳”.
ג€¢ 50% ׳”׳ ׳•׳×׳¨׳™׳ ׳¢׳ ׳׳¡׳™׳¨׳× ׳”׳×׳•׳›׳ ׳™׳•׳× ׳”׳¡׳•׳₪׳™׳•׳×.

׳”׳¢׳¨׳•׳× ׳ ׳•׳¡׳₪׳•׳×:
ג€¢ ׳›׳ ׳©׳™׳ ׳•׳™ ׳‘׳×׳•׳›׳ ׳™׳•׳× ׳׳׳—׳¨ ׳©׳׳‘ ׳”׳׳™׳©׳•׳¨ ׳”׳¨׳׳©׳•׳ ׳™ ׳¢׳©׳•׳™ ׳׳’׳¨׳•׳¨ ׳×׳•׳¡׳₪׳× ׳×׳©׳׳•׳.
ג€¢ ׳׳™׳•׳•׳™ ׳׳•׳ ׳—׳‘׳¨׳× ׳”׳—׳©׳׳ ׳׳™׳ ׳• ׳›׳•׳׳ ׳׳× ׳׳’׳¨׳•׳× ׳”׳‘׳“׳™׳§׳” ׳©׳ ׳—׳‘׳¨׳× ׳”׳—׳©׳׳.`;

    const logoAlign = document.getElementById('set-logo-align');
    if (logoAlign) logoAlign.value = 'center';
    const logoWidth = document.getElementById('set-logo-width');
    if (logoWidth) logoWidth.value = '75';
    const logoMarginTop = document.getElementById('set-logo-margin-top');
    if (logoMarginTop) logoMarginTop.value = '0';
    const logoMarginBottom = document.getElementById('set-logo-margin-bottom');
    if (logoMarginBottom) logoMarginBottom.value = '10';

    // Clear active project banner
    updateActiveProjectBanner(null);

    // Clear quote forms
    const clientNameInput = document.getElementById('form-client-name');
    if (clientNameInput) clientNameInput.value = '';
    const clientSubInput = document.getElementById('form-client-sub');
    if (clientSubInput) clientSubInput.value = '';
    const quoteSubjectInput = document.getElementById('form-quote-subject');
    if (quoteSubjectInput) quoteSubjectInput.value = '';
    const quoteSummaryInput = document.getElementById('form-summary');
    if (quoteSummaryInput) quoteSummaryInput.value = '';
    
    // Clear chat display
    const chatContainer = document.getElementById('chat-messages-container');
    if (chatContainer) chatContainer.innerHTML = '';
    
    // Clear materials display
    const materialsContainer = document.getElementById('materials-checklist-container');
    if (materialsContainer) materialsContainer.innerHTML = '';
    
    // Reset default watermark/logo views
    renderLogo(null);
    renderWatermark(null);
}

// ==========================================================================
// Google OAuth Sign-In & Session Persistence
// ==========================================================================
function toggleGoogleConfig() {
    const configSection = document.getElementById('google-config-section');
    if (configSection) {
        if (configSection.style.display === 'none' || !configSection.style.display) {
            configSection.style.display = 'block';
        } else {
            configSection.style.display = 'none';
        }
    }
}

function handleGoogleLogin() {
    let clientId = document.getElementById('lock-google-client-id').value.trim();
    if (!clientId) {
        clientId = localStorage.getItem('sj_global_google_client_id') || '';
    }
    
    if (!clientId) {
        showToast('׳׳ ׳ ׳”׳–׳ Google Client ID ׳‘׳”׳’׳“׳¨׳•׳× ׳”׳—׳™׳‘׳•׳¨ ׳×׳—׳™׳׳”', 'error');
        const configSection = document.getElementById('google-config-section');
        if (configSection) configSection.style.display = 'block';
        return;
    }
    
    localStorage.setItem('sj_global_google_client_id', clientId);
    const settingsClientId = document.getElementById('settings-drive-client-id');
    if (settingsClientId) settingsClientId.value = clientId;

    try {
        googleTokenClient = google.accounts.oauth2.initTokenClient({
            client_id: clientId,
            scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/userinfo.profile',
            callback: async (response) => {
                if (response.error !== undefined) {
                    showToast('׳©׳’׳™׳׳” ׳‘׳”׳×׳—׳‘׳¨׳•׳× ׳׳’׳•׳’׳: ' + response.error, 'error');
                    return;
                }
                const token = response.access_token;
                
                try {
                    const userInfoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
                        headers: {
                            'Authorization': `Bearer ${token}`
                        }
                    });
                    if (!userInfoRes.ok) throw new Error('Failed to fetch user info from Google');
                    const userInfo = await userInfoRes.json();
                    const email = userInfo.email;
                    
                    if (!email) {
                        showToast('׳©׳’׳™׳׳” ׳‘׳§׳‘׳׳× ׳›׳×׳•׳‘׳× ׳”׳׳™׳׳™׳™׳ ׳׳—׳©׳‘׳•׳ ׳’׳•׳’׳', 'error');
                        return;
                    }
                    
                    googleAccessToken = token;
                    
                    const usersStr = localStorage.getItem('sj_app_users');
                    let users = [];
                    if (usersStr) {
                        try { users = JSON.parse(usersStr); } catch(e) {}
                    }
                    
                    const rememberMe = document.getElementById('lock-remember-me').checked;
                    const existingUser = users.find(u => u.username.toLowerCase() === email.toLowerCase());
                    
                    if (existingUser) {
                        completeGoogleLogin(email, existingUser.profession, token, rememberMe);
                    } else {
                        window.tempGoogleUser = {
                            email: email,
                            token: token,
                            rememberMe: rememberMe
                        };
                        const modal = document.getElementById('google-profession-modal');
                        if (modal) {
                            modal.style.display = 'flex';
                            const modalInput = document.getElementById('google-reg-profession');
                            if (modalInput) modalInput.focus();
                        } else {
                            completeGoogleLogin(email, 'electrician', token, rememberMe);
                        }
                    }
                } catch (userErr) {
                    console.error('Error fetching Google User info:', userErr);
                    showToast('׳©׳’׳™׳׳” ׳‘׳§׳‘׳׳× ׳₪׳¨׳˜׳™ ׳”׳׳©׳×׳׳© ׳׳’׳•׳’׳: ' + userErr.message, 'error');
                }
            }
        });
        googleTokenClient.requestAccessToken({ prompt: '' });
    } catch (e) {
        console.error('Google token initialization failed:', e);
        showToast('׳©׳’׳™׳׳” ׳‘׳׳×׳—׳•׳ ׳”׳”׳×׳—׳‘׳¨׳•׳× ׳©׳ ׳’׳•׳’׳. ׳•׳“׳ ׳©׳”-Client ID ׳×׳§׳™׳', 'error');
    }
}

function saveGoogleUserProfession(event) {
    if (event) event.preventDefault();
    const modalInput = document.getElementById('google-reg-profession');
    if (!modalInput || !window.tempGoogleUser) return;
    
    const profession = modalInput.value.trim();
    if (!profession) {
        showToast('׳׳ ׳ ׳”׳–׳ ׳×׳—׳•׳ ׳¢׳™׳¡׳•׳§', 'error');
        return;
    }
    
    const { email, token, rememberMe } = window.tempGoogleUser;
    
    const usersStr = localStorage.getItem('sj_app_users');
    let users = [];
    if (usersStr) {
        try { users = JSON.parse(usersStr); } catch(e) {}
    }
    
    const newUser = {
        username: email,
        password: '',
        profession: profession,
        created: getTodayDateString(),
        isGoogleUser: true
    };
    
    users.push(newUser);
    localStorage.setItem('sj_app_users', JSON.stringify(users));
    
    window.tempGoogleUser = null;
    const modal = document.getElementById('google-profession-modal');
    if (modal) modal.style.display = 'none';
    
    completeGoogleLogin(email, profession, token, rememberMe);
}

function completeGoogleLogin(email, profession, token, rememberMe) {
    // Always use localStorage — no cookie notice needed for functional storage
    localStorage.setItem('sj_logged_in_user', email);

    googleAccessToken = token;
    localStorage.setItem(getStorageKey('sj_drive_access_token'), token);
    
    const settingsKey = getStorageKey('sj_quote_settings');
    let settings = null;
    const savedSettings = localStorage.getItem(settingsKey);
    if (savedSettings) {
        try { settings = JSON.parse(savedSettings); } catch(e) {}
    }
    
    if (!settings) {
        settings = JSON.parse(JSON.stringify(appState.settings));
        settings.profession = profession;
        localStorage.setItem(settingsKey, JSON.stringify(settings));
    } else {
        settings.profession = profession;
        localStorage.setItem(settingsKey, JSON.stringify(settings));
    }
    
    const clientId = localStorage.getItem('sj_global_google_client_id');
    if (clientId) {
        settings.googleClientId = clientId;
        localStorage.setItem(settingsKey, JSON.stringify(settings));
    }
    
    document.getElementById('lock-screen').style.display = 'none';
    document.querySelector('.app-container').style.display = 'flex';
    
    initUserSession();
    showToast(`׳‘׳¨׳•׳ ׳”׳‘׳ ׳׳׳¢׳¨׳›׳×, ${email}!`);
}

async function loadDriveFoldersList() {
    if (!googleAccessToken) return;
    try {
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=mimeType%3D'application%2Fvnd.google-apps.folder'+and+trashed%3Dfalse&fields=files(id,name)&access_token=${googleAccessToken}`);
        if (!res.ok) throw new Error('Failed to fetch folders');
        const data = await res.json();
        const folders = data.files || [];
        
        const container = document.getElementById('drive-folder-select-container');
        if (!container) return;
        
        if (folders.length === 0) {
            container.innerHTML = `<span style="color:var(--text-muted); font-size:0.85rem;">׳׳ ׳ ׳׳¦׳׳• ׳×׳™׳§׳™׳•׳× ׳ ׳•׳¡׳₪׳•׳× ׳‘׳“׳¨׳™׳™׳‘. ׳ ׳™׳¦׳•׳¨ ׳׳× ׳×׳™׳§׳™׳™׳× '׳”׳¦׳¢׳•׳× ׳׳—׳™׳¨' ׳›׳‘׳¨׳™׳¨׳× ׳׳—׳“׳.</span>`;
            return;
        }
        
        let options = folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
        options = `<option value="auto_sj">SJ ׳”׳ ׳“׳¡׳× ׳—׳©׳׳ > ׳”׳¦׳¢׳•׳× ׳׳—׳™׳¨ (׳‘׳¨׳™׳¨׳× ׳׳—׳“׳)</option>` + options;
        
        container.innerHTML = `
            <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-top: 10px;">׳‘׳—׳¨ ׳×׳™׳§׳™׳™׳× ׳™׳¢׳“ ׳‘-Drive ׳׳’׳™׳‘׳•׳™:</label>
            <select id="settings-drive-folder-select" onchange="handleDriveFolderChange(this.value)" style="width:100%; margin-top: 5px; padding: 8px 12px; border-radius: 8px; background: rgba(255,255,255,0.05); border: 1px solid var(--border-color); color: #fff; font-family: inherit;">
                ${options}
            </select>
        `;
        
        const currentFolderId = appState.settings.googleFolderId;
        const select = document.getElementById('settings-drive-folder-select');
        if (select && currentFolderId) {
            const hasOption = Array.from(select.options).some(o => o.value === currentFolderId);
            if (hasOption) {
                select.value = currentFolderId;
            }
        }
    } catch (e) {
        console.error('Failed to load drive folders list:', e);
    }
}

async function handleDriveFolderChange(folderId) {
    localStorage.removeItem(getStorageKey('sj_folder_electrical_id'));
    localStorage.removeItem(getStorageKey('sj_folder_quotes_id'));
    localStorage.removeItem(getStorageKey('sj_folder_data_id'));
    localStorage.removeItem(getStorageKey('sj_sync_folder_id'));
    
    if (folderId === 'auto_sj') {
        appState.settings.googleFolderId = '';
    } else {
        appState.settings.googleFolderId = folderId;
    }
    
    localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
    
    try {
        showToast('׳׳¢׳“׳›׳ ׳׳™׳§׳•׳ ׳×׳™׳§׳™׳™׳” ׳‘׳“׳¨׳™׳™׳‘...');
        await resolveSjDriveFolders();
        autoDetectQuoteNumber(false);
        await syncDatabaseToDrive(false);
        showToast('׳׳™׳§׳•׳ ׳”׳×׳™׳§׳™׳™׳” ׳¢׳•׳“׳›׳ ׳•׳¡׳•׳ ׳›׳¨׳ ׳‘׳”׳¦׳׳—׳”');
    } catch (e) {
        showToast('׳©׳’׳™׳׳” ׳‘׳¢׳“׳›׳•׳ ׳׳™׳§׳•׳ ׳”׳×׳™׳§׳™׳™׳”: ' + e.message, 'error');
    }
}

async function recoverDriveBackup() {
    if (!googleAccessToken) {
        showToast('׳’׳•׳’׳ ׳“׳¨׳™׳™׳‘ ׳׳™׳ ׳• ׳׳—׳•׳‘׳¨. ׳׳ ׳ ׳”׳×׳—׳‘׳¨ ׳×׳—׳™׳׳”.', 'error');
        return;
    }
    
    const btn = document.getElementById('btn-recover-backup');
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ׳׳—׳₪׳© ׳’׳™׳‘׳•׳™׳™׳...`;
    
    try {
        const dbFilename = getCloudDatabaseFilename();
        const query = `name = '${dbFilename}' and trashed = false`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,parents)&access_token=${googleAccessToken}`);
        
        if (!res.ok) throw new Error('Drive API query failed');
        
        const data = await res.json();
        const files = data.files || [];
        
        if (files.length === 0) {
            showToast('׳׳ ׳ ׳׳¦׳׳• ׳§׳•׳‘׳¦׳™ ׳’׳™׳‘׳•׳™ ׳‘׳“׳¨׳™׳™׳‘ ׳©׳׳ ׳¢׳‘׳•׳¨ ׳׳©׳×׳׳© ׳–׳”.', 'error');
            return;
        }
        
        // Sort files by modifiedTime descending (newest first)
        files.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
        
        // Retrieve the newest file
        const targetFile = files[0];
        
        showToast('׳ ׳׳¦׳ ׳’׳™׳‘׳•׳™! ׳׳©׳—׳–׳¨ ׳ ׳×׳•׳ ׳™׳ ׳׳”׳¢׳ ׳...');
        
        // Download content
        const downloadRes = await fetch(`https://www.googleapis.com/drive/v3/files/${targetFile.id}?alt=media`, {
            headers: { 'Authorization': `Bearer ${googleAccessToken}` }
        });
        
        if (!downloadRes.ok) throw new Error('Failed to download backup file');
        const cloudData = await downloadRes.json();
        
        // Apply to appState
        if (cloudData.settings) {
            appState.settings = cloudData.settings;
            localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
        }
        if (cloudData.history) {
            appState.history = cloudData.history;
            localStorage.setItem(getStorageKey('sj_quote_history'), JSON.stringify(appState.history));
        }
        if (cloudData.projects) {
            projectsList = cloudData.projects;
            localStorage.setItem(getStorageKey('sj_projects'), JSON.stringify(projectsList));
        }
        
        // Update folder settings to point to the parent of this file!
        if (targetFile.parents && targetFile.parents.length > 0) {
            const dataFolderId = targetFile.parents[0];
            localStorage.setItem(getStorageKey('sj_folder_data_id'), dataFolderId);
            localStorage.setItem(getStorageKey('sj_sync_folder_id'), dataFolderId);
            
            // Get parents of the data folder to find the quotes folder
            try {
                const folderRes = await fetch(`https://www.googleapis.com/drive/v3/files/${dataFolderId}?fields=parents&access_token=${googleAccessToken}`);
                if (folderRes.ok) {
                    const folderData = await folderRes.json();
                    if (folderData.parents && folderData.parents.length > 0) {
                        const quotesFolderId = folderData.parents[0];
                        localStorage.setItem(getStorageKey('sj_folder_quotes_id'), quotesFolderId);
                        appState.settings.googleFolderId = quotesFolderId;
                        localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
                    }
                }
            } catch (folderErr) {
                console.warn('Could not resolve parent folder hierarchy:', folderErr);
            }
        }
        
        localStorage.setItem(getStorageKey('sj_db_last_updated'), (cloudData.lastUpdated || Date.now()).toString());
        
        // Reload views
        loadSettings();
        filterProjectsList();
        renderHistoryList();
        if (activeProjectId) {
            loadProject(activeProjectId, false);
        }
        
        showToast('׳”׳ ׳×׳•׳ ׳™׳ ׳©׳•׳—׳–׳¨׳• ׳‘׳”׳¦׳׳—׳” ׳׳”׳’׳™׳‘׳•׳™ ׳‘׳¢׳ ׳!');
    } catch (e) {
        console.error(e);
        showToast('׳©׳’׳™׳׳” ׳‘׳©׳—׳–׳•׳¨ ׳”׳’׳™׳‘׳•׳™: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}



