// ==========================================================================
// Application Logic for SJ Electrical Engineering Quote Generator (Phase 4)
// Projects Manager & Dual-Agent AI Architecture (Pricing & Phrasing)
// ==========================================================================

// ==========================================================================
// Admin configuration
// ==========================================================================
const ADMIN_EMAIL = 'stavjan19989@gmail.com';

function isAdmin() {
    return (getActiveUser() || '').toLowerCase().trim() === ADMIN_EMAIL.toLowerCase();
}

function showAdminTabIfNeeded() {
    const adminTab = document.getElementById('tab-admin');
    if (adminTab) adminTab.style.display = isAdmin() ? 'flex' : 'none';
}

function adminSaveGeminiKey() {
    const key = (document.getElementById('admin-gemini-key')?.value || '').trim();
    if (!key) { showToast('הזן מפתח תחילה', 'error'); return; }
    if (/googleusercontent\.com/i.test(key)) {
        showToast('זהו מזהה OAuth (Client ID) ולא מפתח API. צור מפתח Gemini ב-aistudio.google.com/apikey.', 'error');
        return;
    }
    if (key.length < 20) {
        showToast('המפתח נראה קצר מדי — ודא שהעתקת אותו במלואו ללא רווחים.', 'error');
        return;
    }
    saveGlobalGeminiKey(key);
    appState.settings.geminiApiKey = key;
    localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
    const status = document.getElementById('admin-key-status');
    if (status) status.style.display = 'block';
    showToast('מפתח API נשמר לכל המשתמשים');
    adminRefreshStatus();
}

function adminSaveServerFolder() {
    const id = (document.getElementById('admin-server-folder-id')?.value || '').trim();
    if (!id) { showToast('הזן Folder ID תחילה', 'error'); return; }
    localStorage.setItem('sj_server_folder_id', id);
    // Clear cached folder IDs so next sync uses the new server folder
    localStorage.removeItem(getStorageKey('sj_sync_folder_id'));
    localStorage.removeItem(getStorageKey('sj_folder_quotes_id'));
    const status = document.getElementById('admin-folder-status');
    if (status) { status.style.display = 'block'; status.textContent = `תיקיית שרת הוגדרה: ${id}`; }
    showToast('תיקיית שרת Drive הוגדרה בהצלחה');
    adminRefreshStatus();
}

function adminRefreshStatus() {
    const keyEl = document.getElementById('admin-status-key');
    const folderEl = document.getElementById('admin-status-folder');
    const driveEl = document.getElementById('admin-status-drive');
    const hasKey = !!getGeminiApiKey();
    const serverFolder = localStorage.getItem('sj_server_folder_id');
    if (keyEl) { keyEl.textContent = hasKey ? 'מוגדר ✓' : 'לא מוגדר'; keyEl.style.color = hasKey ? 'var(--color-success)' : 'var(--color-danger)'; }
    if (folderEl) { folderEl.textContent = serverFolder ? serverFolder.slice(0,20)+'…' : 'לא מוגדר'; folderEl.style.color = serverFolder ? 'var(--color-success)' : '#f0c040'; }
    if (driveEl) { driveEl.textContent = googleAccessToken ? 'מחובר ✓' : 'מנותק'; driveEl.style.color = googleAccessToken ? 'var(--color-success)' : 'var(--color-danger)'; }

    // Pre-fill existing values
    const keyInput = document.getElementById('admin-gemini-key');
    if (keyInput && !keyInput.value) keyInput.value = getGeminiApiKey() || '';
    const folderInput = document.getElementById('admin-server-folder-id');
    if (folderInput && !folderInput.value) folderInput.value = serverFolder || '';
}

function adminRefreshUserList() {
    const container = document.getElementById('admin-users-list');
    if (!container) return;
    const users = JSON.parse(localStorage.getItem('sj_app_users') || '[]');
    if (users.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;">אין משתמשים רשומים.</p>';
        return;
    }
    container.innerHTML = users.map(u => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:var(--bg-input);border-radius:8px;font-size:0.85rem;">
            <span>${u.username}</span>
            <span style="color:var(--text-muted);">${u.profession || '—'}</span>
        </div>
    `).join('');
}

function toggleManualLogin() {
    const sec = document.getElementById('manual-login-section');
    const icon = document.getElementById('manual-toggle-icon');
    if (!sec) return;
    const open = sec.style.display !== 'none';
    sec.style.display = open ? 'none' : 'block';
    if (icon) icon.style.transform = open ? '' : 'rotate(180deg)';
}

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
    const model  = selectedGeminiModel;
    const used   = getWeightedUsage(model);
    const budget = WEIGHTED_DAILY_BUDGET[model] || 100;
    const pct    = Math.min(100, Math.round((used / budget) * 100));
    const offset = MODEL_CIRCUMFERENCE * (1 - pct / 100);

    const arc = document.getElementById('quota-arc');
    if (arc) {
        arc.style.strokeDashoffset = offset;
        arc.style.stroke = pct >= 100 ? '#f05252' : pct >= 75 ? '#f0c040' : 'var(--color-accent)';
    }
    const pctEl = document.getElementById('quota-pct');
    if (pctEl) pctEl.textContent = pct + '%';
    const nameEl = document.getElementById('quota-model-name');
    if (nameEl) nameEl.textContent = (model === 'gemini-2.0-flash' ? 'Flash 2.0' : 'Flash 1.5') + ' · היום';
    // Legacy element (may be absent after redesign) — guard.
    const usedEl = document.getElementById('quota-used');
    if (usedEl) usedEl.textContent = Math.round(used);
}
function changeGeminiModel(model) {
    selectedGeminiModel = model;
    updateQuotaUI();
}

// Weighted "AI engine load": grows with message length and thinking time, so it
// reflects real compute intensity instead of a crude X/30 request counter.
const WEIGHTED_DAILY_BUDGET = { 'gemini-2.0-flash': 100, 'gemini-1.5-flash': 100 };
function computeRequestCost(messageChars, latencyMs) {
    const base = 1.2;
    const lengthFactor = Math.min((messageChars || 0) / 350, 4);  // longer prompts cost more
    const timeFactor   = Math.min((latencyMs || 0) / 1500, 4);    // slower "thinking" costs more
    return base + lengthFactor + timeFactor;                      // ~1.2 .. 9.2 units per request
}
function getWeightedUsage(model) {
    return parseFloat(localStorage.getItem('sj_aiload_' + model + '_' + _todayKey()) || '0');
}
function addWeightedUsage(model, messageChars, latencyMs) {
    const next = getWeightedUsage(model) + computeRequestCost(messageChars, latencyMs);
    localStorage.setItem('sj_aiload_' + model + '_' + _todayKey(), next.toFixed(2));
    updateQuotaUI();
}
function setQuotaCharging(on) {
    const ring = document.getElementById('quota-ring');
    if (ring) ring.classList.toggle('charging', !!on);
}

function getGeminiApiKey() {
    const key = appState.settings.geminiApiKey
        || localStorage.getItem('sj_gemini_key_global')
        || '';
    return (key && key.length > 15 && key !== 'null' && key !== 'undefined') ? key : '';
}
function saveGlobalGeminiKey(key) {
    localStorage.setItem('sj_gemini_key_global', key);
}

// Single entry point for every Gemini call.
// Strategy: try the server proxy first (key stays server-side, works for ALL users
// and on every domain). Only if the proxy isn't deployed / has no key configured
// (501/404) do we fall back to a personal AIza key stored locally.
async function callGemini(model, payload) {
    let proxyRes = null;
    try {
        proxyRes = await fetch('/api/gemini', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model, ...payload })
        });
    } catch (e) {
        proxyRes = null; // network error / local file testing → fall through to personal key
    }
    // If the proxy answered (including a real Google error like 400/403), use it —
    // EXCEPT when it signals "not available / no server key" (404 = not deployed, 501 = no key).
    if (proxyRes && proxyRes.status !== 404 && proxyRes.status !== 501) {
        return proxyRes;
    }

    const personalKey = getGeminiApiKey();
    if (personalKey) {
        return fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${personalKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
    }

    // Neither a server key nor a personal key is configured.
    return new Response(JSON.stringify({
        error: { message: 'שירות ה-AI אינו מוגדר עדיין. הגדר את GEMINI_API_KEY בשרת (Cloudflare Pages), או הזן מפתח אישי בלשונית הגדרות.' }
    }), { status: 503, headers: { 'Content-Type': 'application/json' } });
}

// Turn any failed Gemini/proxy response into a clear Hebrew message.
async function readGeminiError(response) {
    try {
        const data = await response.json();
        if (data && data.error && data.error.message) {
            const m = data.error.message;
            if (/API key not valid|invalid authentication|API_KEY_INVALID|OAuth 2/i.test(m)) {
                return 'מפתח ה-AI אינו תקין. ודא שהוגדר מפתח Gemini תקין (מתחיל ב-AIza) — בשרת או בהגדרות.';
            }
            return m;
        }
    } catch (e) {
        if (response.status === 404) {
            return 'שירות ה-AI אינו זמין כאן (ייתכן שמריצים בבדיקה מקומית ללא שרת). נסה באתר החי.';
        }
        return `שגיאת שרת AI (${response.status}).`;
    }
    return 'שגיאה בתקשורת עם שירות ה-AI.';
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
            name: 'SJ הנדסת חשמל',
            owner: "סתיו ג'אן",
            id: 'עוסק פטור: 207382920',
            phone: '053-530-2887',
            email: 'info@sj-eng.co.il',
            web: 'www.sj-eng.co.il',
            address: 'דרך בן גוריון 138, בת ים, יחידה 1304',
            terms: `תנאי תשלום:
• 50% מקדמה עם אישור הצעת המחיר ותחילת העבודה.
• 50% הנותרים עם מסירת התוכניות הסופיות.

הערות נוספות:
• כל שינוי בתוכניות לאחר שלב האישור הראשוני עשוי לגרור תוספת תשלום.
• ליווי מול חברת החשמל אינו כולל את אגרות הבדיקה של חברת החשמל.`
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
let trashedProjectsList = [];
let activeProjectId = null;

// Global variables for Stern Pricing and Google OAuth
let sternPricingDatabase = [];
let googleTokenClient = null;
let googleAccessToken = null;

// Initialize Application on Page Load
document.addEventListener('DOMContentLoaded', () => {
    // Pre-configure server Drive folder (admin shared folder)
    if (!localStorage.getItem('sj_server_folder_id')) {
        localStorage.setItem('sj_server_folder_id', '1GtFSs9uue5YQrfLOmF1w51KQW-d6Q44E');
    }

    // One-time Gemini key setup via URL: /sale/?key=AIza...
    const _urlParams = new URLSearchParams(window.location.search);
    const _urlKey = _urlParams.get('key');
    if (_urlKey) {
        saveGlobalGeminiKey(_urlKey);
        history.replaceState({}, '', window.location.pathname);
        showToast('מפתח Gemini הוגדר בהצלחה');
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

    document.getElementById('form-quote-date').value = getTodayDateString();
    switchTab('projects');
    updateUserProfileUI();
    showAdminTabIfNeeded();
    if (isAdmin()) {
        setTimeout(() => { adminRefreshStatus(); adminRefreshUserList(); }, 300);
    }
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
        showToast('אנא בחר או צור פרויקט תחילה בלשונית ניהול פרויקטים', 'error');
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
        try { projectsList = JSON.parse(saved); } catch (e) { projectsList = []; }
    } else { projectsList = []; }
    const savedTrash = localStorage.getItem(getStorageKey('sj_trash_projects'));
    if (savedTrash) {
        try { trashedProjectsList = JSON.parse(savedTrash); } catch (e) { trashedProjectsList = []; }
    } else { trashedProjectsList = []; }
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
    localStorage.setItem(getStorageKey('sj_trash_projects'), JSON.stringify(trashedProjectsList));
    localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
    syncDatabaseToDrive(true);
}

function createNewProject() {
    const input = document.getElementById('new-project-name');
    const name = input.value.trim();
    if (!name) {
        showToast('אנא הזן שם פרויקט/לקוח', 'error');
        return;
    }
    
    const newProj = {
        id: 'proj_' + Date.now(),
        name: name,
        created: getTodayDateString(),
        status: 'טיוטה',
        chatHistory: [
            {
                role: 'model',
                parts: [{ text: `שלום! אני סוכן ה-AI המומחה שלך לניהול עבודות חשמל ועריכת הצעות מחיר.\nתאר לי את העבודה שאתה רוצה לתמחר (למשל: "התקנת עמדת טעינה במרחק 15 מטר מהלוח"), ואני אעזור לך לחשב עלויות, לאתר חומרים נדרשים, להשוות מחירים בשוק ולזהות נקודות עיוורון.` }]
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
                { title: 'פרק א\': עבודות הכנה', description: 'ביצוע עבודות הכנה והתארגנות בשטח.', price: 0 }
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
    showToast(`פרויקט "${name}" נוצר בהצלחה`);
    switchTab('wizard'); // Auto switch to pricing chat
}

function loadProject(id, navigate = true) {
    const proj = projectsList.find(p => p.id === id);
    if (!proj) return;
    
    activeProjectId = id;
    localStorage.setItem(getStorageKey('sj_active_project_id'), id);

    // Reset model to default each time a project is loaded
    changeGeminiModel('gemini-2.0-flash');
    const modelSel = document.getElementById('gemini-model-select');
    if (modelSel) modelSel.value = 'gemini-2.0-flash';

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
        showToast(`פרויקט "${proj.name}" נטען בהצלחה`);
    }
}

function deleteProject(id, event) {
    if (event) event.stopPropagation();
    const proj = projectsList.find(p => p.id === id);
    if (!proj) return;
    if (!confirm(`העברת "${proj.name}" לסל המחזור — ניתן לשחזר מהגדרות Drive.`)) return;

    projectsList = projectsList.filter(p => p.id !== id);
    trashedProjectsList.push({ ...proj, _deletedAt: new Date().toISOString() });
    saveProjects();
    filterProjectsList();

    if (activeProjectId === id) {
        activeProjectId = null;
        localStorage.removeItem(getStorageKey('sj_active_project_id'));
        updateActiveProjectBanner(null);
        initNewQuote();
        switchTab('projects');
    }
    showToast('הפרויקט הועבר לסל המחזור');
}

function updateActiveProjectBanner(proj) {
    const bannerName = document.getElementById('active-project-name');
    const bannerStatus = document.getElementById('active-project-status');
    
    if (proj) {
        bannerName.textContent = proj.name;
        bannerStatus.textContent = proj.status || 'טיוטה';
        bannerStatus.style.display = 'inline-block';
    } else {
        bannerName.textContent = 'אין פרויקט פעיל (בחר או צור פרויקט תחילה)';
        bannerStatus.style.display = 'none';
    }
}

function filterProjectsList() {
    const q = (document.getElementById('project-search-q')?.value || '').trim().toLowerCase();
    const sort = document.getElementById('project-sort')?.value || 'newest';
    const statusFilter = document.getElementById('project-status-filter')?.value || 'all';

    let filtered = projectsList.slice();

    if (q) filtered = filtered.filter(p => p.name.toLowerCase().includes(q));
    if (statusFilter !== 'all') filtered = filtered.filter(p => (p.status || 'טיוטה') === statusFilter);

    if (sort === 'newest')    filtered.sort((a, b) => new Date(b.created) - new Date(a.created));
    else if (sort === 'oldest')   filtered.sort((a, b) => new Date(a.created) - new Date(b.created));
    else if (sort === 'name-asc') filtered.sort((a, b) => a.name.localeCompare(b.name, 'he'));
    else if (sort === 'name-desc') filtered.sort((a, b) => b.name.localeCompare(a.name, 'he'));

    renderProjectsList(filtered);
}

function cycleProjectStatus(projectId, e) {
    e.stopPropagation();
    const statuses = ['טיוטה', 'נשלח', 'הושלם'];
    const proj = projectsList.find(p => p.id === projectId);
    if (!proj) return;
    const idx = statuses.indexOf(proj.status || 'טיוטה');
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
        container.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:40px;">אין פרויקטים פעילים. צור פרויקט חדש מימין.</div>`;
        return;
    }
    if (list.length === 0) {
        container.innerHTML = `<div style="color:var(--text-muted); text-align:center; padding:40px;">לא נמצאו פרויקטים התואמים לחיפוש.</div>`;
        return;
    }

    list.forEach(p => {
        const isActive = p.id === activeProjectId;
        const status = p.status || 'טיוטה';
        const card = document.createElement('div');
        card.className = `project-card ${isActive ? 'active' : ''}`;
        card.onclick = () => loadProject(p.id);

        card.innerHTML = `
            <div class="project-info">
                <div class="project-title" style="display:flex; align-items:center; gap:8px;">
                    ${p.name}
                    <span class="project-status-badge status-badge-${status}"
                          onclick="cycleProjectStatus('${p.id}', event)"
                          title="לחץ לשינוי סטטוס">${status}</span>
                </div>
                <div class="project-meta">
                    <span><i class="fa-solid fa-calendar"></i> ${formatHebrewDate(p.created)}</span>
                </div>
            </div>
            <div class="project-actions">
                <button class="btn btn-secondary btn-small" onclick="loadProject('${p.id}', true)">
                    <i class="fa-solid fa-folder-open"></i> טען
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
    showToast('הגדרות העסק נשמרו בהצלחה');
    
    updatePreviewFromForm();
    syncCurrentQuoteToProject();
    syncDatabaseToDrive(true);
}

function saveGeminiKey() {
    const key = document.getElementById('settings-gemini-key').value.trim();
    appState.settings.geminiApiKey = key;
    saveGlobalGeminiKey(key); // שמור גלובלית — כל המשתמשים משתמשים במפתח הזה
    localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
    localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
    syncDatabaseToDrive(true);
    showToast('מפתח API נשמר בהצלחה');
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
            { title: 'פרק א\': עבודות הכנה', description: 'ביצוע עבודות הכנה והתארגנות בשטח.', price: 0 }
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
                <input type="text" class="item-title-input" placeholder="נושא הסעיף (למשל: חיווט כבלי תקשורת)" value="${title}" oninput="updatePreviewFromForm()">
            </div>
            <div class="form-group" style="margin-bottom:0">
                <textarea class="item-desc-input" rows="2" placeholder="פירוט תכולת העבודה..." oninput="updatePreviewFromForm()">${description}</textarea>
            </div>
            ${isItemized ? `
            <div class="form-group" style="margin-bottom:0">
                <input type="number" class="item-price-input" placeholder="מחיר" value="${price || ''}" oninput="calculateItemizedTotal()">
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
        showToast('חובה להשאיר לפחות סעיף עבודה אחד בהצעת המחיר', 'error');
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
    let vatLabel = 'פטור ממע"מ (עוסק פטור)';
    
    if (vatType === 'exclude') {
        finalPrice = basePrice * 1.17;
        vatLabel = 'לא כולל מע"מ (נוסף 17% מע"מ)';
    } else if (vatType === 'include') {
        vatLabel = 'כולל מע"מ (בשיעור 17%)';
    }
    
    const roundedPrice = Number(finalPrice.toFixed(2));
    
    document.getElementById('form-final-price').value = formatPriceString(roundedPrice) + ' ש"ח';
    document.getElementById('pdf-total-price').textContent = formatPriceString(roundedPrice) + ' ש"ח';
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
    
    const clientName = document.getElementById('form-client-name').value || 'שם הלקוח';
    const clientSub = document.getElementById('form-client-sub').value || 'כתובת הלקוח / טלפון';
    const quoteNumber = document.getElementById('form-quote-number').value || '2026-101';
    const quoteDate = document.getElementById('form-quote-date').value;
    const subject = document.getElementById('form-quote-subject').value || 'נושא הצעה';
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
                <span>אימייל: ${biz.email}</span>
                <span class="bullet">|</span>
                <span>סלולרי: ${biz.phone}</span>
                <span class="bullet">|</span>
                <span>אתר: ${biz.web}</span>
            </div>
            <div class="footer-row text-secondary">
                <span>כתובת: ${biz.address}</span>
            </div>
            <div class="footer-notice">
                הצעת מחיר זו תקפה לשלושה חודשים. עם אישור וחתימת הלקוח תשמש כהסכם לביצוע העבודה בהתאם לאמור בה.
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
                    <th style="width: 8%; text-align: center;">סעיף</th>
                    <th style="width: 72%;">תיאור ותכולת העבודה</th>
                    <th style="width: 20%; text-align: left;">מחיר (₪)</th>
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
                    <div style="font-weight: 700; color: var(--pdf-primary); text-decoration: underline; margin-bottom: 4px;">${item.title || 'סעיף ללא כותרת'}</div>
                    <div style="white-space: pre-line; line-height: 1.5; color: var(--pdf-text-main); font-size: 0.9rem;">${item.description || 'אין פירוט לסעיף זה'}</div>
                </td>
                <td style="font-family: 'Outfit', 'Rubik', sans-serif; font-weight: 700; text-align: left; color: var(--pdf-primary);">${formatPriceString(item.price || 0)} ₪</td>
            `;
            tbody.appendChild(tr);
        });
        pdfItemsContainer.appendChild(table);
    } else {
        itemsList.forEach((item, idx) => {
            const itemEl = document.createElement('div');
            itemEl.className = 'pdf-work-item';
            itemEl.innerHTML = `
                <div class="pdf-item-title">${idx + 1}. ${item.title || 'סעיף ללא כותרת'}</div>
                <div class="pdf-item-desc">${item.description || 'אין פירוט לסעיף זה'}</div>
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
// Gemini Pricing Chat (סוכן תמחור מומחה)
// ==========================================================================
async function sendChatMessage() {
    if (!activeProjectId) {
        showToast('אנא בחר או צור פרויקט תחילה בלשונית ניהול פרויקטים', 'error');
        switchTab('projects');
        return;
    }
    
    const effectiveModel = getEffectiveModel();
    if (!effectiveModel) {
        showToast('המכסה היומית נוצלה עבור שני המודלים. נסה שוב מחר.', 'error');
        return;
    }
    if (effectiveModel !== selectedGeminiModel) {
        showToast(`מכסת Flash 2.0 נוצלה — עובר אוטומטית ל-Flash 1.5`, 'error');
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

    const _t0 = performance.now();
    setQuotaCharging(true);
    try {
        const response = await callGemini(effectiveModel, {
            systemInstruction: { parts: [{ text: systemInstructionText }] },
            contents: activeProject.chatHistory
        });

        if (!response.ok) {
            throw new Error(await readGeminiError(response));
        }

        incrementDailyUsage(effectiveModel);
        addWeightedUsage(effectiveModel, userText.length, performance.now() - _t0);
        setQuotaCharging(false);

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
                        tipsBox.innerHTML = `<strong>נקודות עיוורון שכדאי לבדוק:</strong><ul>` + parsed.blindSpots.map(s => `<li>${s}</li>`).join('') + `</ul>`;
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
        setQuotaCharging(false);
        showToast('אירעה שגיאה בצ\'אט: ' + err.message, 'error');
    }
}

function sendSuggestedChatPrompt(text) {
    const input = document.getElementById('chat-user-input');
    if (input) {
        input.value = text;
        sendChatMessage();
    }
}

// "Generate full materials list" — asks the AI for an exhaustive, itemized list
// (including the smallest accessories) based on the conversation so far. Reuses the
// chat pipeline, so the returned JSON auto-populates the materials checklist + labor price.
function generateMaterialsList() {
    if (!activeProjectId) {
        showToast('אנא בחר או צור פרויקט תחילה כדי לבנות רשימת חומרים', 'error');
        switchTab('projects');
        return;
    }
    const activeProject = projectsList.find(p => p.id === activeProjectId);
    if (!activeProject || !activeProject.chatHistory || activeProject.chatHistory.length === 0) {
        showToast('תאר תחילה את העבודה בצ\'אט, ואז אבנה רשימת חומרים מלאה', 'error');
        return;
    }
    const prompt = 'בהתבסס על כל מה שתואר עד כה בשיחה, צור עכשיו רשימת חומרים ואביזרים מלאה ומפורטת לפרויקט הזה — כולל כל הפריטים הקטנים שקל לשכוח (דיבלים, ברגים, מהדקים, סופיות כבל, שרוולים, סרט בידוד, קופסאות הסתעפות, מובילים ותעלות, נעלי כבל, מפסקים אוטומטיים זעירים, צינורות הגנה ועוד). לכל פריט ציין שם, כמות או פירוט, ומחיר רכש משוער בשקלים. אל תשמיט פריטים — עדיף לכלול יותר מדי מאשר לפספס אביזר. סיים בגוש JSON מעודכן כרגיל כדי שרשימת החומרים תתעדכן אוטומטית.';
    sendSuggestedChatPrompt(prompt);
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
        container.innerHTML = `<div style="color:var(--text-muted); font-size:0.85rem; text-align:center; padding:20px;">אין חומרים באומדן. התחל שיחה עם ה-AI כדי לפרק עבודה לחומרים.</div>`;
        return;
    }
    
    materials.forEach((mat, idx) => {
        const row = document.createElement('div');
        row.className = 'material-check-row';
        row.innerHTML = `
            <input type="checkbox" id="mat-chk-${idx}" ${mat.checked ? 'checked' : ''} onchange="toggleMaterialChecked(${idx}, this.checked)">
            <div class="material-check-text">
                <span class="material-item-name">${mat.name}</span>
                <span class="material-item-details">(${mat.details}) - <b style="color:var(--color-success)">${mat.price} ₪</b></span>
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
// Gemini Phrasing Agent (סוכן ניסוח הצעת מחיר)
// ==========================================================================
async function exportChatToQuote() {
    if (!activeProjectId) {
        showToast('אין פרויקט פעיל לייצוא', 'error');
        return;
    }
    
    const proj = projectsList.find(p => p.id === activeProjectId);
    if (!proj) return;
    
    const effectiveModel = getEffectiveModel();
    if (!effectiveModel) {
        showToast('המכסה היומית נוצלה עבור שני המודלים. נסה שוב מחר.', 'error');
        return;
    }

    const btn = document.getElementById('btn-export-to-quote');
    const origText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> מנסח הצעת מחיר...`;
    
    // Format conversation history
    const conversationText = proj.chatHistory.map(msg => {
        const senderName = msg.role === 'user' ? 'סתיו' : 'מומחה תמחור';
        let text = msg.parts[0].text.replace(/```json\s*[\s\S]*?\s*```/, '').trim();
        text = text.replace(/({[\s\S]*?})/, '').trim();
        return `${senderName}: ${text}`;
    }).join('\n\n');
    
    // Checked materials list
    const checkedMats = (proj.materials || []).filter(m => m.checked);
    const checkedMatsText = checkedMats.map(m => `• ${m.name} (${m.details}) - ${m.price} ₪`).join('\n');
    const materialsCost = checkedMats.reduce((sum, m) => sum + m.price, 0);
    const estimatedCost = (proj.laborPrice || 0) + materialsCost;
    
    const phrasingDb = appState.settings.phrasingDb || '';
    
    const prompt = `
אתה סוכן הניסוח (Quote Writer) המומחה של סתיו ג'אן - SJ הנדסת חשמל.
תפקידך לתרגם את שיחת התמחור ואומדן החומרים להצעת מחיר רשמית, מנוסחת היטב בעברית מקצועית ומשפטית.

עליך להשתמש ב"מאגר הניסוחים" של סתיו כמודל ודוגמה לסגנון הכתיבה והמבנה של הצעת המחיר.
הנה מאגר הניסוחים של סתיו ללמידת סגנון הכתיבה:
"""
${phrasingDb}
"""

הנה סיכום שיחת התמחור שנערכה זה עתה:
"""
${conversationText}
"""

והנה רשימת החומרים והמחירים שנבחרו:
"""
מחיר עבודה מוערך: ${proj.laborPrice || 0} ש"ח
חומרים שנבחרו:
${checkedMatsText}
"""

משימתך היא להפיק קובץ JSON מובנה המפרט את סעיפי הצעת המחיר הסופיים. 
כל סעיף צריך לכלול כותרת ותיאור מורחב ומקצועי (בעברית רשמית ותקנית, המזכירה את סגנון הניסוחים במאגר).
אם יש מספר עבודות או שלבים שונים, פצל אותם ל-2-4 סעיפים נפרדים (למשל: סעיף הכנות וכבילה, סעיף אביזרים והתקנות).
לכל סעיף קבע מחיר משוער הגיוני שסכומו הכללי (או מחיר הבסיס) ישקף את עלות העבודה והחומרים המצטברים (שסכומם כרגע הוא ${estimatedCost} ש"ח).

הפלט שלך חייב להיות אך ורק JSON במבנה הבא, ללא שום טקסט נוסף לפניו או אחריו:
{
  "subject": "נושא הצעת המחיר (למשל: התקנת עמדת טעינה לרכב חשמלי)",
  "items": [
    {
      "title": "כותרת הסעיף (למשל: פרק א': עבודות הכנה והנחת כבלים)",
      "description": "פירוט של העבודה ותכולתה ברמה מקצועית גבוהה...",
      "price": 1200
    }
  ],
  "basePrice": 3500, // מחיר כולל מומלץ (שווה לסכום מחירי הסעיפים)
  "summary": "הערות ספציפיות לעבודה זו שיש לכלול בנוסף לתנאים הכלליים (תנאי תשלום וכו')."
}
`;

    const _t0 = performance.now();
    setQuotaCharging(true);
    try {
        const response = await callGemini(effectiveModel, {
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: "application/json" }
        });

        if (!response.ok) {
            throw new Error(await readGeminiError(response));
        }

        incrementDailyUsage(effectiveModel);
        addWeightedUsage(effectiveModel, prompt.length, performance.now() - _t0);
        setQuotaCharging(false);

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
        showToast('סוכן הניסוח הפיק את הצעת המחיר המלאה בהצלחה!');
    } catch (err) {
        console.error(err);
        showToast('שגיאה בניסוח על ידי AI: ' + err.message, 'error');
    } finally {
        setQuotaCharging(false);
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
            showToast('לוגו העסק עודכן בהצלחה');
        } else if (type === 'bg') {
            localStorage.setItem(getStorageKey('sj_uploaded_bg'), base64Data);
            appState.settings.uploadedBg = base64Data;
            localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
            localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
            renderWatermark(base64Data);
            syncDatabaseToDrive(true);
            showToast('תמונת רקע עודכנה בהצלחה');
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
        showToast('לוגו החברה הוחזר לברירת המחדל');
    } else if (type === 'bg') {
        localStorage.removeItem(getStorageKey('sj_uploaded_bg'));
        appState.settings.uploadedBg = null;
        localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));
        localStorage.setItem(getStorageKey('sj_db_last_updated'), Date.now().toString());
        renderWatermark(null);
        syncDatabaseToDrive(true);
        showToast('תמונת הרקע הוסרה');
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
        container.innerHTML = `<img src="${base64Data}" alt="לוגו עסק">`;
        settingsPreview.innerHTML = `<img src="${base64Data}" style="max-height:100%; max-width:100%;">`;
    } else {
        container.innerHTML = `
            <svg viewBox="0 0 100 100" class="pdf-logo-svg" id="fallback-logo">
                <circle cx="50" cy="50" r="46" fill="#0f172a" stroke="#3b82f6" stroke-width="3" />
                <path d="M 32 40 C 32 28, 68 28, 68 40 C 68 52, 32 48, 32 60 C 32 72, 68 72, 68 60" fill="none" stroke="#60a5fa" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
                <path d="M 58 46 L 58 70 C 58 80, 32 80, 32 70" fill="none" stroke="#3b82f6" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        `;
        settingsPreview.innerHTML = '<span style="color:var(--text-muted); font-size:0.8rem;">ברירת מחדל</span>';
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
        settingsPreview.innerHTML = '<span style="color:var(--text-muted); font-size:0.8rem;">אין תמונת רקע</span>';
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
        list.innerHTML = '<div style="color:var(--text-muted); padding:20px; text-align:center;">לא נמצאו תוצאות התואמות לחיפוש.</div>';
        return;
    }
    
    items.forEach((item, index) => {
        const card = document.createElement('div');
        card.className = 'stern-result-card';
        card.innerHTML = `
            <div class="stern-card-info">
                <div class="stern-card-desc">${item.description}</div>
                <div class="stern-card-unit">${item.unit ? 'פירוט/יחידה: ' + item.unit : ''}</div>
            </div>
            <div class="stern-card-action">
                <div class="stern-card-price">${formatPriceString(item.price)} ₪</div>
                <button class="btn btn-accent btn-small" onclick="addSternItemToQuote(${index})">
                    <i class="fa-solid fa-plus"></i> הוסף
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
    showToast(`נוסף סעיף: "${item.description.substring(0, 30)}..." במחיר ${item.price} ש"ח`);
}

// ==========================================================================
// PDF Generation & Download
// ==========================================================================
function downloadPDF() {
    const clientName = document.getElementById('form-client-name').value.trim() || 'לקוח';
    const subject = document.getElementById('form-quote-subject').value.trim() || 'הצעת מחיר';
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
    const filename = `הצעת מחיר_${quoteNumber}_${clientName.replace(/\s+/g, '_')}.pdf`;
    
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
    
    showToast('מכין קובץ PDF להורדה...');
    
    return html2pdf().set(options).from(element).save()
        .then(() => {
            showToast('קובץ PDF הורד בהצלחה');
            saveToHistory(false);
        })
        .catch(err => {
            console.error('PDF error:', err);
            showToast('שגיאה ביצירת קובץ ה-PDF', 'error');
        });
}

function shareWhatsApp() {
    const clientName = document.getElementById('form-client-name').value.trim();
    const subject = document.getElementById('form-quote-subject').value.trim();
    const finalPrice = document.getElementById('form-final-price').value;
    const vatType = document.getElementById('form-vat-type').value;
    
    let vatLabel = 'פטור ממע"מ';
    if (vatType === 'exclude') vatLabel = 'לא כולל מע"מ';
    if (vatType === 'include') vatLabel = 'כולל מע"מ';
    
    if (!clientName || !subject) {
        showToast('אנא מלא שם לקוח ונושא כדי להפיק הודעה', 'error');
        return;
    }
    
    const msg = `שלום ${clientName},\n\nהפקתי עבורך הצעת מחיר מפורטת בנושא: *${subject}*.\nסה"כ לתשלום: *${finalPrice}* (${vatLabel}).\n\nשלחתי לך את קובץ ה-PDF המפורט במייל. אשמח לעבור עליו יחד איתך.\n\nבברכה,\n*סתיו ג'אן - SJ הנדסת חשמל*`;
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
        if (showToastFlag) showToast('חובה להזין שם לקוח ונושא לפני השמירה', 'error');
        return;
    }
    
    if (q.id && q.id.startsWith('proj_') === false) { // it is a local history item, not a project ID
        const idx = appState.history.findIndex(item => item.id === q.id);
        if (idx !== -1) {
            appState.history[idx] = JSON.parse(JSON.stringify(q));
            if (showToastFlag) showToast('הצעת המחיר עודכנה בהיסטוריה');
        }
    } else {
        q.id = 'hist_' + Date.now().toString();
        appState.history.unshift(JSON.parse(JSON.stringify(q)));
        if (showToastFlag) showToast('הצעת המחיר נשמרה בהיסטוריה');
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
    showToast(`הצעת מחיר מס' ${quote.quoteNumber} נטענה לעריכה`);
}

function deleteQuoteFromHistory(id, event) {
    if (event) event.stopPropagation();
    
    if (!confirm('האם אתה בטוח שברצונך למחוק הצעת מחיר זו לצמיתות?')) {
        return;
    }
    
    appState.history = appState.history.filter(item => item.id !== id);
    saveHistory();
    renderHistoryList();
    showToast('הצעת המחיר נמחקה בהצלחה');
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
        
        let vatText = 'פטור';
        if (q.vatType === 'exclude') vatText = '+ מע"מ';
        if (q.vatType === 'include') vatText = 'כולל מע"מ';
        
        row.innerHTML = `
            <td style="font-family: 'Outfit', sans-serif; font-weight:700;">${q.quoteNumber}</td>
            <td style="font-family: 'Outfit', sans-serif;">${formatHebrewDate(q.date)}</td>
            <td style="font-weight:600; color: var(--color-accent);">${q.clientName}</td>
            <td>${q.subject}</td>
            <td style="font-family: 'Outfit', 'Rubik', sans-serif; font-weight:600;">${formatPriceString(q.finalPrice)} ש"ח <span style="font-size:0.75rem; color:var(--text-muted);">${vatText}</span></td>
            <td><span class="badge active">שמור</span></td>
            <td class="actions-cell">
                <button class="btn btn-secondary btn-small" onclick="loadQuoteFromHistory('${q.id}')">
                    <i class="fa-solid fa-pen"></i> ערוך
                </button>
                <button class="btn btn-danger btn-small" onclick="deleteQuoteFromHistory('${q.id}', event)">
                    <i class="fa-solid fa-trash-can"></i> מחק
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
            emptyState.querySelector('p').textContent = 'לא נמצאו הצעות מחיר התואמות לחיפוש.';
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
    downloadAnchor.setAttribute("download", `גיבוי_הצעות_מחיר_SJ_${getTodayDateString()}.json`);
    document.body.appendChild(downloadAnchor);
    downloadAnchor.click();
    downloadAnchor.remove();
    
    showToast('נתוני המערכת יוצאו לקובץ גיבוי בהצלחה');
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
                if (confirm(`נמצאו ${imported.history.length} הצעות מחיר בקובץ. האם ברצונך לייבא?`)) {
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
                    showToast('הנתונים יובאו בהצלחה');
                }
            } else {
                showToast('קובץ גיבוי לא תקין', 'error');
            }
        } catch (err) {
            showToast('שגיאה בפענוח קובץ הגיבוי', 'error');
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
        statusLabel.innerHTML = '<i class="fa-solid fa-circle-dot"></i> מחובר ל-Google Drive';
        btn.textContent = 'החלף חשבון / התחבר מחדש';
        if (syncSection) syncSection.style.display = 'flex';
        loadDriveFoldersList();
    } else {
        statusLabel.className = 'status-disconnected';
        statusLabel.innerHTML = '<i class="fa-solid fa-circle-dot"></i> מנותק';
        btn.textContent = 'גבה את עבודתך ע"י יצירת תיקיית הצעות מחיר ב-DRIVE של גוגל';
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
            <i class="fa-solid fa-file-pdf"></i> קובצי PDF יישמרו בתיקייה הנבחרת<br>
            <i class="fa-solid fa-database"></i> גיבוי וסנכרון נתונים: <strong>תיקיית מערכת מוסתרת (.sysdata)</strong>
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
        showToast('אנא הזן Google Client ID בהגדרות תחילה', 'error');
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
                    showToast('שגיאה בחיבור לגוגל דרייב: ' + response.error, 'error');
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
                showToast('התחברת ל-Google Drive בהצלחה!');
                
                try {
                    showToast('מזהה ומסנכרן את תיקיית הענן של SJ הנדסת חשמל...');
                    await resolveSjDriveFolders();
                    autoDetectQuoteNumber(false);
                    syncDatabaseFromDrive(false); // Cloud sync
                } catch (folderErr) {
                    showToast('שגיאה ביצירת נתיב התיקיות בדרייב: ' + folderErr.message, 'error');
                }
            },
        });
        
        googleTokenClient.requestAccessToken({ prompt: '' });
    } catch (e) {
        console.error(e);
        showToast('שגיאה באתחול Google OAuth: ודא שה-Client ID תקין', 'error');
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
        throw new Error(`חיפוש תיקייה '${name}' נכשל: ${errText}`);
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

function _userFolderName() {
    const u = (getActiveUser() || 'user').split('@')[0];
    return u.replace(/[^a-zA-Z0-9֐-׿._-]/g, '_').slice(0, 60);
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
                        <i class="fa-solid fa-circle-check" style="color: var(--color-success)"></i> תיקיות פעילות בדרייב:<br>
                        <i class="fa-solid fa-file-pdf" style="margin-right: 15px;"></i> מזהה תיקיית PDF: <strong>${quotesId}</strong><br>
                        <i class="fa-solid fa-database" style="margin-right: 15px;"></i> מזהה תיקיית דאטא: <strong>${dataId}</strong>
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
        const serverFolderId = localStorage.getItem('sj_server_folder_id');
        const username = _userFolderName();
        let qId;

        if (serverFolderId) {
            qId = await findOrCreateFolder(username, serverFolderId);
            if (!qId) throw new Error('שגיאה ביצירת תת-תיקיית משתמש בשרת');
        } else {
            const skillsId = await findOrCreateFolder('SKILLS', 'root');
            if (!skillsId) throw new Error('שגיאה ביצירת תיקיית SKILLS');
            const saleId = await findOrCreateFolder('SJ-SALE-WEBSITE', skillsId);
            if (!saleId) throw new Error('שגיאה ביצירת תיקיית SJ-SALE-WEBSITE');
            qId = await findOrCreateFolder(username, saleId);
            if (!qId) throw new Error('שגיאה ביצירת תת-תיקיית משתמש');
        }

        const dId = await findOrCreateFolder('.sysdata', qId);
        if (!dId) throw new Error('שגיאה ביצירת תיקיית .sysdata');

        localStorage.setItem(getStorageKey('sj_folder_quotes_id'), qId);
        localStorage.setItem(getStorageKey('sj_folder_data_id'), dId);
        localStorage.setItem(getStorageKey('sj_sync_folder_id'), dId);

        appState.settings.googleFolderId = qId;
        localStorage.setItem(getStorageKey('sj_quote_settings'), JSON.stringify(appState.settings));

        const pathStatus = document.getElementById('drive-folder-path-status');
        if (pathStatus) {
            const path = serverFolderId
                ? 'שרת/' + username + '/'
                : 'SKILLS/SJ-SALE-WEBSITE/' + username + '/';
            pathStatus.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--color-success)"></i> Drive: <strong>' + path + '</strong>';
        }

        return { quotes: qId, data: dId };
    } catch (e) {
        console.error('Failed to resolve Drive folders:', e);
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
    if (!googleAccessToken) { showToast('יש להתחבר לגוגל תחילה', 'error'); return; }
    showToast('סורק תיקיית Drive לנתונים ישנים...');
    try {
        const syncFolderId = await getOrCreateSyncFolder();
        if (!syncFolderId) { showToast('לא נמצאה תיקיית Drive', 'error'); return; }
        const recovered = await scanForLegacyData(syncFolderId);
        if (!recovered) { showToast('לא נמצאו נתונים ישנים בתיקייה', 'error'); return; }
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
        showToast('נתונים ישנים יובאו בהצלחה!');
    } catch (e) {
        showToast('שגיאה בסריקה: ' + e.message, 'error');
    }
}

// Google Drive Picker — lets user browse and pick any folder
function openDrivePicker() {
    if (!googleAccessToken) {
        showToast('יש לחבר Google Drive תחילה — לחץ "חבר Drive" בהגדרות', 'error');
        return;
    }
    if (typeof gapi === 'undefined' || typeof google === 'undefined') {
        showToast('ממתין לטעינת Google API... נסה שוב בעוד שנייה', 'error');
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
                    .setTitle('בחר תיקייה לשמירת הצעות מחיר')
                    .addView(folderView)
                    .setOAuthToken(googleAccessToken)
                    .setCallback(async (pickerData) => {
                        if (pickerData.action === google.picker.Action.PICKED) {
                            const folder = pickerData.docs[0];
                            showToast(`תיקייה נבחרה: ${folder.name}`);
                            await handleDriveFolderChange(folder.id);
                        }
                    })
                    .build();
                picker.setVisible(true);
            } catch (innerErr) {
                showToast('שגיאה בפתיחת בוחר התיקיות — יש לחבר מחדש ל-Drive', 'error');
            }
        });
    } catch (e) {
        showToast('שגיאה בטעינת Google Picker — יש לחבר מחדש ל-Drive', 'error');
    }
}

async function smartSyncFromDrive() {
    if (!googleAccessToken) {
        showToast('יש לחבר Google Drive תחילה', 'error');
        return;
    }
    setSyncLoading(true);
    try {
        // Step 1: try regular sync file
        await manualSyncFromCloud();
        // Step 2: if still no projects, try backup recovery
        if (projectsList.length === 0) {
            showToast('לא נמצא קובץ סנכרון — מחפש גיבויים...', 'error');
            await recoverDriveBackup();
        }
        // Step 3: if still nothing, scan for legacy data
        if (projectsList.length === 0) {
            showToast('מחפש נתונים ישנים בתיקייה...', 'error');
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
                    if (cloudData.trash) {
                        trashedProjectsList = cloudData.trash;
                        localStorage.setItem(getStorageKey('sj_trash_projects'), JSON.stringify(trashedProjectsList));
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
                        showToast('נתוני האפליקציה סונכרנו מהענן בהצלחה!');
                    }
                } else if (localTimestamp > cloudTimestamp) {
                    await syncDatabaseToDrive(true);
                } else {
                    if (!silent) showToast('הנתונים בענן כבר מעודכנים');
                }
            }
        } else {
            // No sync file found — try to recover old JSON files before first write
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
                if (!silent) showToast('שוחזרו נתונים ישנים מהדרייב!');
            }
            await syncDatabaseToDrive(true);
        }
    } catch (e) {
        console.error('Error syncing from cloud:', e);
        if (!silent) showToast('שגיאה בסנכרון מהענן: ' + e.message, 'error');
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
            trash: trashedProjectsList,
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
            showToast('נתוני האפליקציה נשמרו וסונכרנו לענן בהצלחה!');
        }
    } catch (e) {
        console.error('Error syncing to cloud:', e);
        if (!silent) showToast('שגיאה בשמירה לענן: ' + e.message, 'error');
    } finally {
        setSyncLoading(false);
    }
}

function manualSyncFromCloud() {
    showToast('מבצע סנכרון ענן ידני...');
    syncDatabaseFromDrive(false);
}

async function autoDetectQuoteNumber(showAlerts = false) {
    if (!googleAccessToken) {
        if (showAlerts) showToast('גוגל דרייב אינו מחובר. אנא התחבר דרך הגדרות מערכת', 'error');
        return;
    }
    
    if (showAlerts) {
        showToast('סורק קבצים בדרייב לקביעת מספר הצעה...');
    }
    
    try {
        const folders = await resolveSjDriveFolders();
        if (!folders || !folders.quotes) {
            if (showAlerts) showToast('שגיאה בגישה לתיקיית הצעות מחיר בדרייב', 'error');
            return;
        }
        const folderId = folders.quotes;
        
        const q = `'${folderId}' in parents and trashed = false`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=files(id,name)&access_token=${googleAccessToken}`);
        
        if (!res.ok) {
            if (res.status === 401) {
                clearDriveSession();
                if (showAlerts) showToast('פג תוקף החיבור לגוגל דרייב. אנא התחבר מחדש בהגדרות', 'error');
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
        
        showToast(`זוהה מספר הצעה הבא מתוך הדרייב: ${finalQuoteStr}`);
    } catch (e) {
        console.error(e);
        if (showAlerts) showToast('שגיאה בסריקת הדרייב', 'error');
    }
}

function uploadPDFToDrive() {
    const clientName = document.getElementById('form-client-name').value.trim() || 'לקוח';
    const subject = document.getElementById('form-quote-subject').value.trim() || 'הצעת מחיר';
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
        showToast('אנא חבר את Google Drive דרך הגדרות מערכת תחילה', 'error');
        switchTab('settings');
        return;
    }
    
    const element = document.getElementById('quote-pdf-sheet');
    const filename = `הצעת מחיר_${quoteNumber}_${clientName.replace(/\s+/g, '_')}.pdf`;
    
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
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> שמירה בדרייב...`;
    
    showToast('מפיק PDF ומעלה ל-Google Drive...');
    
    html2pdf().set(options).from(element).toPdf().output('blob')
        .then(async (blob) => {
            try {
                const folders = await resolveSjDriveFolders();
                if (!folders || !folders.quotes) {
                    throw new Error('לא ניתן למצוא או ליצור את תיקיית היעד בדרייב');
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
                    showToast('נמצא קובץ קיים בדרייב. מעדכן גרסה...');
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
                        throw new Error('פג תוקף החיבור לגוגל דרייב. אנא התחבר מחדש בהגדרות');
                    }
                    throw new Error('Drive API Upload failed');
                }
                
                if (existingFileId) {
                    showToast('הקובץ עודכן בדרייב בהצלחה!');
                } else {
                    showToast('הקובץ נשמר בדרייב בהצלחה!');
                }
                saveToHistory(false);
            } catch (err) {
                console.error(err);
                showToast('שגיאה בשמירה לדרייב: ' + err.message, 'error');
            } finally {
                btn.disabled = false;
                btn.innerHTML = originalText;
            }
        })
        .catch(err => {
            console.error('PDF error:', err);
            showToast('שגיאה בהפקת קובץ ה-PDF', 'error');
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
            specificContent = `אתה מומחה תמחור, חישוב חומרים וניהול עבודות של התקנת עמדות טעינה לרכבים חשמליים בישראל (עבור סתיו ג'אן - SJ הנדסת חשמל).
תפקידך לנהל שיחה מקצועית, ממוקדת ומסייעת כדי לעזור לסתיו לתמחר התקנת עמדת טעינה לרכב חשמלי.

בכל הודעה שלך:
1. נתח את עבודת התקנת עמדת הטעינה שסתיו מתאר.
2. זהה נקודות עיוורון (Blind spots) ודרישות קריטיות - דברים שצריך לקחת בחשבון (למשל: סוג הלוח - חד-פאזי או תלת-פאזי, הארקה של הבניין, מגן זליגה 6mA DC מובנה או מפסק מגן Type B ייעודי בלוח, מוליכי כבל מתאימים 5x6 או 5x10, אופן קיבוע המוביל - צינור מריכף, תעלה סגורה או חציבה, מרחק בפועל מהלוח, עבודה בגובה, הפרעות בשטח, הגדלת חיבור ותיאום מול חברת החשמל, שאלות לקיבוע המוביל וכדומה).
3. הצע רשימת חומרים נלווים ואביזרים שסתיו צריך לקנות כדי להשלים את עבודת ההתקנה קומפלט פרפקט (כגון דיבלים, ברגים, כבל XLPE, תעלות PVC, קופסאות חיבור, עמדת טעינה, צינורות הגנה, מהדקים, חציבות וכו').
4. בצע "בדיקת מחירים באינטרנט" - ספק הערכת מחיר רכש משוערת לחומרים (כאילו חיפשת באתרים כמו ארכה) ופרט את מחירי החומרים בשקלים.
5. ספק אומדן עלות עבודה (עבודה בלבד, ללא חומרים) משוערת בשקלים חדשים (ניתן להסתמך על מחירונים מקובלים כמו מחירון שטרן).`;
            break;
            
        case 'solar_installer':
            specificContent = `אתה מומחה תמחור, חישוב חומרים וניהול עבודות של התקנת מערכות סולאריות (PV) בישראל (עבור סתיו ג'אן - SJ הנדסת חשמל).
תפקידך לנהל שיחה מקצועית, ממוקדת ומסייעת כדי לעזור לסתיו לתמחר התקנת מערכת סולארית לייצור חשמל.

בכל הודעה שלך:
1. נתח את עבודת ההתקנה הסולארית שסתיו מתאר.
2. זהה נקודות עיוורון (Blind spots) ודרישות קריטיות - דברים שצריך לקחת בחשבון (למשל: סוג הגג - בטון, רעפים או איסכורית, הצללות אפשריות, כבילת DC ייעודית עמידה בקרני UV, סוג הממיר - Inverter, עגינה וקונסטרוקציה מתאימה לעומסי רוח, הארקות שלדת הפנלים, הכנות לחיבור ללוח הראשי, מונה נטו ואישורים מול חברת החשמל, דרישות כיבוי אש, עבודה בגובה, פיגומים או מנוף, בטיחות בשטח וכו').
3. הצע רשימת חומרים נלווים ואביזרים שסתיו צריך לקנות כדי להשלים את ההתקנה קומפלט פרפקט (כגון פנלים סולאריים, ממיר, מסילות אלומיניום, תופסנים, ברגי עגינה, כבלי DC 4/6 ממ"ר, מהדקים, מפסקי DC, לוח הגנות וכו').
4. בצע "בדיקת מחירים באינטרנט" - ספק הערכת מחיר רכש משוערת לחומרים ופרט את מחירי החומרים בשקלים.
5. ספק אומדן עלות עבודה (עבודה בלבד, ללא חומרים) משוערת בשקלים חדשים.`;
            break;
            
        case 'renovator':
            specificContent = `אתה מומחה תמחור, חישוב חומרים וניהול עבודות שיפוצים ובינוי פנים בישראל (עבור סתיו ג'אן - SJ הנדסת חשמל).
תפקידך לנהל שיחה מקצועית, ממוקדת ומסייעת כדי לעזור לסתיו לתמחר עבודות שיפוץ וגמר פנים.

בכל הודעה שלך:
1. נתח את עבודת השיפוצים שסתיו מתאר.
2. זהה נקודות עיוורון (Blind spots) ודרישות קריטיות - דברים שצריך לקחת בחשבון (למשל: עבודות הריסה ופינוי פסולת למכולה מורשית, מצב התשתיות הישנות כמו אינסטלציה וחשמל, איטום חדרים רטובים - מקלחות/מרפסות, פילוס הרצפה, סוגי לוחות גבס - ירוק/ורוד/לבן, שפכטל אמריקאי וצבע, חלוקת עומסים, פתחי שירות למערכות, עבודה בשעות מותרות, הגנה על מעליות ורכוש משותף וכו').
3. הצע רשימת חומרים נלווים ואביזרים שסתיו צריך לקנות כדי להשלים את העבודה קומפלט פרפקט (כגון מלט, חול, טיח, בלוקים, לוחות גבס, פרופילים, ברגים, דבקי קרמיקה, רובה, חומרי איטום צמנטיים/אקריליים, צנרת מים SP/פקסגול, קופסאות חיבור וכו').
4. בצע "בדיקת מחירים באינטרנט" - ספק הערכת מחיר רכש משוערת לחומרים ופרט את מחירי החומרים בשקלים.
5. ספק אומדן עלות עבודה (עבודה בלבד, ללא חומרים) משוערת בשקלים חדשים (ניתן להסתמך על מחירונים מקובלים כמו מחירון דקל או שטרן).`;
            break;
            
        case 'contractor':
            specificContent = `אתה מומחה תמחור, חישוב חומרים וניהול עבודות בנייה וגמר שלד בישראל (עבור סתיו ג'אן - SJ הנדסת חשמל).
תפקידך לנהל שיחה מקצועית, ממוקדת ומסייעת כדי לעזור לסתיו לתמחר פרויקטי בנייה, עבודות שלד וגמר של בניינים ובתים פרטיים.

בכל הודעה שלך:
1. נתח את עבודת הבנייה או השלד שסתיו מתאר.
2. זהה נקודות עיוורון (Blind spots) ודרישות קריטיות - דברים שצריך לקחת בחשבון (למשל: סוג הלוח או הביסוס והכלונסאות, אישורי קונסטרוקטור, בדיקות מעבדה לבטון, ברזל זיון ותפסנות, איטום יסודות וקירות מסד, פיגומים תקניים ועבודה בגובה, דרכי גישה למערבלי בטון ומשאבות, בטיחות אתר הבנייה, תיאום מערכות חשמל/אינסטלציה/מיזוג בתוך יציקות השלד, שלבי התקדמות הבנייה, לוחות זמנים וכו').
3. הצע רשימת חומרים נלווים ואביזרים שסתיו צריך לקנות כדי להשלים את העבודה קומפלט פרפקט (כגון בטון מוכן מסוגים שונים, ברזל בניין בעוביים שונים, עץ תבניות, בלוקים מכל הסוגים - פומיס/איטונג, רשתות ברזל, חומרי איטום ביטומניים, צינורות שרוול וכו').
4. בצע "בדיקת מחירים באינטרנט" - ספק הערכת מחיר רכש משוערת לחומרים ופרט את מחירי החומרים בשקלים.
5. ספק אומדן עלות עבודה (עבודה בלבד, ללא חומרים) משוערת בשקלים חדשים (בהתבסס על מחירונים מקובלים בשוק לעבודות שלד וגמר).`;
            break;
            
        case 'electrician':
        default:
            specificContent = `אתה מומחה תמחור, חישוב חומרים וניהול עבודות חשמל עבור חשמלאי מוסמך בישראל (סתיו ג'אן - SJ הנדסת חשמל).
תפקידך לנהל שיחה מקצועית, ממוקדת ומסייעת כדי לעזור לסתיו לתמחר עבודות חשמל.

בכל הודעה שלך:
1. נתח את העבודה שסתיו מתאר.
2. זהה נקודות עיוורון (Blind spots) - דברים שצריך לקחת בחשבון (למשל: סוג הלוח, מרחק בפועל, חציבות בבטון/בלוק, הארקה, מפסקי מגן, אישורים, הגדלת חיבור, עבודה בגובה, הפרעות בשטח וכו').
3. הצע רשימת חומרים נלווים ואביזרים שסתיו צריך לקנות כדי להשלים את העבודה קומפלט פרפקט (כגון דיבלים, ברגים, כבלים, תעלות, קופסאות חיבור, עמדת טעינה, צינורות וכו').
4. בצע "בדיקת מחירים באינטרנט" - ספק הערכת מחיר רכש משוערת לחומרים (כאילו חיפשת באתרים כמו ארכה) ופרט את מחירי החומרים בשקלים.
5. ספק אומדן עלות עבודה (עבודה בלבד, ללא חומרים) משוערת בשקלים חדשים (ניתן להסתמך על מחירונים מקובלים כמו מחירון שטרן).`;
            break;
    }

    return `${specificContent}

כדי שהתוכנה תדע לעדכן את הממשק הדינמי (הצ'קליסט ועלות העבודה בצד ימין), עליך לסיים כל תשובה שלך עם גוש JSON מובנה בתוך בלוק קוד של json (למשל \`\`\`json ... \`\`\`).
המבנה של ה-JSON חייב להיות בדיוק כזה:
{
  "laborPriceEstimate": 1500, // מחיר עבודה מוערך בלבד (מספר)
  "blindSpots": [
    "פרט כאן נקודת עיוורון ראשונה המבוססת על העיסוק",
    "פרט כאן נקודת עיוורון שנייה המבוססת על העיסוק"
  ],
  "materials": [
    {
      "name": "שם החומר או האביזר",
      "price": 25, // מחיר מוערך ליחידה או סה"כ (מספר)
      "details": "כמות והערה (למשל: 15 מטר)",
      "checked": true
    }
  ]
}

חשוב מאוד: אל תכתוב את ה-JSON באמצע התשובה אלא רק בסופה. החלק העיקרי של התשובה צריך להיות הסבר אנושי, חם ומקצועי בעברית, המפרט את הניתוח שלך, הטיפים וההסברים על מחירי החומרים.`;
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
        showToast('אנא מלא את כל השדות', 'error');
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
        showToast('שם המשתמש כבר קיים במערכת', 'error');
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
    showToast(`ברוך הבא למערכת, ${username}!`);
}

function handleUserLogin(event) {
    if (event) event.preventDefault();
    
    const usernameInput = document.getElementById('login-username');
    const passwordInput = document.getElementById('login-password');
    
    if (!usernameInput || !passwordInput) return;
    
    const username = usernameInput.value.trim();
    const password = passwordInput.value;
    
    if (!username || !password) {
        showToast('אנא מלא את כל השדות', 'error');
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
        showToast('שם משתמש או סיסמה שגויים', 'error');
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
    showToast(`שלום, ${user.username}!`);
}

function handleUserLogout() {
    if (!confirm('האם אתה בטוח שברצונך להתנתק ולנעול את המערכת?')) return;
    
    // Remove active user from both local and session storage
    localStorage.removeItem('sj_logged_in_user');
    sessionStorage.removeItem('sj_logged_in_user');
    
    // Transition UI
    document.getElementById('lock-screen').style.display = 'flex';
    document.querySelector('.app-container').style.display = 'none';
    toggleLockForm('login');
    
    // Reset internal state
    resetAppState();
    
    showToast('התנתקת מהמערכת בהצלחה');
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
        'electrician': 'חשמלאי מוסמך',
        'charger_installer': 'מתקין עמדות טעינה',
        'solar_installer': 'מתקין מערכות סולאריות',
        'renovator': 'קבלן שיפוצים',
        'contractor': 'קבלן עבודות בנייה וגמר'
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
    
    // Profession update is available to ALL users — it sets the AI agent's expertise.
    const professionSection = document.getElementById('settings-profession-section');
    if (professionSection) professionSection.style.display = 'block';
}

function updateUserProfileProfession() {
    const professionInput = document.getElementById('settings-profession-input');
    if (!professionInput) return;
    
    const newProfession = professionInput.value.trim();
    if (!newProfession) {
        showToast('אנא הזן תחום עיסוק תקין', 'error');
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
    
    showToast('תחום העיסוק עודכן בהצלחה');
    
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
        showToast('אנא מלא את כל השדות', 'error');
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
        showToast('שם המשתמש החדש כבר תפוס על ידי משתמש אחר', 'error');
        return;
    }
    
    if (!confirm('האם אתה בטוח שברצונך לעדכן את פרטי האבטחה? (שם המשתמש והסיסמה יעודכנו והנתונים המקומיים שלך יועברו לשם המשתמש החדש)')) {
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
    
    showToast('פרטי האבטחה עודכנו ונתוני המשתמש הועברו בהצלחה!');
    
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
                name: 'SJ הנדסת חשמל',
                owner: "סתיו ג'אן",
                id: 'עוסק פטור: 207382920',
                phone: '053-530-2887',
                email: 'info@sj-eng.co.il',
                web: 'www.sj-eng.co.il',
                address: 'דרך בן גוריון 138, בת ים, יחידה 1304',
                terms: `תנאי תשלום:
• 50% מקדמה עם אישור הצעת המחיר ותחילת העבודה.
• 50% הנותרים עם מסירת התוכניות הסופיות.

הערות נוספות:
• כל שינוי בתוכניות לאחר שלב האישור הראשוני עשוי לגרור תוספת תשלום.
• ליווי מול חברת החשמל אינו כולל את אגרות הבדיקה של חברת החשמל.`
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
    if (bizName) bizName.value = 'SJ הנדסת חשמל';
    const bizOwner = document.getElementById('set-biz-owner');
    if (bizOwner) bizOwner.value = "סתיו ג'אן";
    const bizId = document.getElementById('set-biz-id');
    if (bizId) bizId.value = 'עוסק פטור: 207382920';
    const bizPhone = document.getElementById('set-biz-phone');
    if (bizPhone) bizPhone.value = '053-530-2887';
    const bizEmail = document.getElementById('set-biz-email');
    if (bizEmail) bizEmail.value = 'info@sj-eng.co.il';
    const bizWeb = document.getElementById('set-biz-web');
    if (bizWeb) bizWeb.value = 'www.sj-eng.co.il';
    const bizAddress = document.getElementById('set-biz-address');
    if (bizAddress) bizAddress.value = 'דרך בן גוריון 138, בת ים, יחידה 1304';
    const bizTerms = document.getElementById('set-biz-terms');
    if (bizTerms) bizTerms.value = `תנאי תשלום:
• 50% מקדמה עם אישור הצעת המחיר ותחילת העבודה.
• 50% הנותרים עם מסירת התוכניות הסופיות.

הערות נוספות:
• כל שינוי בתוכניות לאחר שלב האישור הראשוני עשוי לגרור תוספת תשלום.
• ליווי מול חברת החשמל אינו כולל את אגרות הבדיקה של חברת החשמל.`;

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
        showToast('אנא הזן Google Client ID בהגדרות החיבור תחילה', 'error');
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
                    showToast('שגיאה בהתחברות לגוגל: ' + response.error, 'error');
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
                        showToast('שגיאה בקבלת כתובת האימייל מחשבון גוגל', 'error');
                        return;
                    }
                    
                    googleAccessToken = token;
                    
                    const usersStr = localStorage.getItem('sj_app_users');
                    let users = [];
                    if (usersStr) {
                        try { users = JSON.parse(usersStr); } catch(e) {}
                    }
                    
                    const rememberMe = true; // always localStorage
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
                    showToast('שגיאה בקבלת פרטי המשתמש מגוגל: ' + userErr.message, 'error');
                }
            }
        });
        googleTokenClient.requestAccessToken({ prompt: '' });
    } catch (e) {
        console.error('Google token initialization failed:', e);
        showToast('שגיאה באתחול ההתחברות של גוגל. ודא שה-Client ID תקין', 'error');
    }
}

function saveGoogleUserProfession(event) {
    if (event) event.preventDefault();
    const modalInput = document.getElementById('google-reg-profession');
    if (!modalInput || !window.tempGoogleUser) return;
    
    const profession = modalInput.value.trim();
    if (!profession) {
        showToast('אנא הזן תחום עיסוק', 'error');
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
    showToast(`ברוך הבא למערכת, ${email}!`);
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
            container.innerHTML = `<span style="color:var(--text-muted); font-size:0.85rem;">לא נמצאו תיקיות נוספות בדרייב. ניצור את תיקיית 'הצעות מחיר' כברירת מחדל.</span>`;
            return;
        }
        
        let options = folders.map(f => `<option value="${f.id}">${f.name}</option>`).join('');
        options = `<option value="auto_sj">SJ הנדסת חשמל > הצעות מחיר (ברירת מחדל)</option>` + options;
        
        container.innerHTML = `
            <label style="font-size: 0.85rem; color: var(--text-secondary); display: block; margin-top: 10px;">בחר תיקיית יעד ב-Drive לגיבוי:</label>
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
        showToast('מעדכן מיקום תיקייה בדרייב...');
        await resolveSjDriveFolders();
        autoDetectQuoteNumber(false);
        await syncDatabaseToDrive(false);
        showToast('מיקום התיקייה עודכן וסונכרן בהצלחה');
    } catch (e) {
        showToast('שגיאה בעדכון מיקום התיקייה: ' + e.message, 'error');
    }
}

async function recoverDriveBackup() {
    if (!googleAccessToken) {
        showToast('גוגל דרייב אינו מחובר. אנא התחבר תחילה.', 'error');
        return;
    }
    
    const btn = document.getElementById('btn-recover-backup');
    if (!btn) return;
    const originalText = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> מחפש גיבויים...`;
    
    try {
        const dbFilename = getCloudDatabaseFilename();
        const query = `name = '${dbFilename}' and trashed = false`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime,parents)&access_token=${googleAccessToken}`);
        
        if (!res.ok) throw new Error('Drive API query failed');
        
        const data = await res.json();
        const files = data.files || [];
        
        if (files.length === 0) {
            showToast('לא נמצאו קובצי גיבוי בדרייב שלך עבור משתמש זה.', 'error');
            return;
        }
        
        // Sort files by modifiedTime descending (newest first)
        files.sort((a, b) => new Date(b.modifiedTime) - new Date(a.modifiedTime));
        
        // Retrieve the newest file
        const targetFile = files[0];
        
        showToast('נמצא גיבוי! משחזר נתונים מהענן...');
        
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
        
        showToast('הנתונים שוחזרו בהצלחה מהגיבוי בענן!');
    } catch (e) {
        console.error(e);
        showToast('שגיאה בשחזור הגיבוי: ' + e.message, 'error');
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
}



