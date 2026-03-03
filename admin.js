// ==========================================================
//  BUREAU DE LA RÉDACTION — ADMIN PANEL JS
// ==========================================================

const API = window.location.origin + '/api';
let TOKEN = localStorage.getItem('gazette_admin_token') || null;

// --- DOM refs ---
const loginOverlay = document.getElementById('login-overlay');
const dashboard = document.getElementById('dashboard');
const loginForm = document.getElementById('login-form');
const loginError = document.getElementById('login-error');
const loginBtn = document.getElementById('login-btn');

// --- Utility: API call ---
async function apiCall(endpoint, method = 'GET', body = null) {
    const opts = { method, headers: { 'Content-Type': 'application/json' } };
    if (TOKEN) opts.headers['x-admin-token'] = TOKEN;
    if (body) opts.body = JSON.stringify(body);
    const res = await fetch(API + endpoint, opts);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Erreur serveur');
    return data;
}

// --- Toast ---
function showToast(msg, isError = false) {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = 'toast show' + (isError ? ' error' : '');
    setTimeout(() => { t.className = 'toast'; }, 3000);
}

// --- Date formatting ---
function fmtDate(iso) {
    if (!iso) return '—';
    const d = new Date(iso + 'Z');
    return d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// ==========================================================
//  AUTH
// ==========================================================
async function doLogin(password) {
    loginBtn.disabled = true;
    loginError.textContent = '';
    try {
        const data = await apiCall('/login', 'POST', { password });
        TOKEN = data.token;
        localStorage.setItem('gazette_admin_token', TOKEN);
        loginOverlay.classList.add('hidden');
        dashboard.style.display = '';
        loadDashboard();
    } catch (err) {
        loginError.textContent = err.message || 'Accès refusé';
    } finally {
        loginBtn.disabled = false;
    }
}

loginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    doLogin(document.getElementById('login-password').value);
});

document.getElementById('btn-logout').addEventListener('click', async () => {
    try { await apiCall('/logout', 'POST'); } catch (_) { }
    TOKEN = null;
    localStorage.removeItem('gazette_admin_token');
    loginOverlay.classList.remove('hidden');
    dashboard.style.display = 'none';
    document.getElementById('login-password').value = '';
});

// Auto-login if token exists
if (TOKEN) {
    apiCall('/stats').then(() => {
        loginOverlay.classList.add('hidden');
        dashboard.style.display = '';
        loadDashboard();
    }).catch(() => {
        TOKEN = null;
        localStorage.removeItem('gazette_admin_token');
    });
}

// ==========================================================
//  TABS
// ==========================================================
document.querySelectorAll('.tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    });
});

// Sub-tabs
document.querySelectorAll('.sub-tab').forEach(st => {
    st.addEventListener('click', () => {
        document.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.sub-panel').forEach(p => p.classList.remove('active'));
        st.classList.add('active');
        document.getElementById('subtab-' + st.dataset.subtab).classList.add('active');
    });
});

// ==========================================================
//  LOAD DASHBOARD
// ==========================================================
async function loadDashboard() {
    try {
        const stats = await apiCall('/stats');
        document.getElementById('stat-letters-pending').textContent = stats.letters.pending;
        document.getElementById('stat-classifieds-active').textContent = stats.classifieds.active;
        document.getElementById('stat-wanted-active').textContent = stats.wanted.active;
        document.getElementById('stat-accounts-count').textContent = stats.activeAccounts;
    } catch (_) { }
    loadLetters();
    loadAccounts();
    loadClassifieds();
    loadWanted();
}

// ==========================================================
//  LETTERS
// ==========================================================
let currentLetterFilter = 'all';

document.querySelectorAll('#tab-letters .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#tab-letters .filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentLetterFilter = btn.dataset.filter;
        loadLetters();
    });
});

async function loadLetters() {
    const list = document.getElementById('letters-list');
    try {
        const endpoint = currentLetterFilter === 'all' ? '/letters' : `/letters?status=${currentLetterFilter}`;
        const letters = await apiCall(endpoint);
        if (letters.length === 0) {
            list.innerHTML = '<p class="empty-state">Aucune lettre pour ce filtre.</p>';
            return;
        }
        list.innerHTML = letters.map(l => `
            <div class="item-card" data-id="${l.id}">
                <div>
                    <div class="item-title">${esc(l.subject)}</div>
                    <div class="item-meta">
                        <span>${esc(l.author_name)}</span>
                        <span>${l.author_faction ? esc(l.author_faction) : 'Sans faction'}</span>
                        <span>${fmtDate(l.submitted_at)}</span>
                        <span class="badge ${l.status}">${l.status === 'pending' ? 'En attente' : l.status === 'approved' ? 'Approuvée' : 'Rejetée'}</span>
                    </div>
                    <div class="item-preview">${esc(l.content)}</div>
                </div>
                <div class="item-actions">
                    <button class="action-btn" onclick="viewLetter('${l.id}')">Lire</button>
                    ${l.status !== 'approved' ? `<button class="action-btn approve" onclick="updateLetter('${l.id}','approved')">✓</button>` : ''}
                    ${l.status !== 'rejected' ? `<button class="action-btn danger" onclick="updateLetter('${l.id}','rejected')">✗</button>` : ''}
                    <button class="action-btn danger" onclick="deleteLetter('${l.id}')">🗑</button>
                </div>
            </div>
        `).join('');
    } catch (err) { list.innerHTML = `<p class="empty-state">Erreur: ${esc(err.message)}</p>`; }
}

window.viewLetter = async function (id) {
    try {
        const letters = await apiCall('/letters');
        const l = letters.find(x => x.id === id);
        if (!l) return;
        document.getElementById('detail-body').innerHTML = `
            <h4>${esc(l.subject)}</h4>
            <p class="detail-meta"><span>${esc(l.author_name)}</span> · <span>${l.author_faction || 'Sans faction'}</span> · <span>${fmtDate(l.submitted_at)}</span></p>
            <div class="detail-content">${esc(l.content).replace(/\n/g, '<br>')}</div>
        `;
        document.getElementById('detail-modal').classList.add('open');
    } catch (err) { showToast(err.message, true); }
};

window.updateLetter = async function (id, status) {
    try {
        await apiCall(`/letters/${id}`, 'PUT', { status });
        showToast(status === 'approved' ? 'Lettre approuvée' : 'Lettre rejetée');
        loadLetters();
        loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
};

window.deleteLetter = async function (id) {
    if (!confirm('Supprimer cette lettre ?')) return;
    try {
        await apiCall(`/letters/${id}`, 'DELETE');
        showToast('Lettre supprimée');
        loadLetters();
        loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
};

// ==========================================================
//  CLASSIFIEDS — ACCOUNTS
// ==========================================================
const btnAddAcc = document.getElementById('btn-add-account');
const formAcc = document.getElementById('form-account');
btnAddAcc.addEventListener('click', () => { formAcc.style.display = formAcc.style.display === 'none' ? 'flex' : 'none'; });
document.getElementById('btn-cancel-account').addEventListener('click', () => { formAcc.style.display = 'none'; });

document.getElementById('btn-save-account').addEventListener('click', async () => {
    const username = document.getElementById('acc-username').value.trim();
    const display_name = document.getElementById('acc-display').value.trim();
    const quota_max = parseInt(document.getElementById('acc-quota').value) || 3;
    if (!username || !display_name) return showToast('Champs requis', true);
    try {
        await apiCall('/classifieds/accounts', 'POST', { username, display_name, quota_max });
        showToast('Compte créé');
        formAcc.style.display = 'none';
        document.getElementById('acc-username').value = '';
        document.getElementById('acc-display').value = '';
        document.getElementById('acc-quota').value = '3';
        loadAccounts();
        loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
});

async function loadAccounts() {
    const list = document.getElementById('accounts-list');
    try {
        const accounts = await apiCall('/classifieds/accounts');
        if (accounts.length === 0) { list.innerHTML = '<p class="empty-state">Aucun compte autorisé.</p>'; return; }
        list.innerHTML = accounts.map(a => `
            <div class="item-card">
                <div>
                    <div class="item-title">${esc(a.display_name)}</div>
                    <div class="item-meta">
                        <span>@${esc(a.username)}</span>
                        <span class="badge ${a.active ? 'active' : 'moderated'}">${a.active ? 'Actif' : 'Désactivé'}</span>
                    </div>
                    <div class="quota">Quota : <strong>${a.quota_used}</strong> / ${a.quota_max} annonces</div>
                </div>
                <div class="item-actions">
                    <button class="action-btn" onclick="toggleAccount('${a.id}',${a.active ? 0 : 1})">${a.active ? 'Désactiver' : 'Activer'}</button>
                    <button class="action-btn danger" onclick="deleteAccount('${a.id}')">🗑</button>
                </div>
            </div>
        `).join('');
        // Also update the classified form dropdown
        const sel = document.getElementById('cl-account');
        sel.innerHTML = '<option value="">Choisir un compte...</option>' + accounts.filter(a => a.active).map(a => `<option value="${a.id}">${esc(a.display_name)} (@${esc(a.username)}) [${a.quota_used}/${a.quota_max}]</option>`).join('');
    } catch (err) { list.innerHTML = `<p class="empty-state">Erreur: ${esc(err.message)}</p>`; }
}

window.toggleAccount = async function (id, active) {
    try {
        await apiCall(`/classifieds/accounts/${id}`, 'PUT', { active: !!active });
        showToast(active ? 'Compte activé' : 'Compte désactivé');
        loadAccounts();
    } catch (err) { showToast(err.message, true); }
};

window.deleteAccount = async function (id) {
    if (!confirm('Supprimer ce compte et toutes ses annonces ?')) return;
    try {
        await apiCall(`/classifieds/accounts/${id}`, 'DELETE');
        showToast('Compte supprimé');
        loadAccounts();
        loadClassifieds();
        loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
};

// ==========================================================
//  CLASSIFIEDS — POSTS
// ==========================================================
const btnAddCl = document.getElementById('btn-add-classified');
const formCl = document.getElementById('form-classified');
btnAddCl.addEventListener('click', () => { formCl.style.display = formCl.style.display === 'none' ? 'flex' : 'none'; });
document.getElementById('btn-cancel-classified').addEventListener('click', () => { formCl.style.display = 'none'; });

document.getElementById('btn-save-classified').addEventListener('click', async () => {
    const account_id = document.getElementById('cl-account').value;
    const title = document.getElementById('cl-title').value.trim();
    const content = document.getElementById('cl-content').value.trim();
    const category = document.getElementById('cl-category').value.trim();
    if (!account_id || !title || !content) return showToast('Champs requis', true);
    try {
        await apiCall('/classifieds', 'POST', { account_id, title, content, category: category || null });
        showToast('Annonce publiée');
        formCl.style.display = 'none';
        document.getElementById('cl-title').value = '';
        document.getElementById('cl-content').value = '';
        document.getElementById('cl-category').value = '';
        loadClassifieds();
        loadAccounts();
        loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
});

async function loadClassifieds() {
    const list = document.getElementById('classifieds-list');
    try {
        const cls = await apiCall('/classifieds');
        if (cls.length === 0) { list.innerHTML = '<p class="empty-state">Aucune annonce publiée.</p>'; return; }
        list.innerHTML = cls.map(c => `
            <div class="item-card">
                <div>
                    <div class="item-title">${esc(c.title)}</div>
                    <div class="item-meta">
                        <span>${esc(c.author_name || '?')}</span>
                        ${c.category ? `<span>${esc(c.category)}</span>` : ''}
                        <span>${fmtDate(c.created_at)}</span>
                        <span class="badge ${c.status}">${c.status === 'active' ? 'Active' : 'Modérée'}</span>
                    </div>
                    <div class="item-preview">${esc(c.content)}</div>
                </div>
                <div class="item-actions">
                    ${c.status === 'active' ? `<button class="action-btn danger" onclick="moderateClassified('${c.id}')">Modérer</button>` : `<button class="action-btn approve" onclick="reactivateClassified('${c.id}')">Réactiver</button>`}
                    <button class="action-btn danger" onclick="deleteClassified('${c.id}')">🗑</button>
                </div>
            </div>
        `).join('');
    } catch (err) { list.innerHTML = `<p class="empty-state">Erreur: ${esc(err.message)}</p>`; }
}

window.moderateClassified = async function (id) {
    try {
        await apiCall(`/classifieds/${id}`, 'PUT', { status: 'moderated' });
        showToast('Annonce modérée');
        loadClassifieds(); loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
};

window.reactivateClassified = async function (id) {
    try {
        await apiCall(`/classifieds/${id}`, 'PUT', { status: 'active' });
        showToast('Annonce réactivée');
        loadClassifieds(); loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
};

window.deleteClassified = async function (id) {
    if (!confirm('Supprimer cette annonce ?')) return;
    try {
        await apiCall(`/classifieds/${id}`, 'DELETE');
        showToast('Annonce supprimée');
        loadClassifieds(); loadAccounts(); loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
};

// ==========================================================
//  WANTED POSTERS
// ==========================================================
const btnAddW = document.getElementById('btn-add-wanted');
const formW = document.getElementById('form-wanted');
btnAddW.addEventListener('click', () => { formW.style.display = formW.style.display === 'none' ? 'flex' : 'none'; });
document.getElementById('btn-cancel-wanted').addEventListener('click', () => { formW.style.display = 'none'; });

document.getElementById('btn-save-wanted').addEventListener('click', async () => {
    const name = document.getElementById('w-name').value.trim();
    const alias = document.getElementById('w-alias').value.trim();
    const description = document.getElementById('w-desc').value.trim();
    const crimes = document.getElementById('w-crimes').value.trim();
    const reward = document.getElementById('w-reward').value.trim();
    const image_url = document.getElementById('w-image').value.trim();
    const danger_level = document.getElementById('w-danger').value;
    if (!name || !description) return showToast('Nom et description requis', true);
    try {
        await apiCall('/wanted', 'POST', { name, alias: alias || null, description, crimes: crimes || null, reward: reward || null, image_url: image_url || null, danger_level });
        showToast('Avis de recherche créé');
        formW.style.display = 'none';
        ['w-name', 'w-alias', 'w-desc', 'w-crimes', 'w-reward', 'w-image'].forEach(id => document.getElementById(id).value = '');
        loadWanted(); loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
});

async function loadWanted() {
    const list = document.getElementById('wanted-list');
    try {
        const posters = await apiCall('/wanted');
        if (posters.length === 0) { list.innerHTML = '<p class="empty-state">Aucun avis de recherche.</p>'; return; }
        list.innerHTML = posters.map(w => `
            <div class="item-card">
                <div>
                    <div class="item-title">${esc(w.name)}${w.alias ? ` <em style="color:var(--ink-faded);font-size:.85em">dit « ${esc(w.alias)} »</em>` : ''}</div>
                    <div class="item-meta">
                        <span class="badge ${w.danger_level}">Danger : ${esc(w.danger_level)}</span>
                        ${w.reward ? `<span>Récompense : ${esc(w.reward)}</span>` : ''}
                        <span>${fmtDate(w.created_at)}</span>
                        <span class="badge ${w.status}">${w.status === 'active' ? 'Actif' : 'Archivé'}</span>
                    </div>
                    ${w.crimes ? `<div class="item-preview"><strong>Chefs :</strong> ${esc(w.crimes)}</div>` : ''}
                    <div class="item-preview">${esc(w.description)}</div>
                </div>
                <div class="item-actions">
                    ${w.status === 'active' ? `<button class="action-btn" onclick="archiveWanted('${w.id}')">Archiver</button>` : `<button class="action-btn approve" onclick="reactivateWanted('${w.id}')">Réactiver</button>`}
                    <button class="action-btn danger" onclick="deleteWanted('${w.id}')">🗑</button>
                </div>
            </div>
        `).join('');
    } catch (err) { list.innerHTML = `<p class="empty-state">Erreur: ${esc(err.message)}</p>`; }
}

window.archiveWanted = async function (id) {
    try {
        await apiCall(`/wanted/${id}`, 'PUT', { status: 'archived' });
        showToast('Avis archivé');
        loadWanted(); loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
};

window.reactivateWanted = async function (id) {
    try {
        await apiCall(`/wanted/${id}`, 'PUT', { status: 'active' });
        showToast('Avis réactivé');
        loadWanted(); loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
};

window.deleteWanted = async function (id) {
    if (!confirm('Supprimer cet avis de recherche ?')) return;
    try {
        await apiCall(`/wanted/${id}`, 'DELETE');
        showToast('Avis supprimé');
        loadWanted(); loadDashboardStats();
    } catch (err) { showToast(err.message, true); }
};

// ==========================================================
//  STATS REFRESH
// ==========================================================
async function loadDashboardStats() {
    try {
        const stats = await apiCall('/stats');
        document.getElementById('stat-letters-pending').textContent = stats.letters.pending;
        document.getElementById('stat-classifieds-active').textContent = stats.classifieds.active;
        document.getElementById('stat-wanted-active').textContent = stats.wanted.active;
        document.getElementById('stat-accounts-count').textContent = stats.activeAccounts;
    } catch (_) { }
}

// ==========================================================
//  DETAIL MODAL
// ==========================================================
document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('detail-modal').classList.remove('open');
});
document.getElementById('detail-modal').addEventListener('click', (e) => {
    if (e.target.id === 'detail-modal') e.target.classList.remove('open');
});
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') document.getElementById('detail-modal').classList.remove('open');
});

// ==========================================================
//  ESCAPE HTML
// ==========================================================
function esc(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
}
