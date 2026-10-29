/**
 * ĐKHP Web - Main Application
 * Handles UI logic, tab switching, and data display
 */

try {
    localStorage.removeItem('dkhp_theme');
    document.documentElement.removeAttribute('data-theme');
} catch (e) { }

// ==================== State ====================
let currentTab = 'courses';
let classesData = [];
let extraClassesData = [];
let improvementClassesData = [];
let registeredSchedules = []; // Store detailed schedules of all registered courses

// ==================== Initialization ====================
document.addEventListener('DOMContentLoaded', async () => {
    setupEventListeners();
    try {
        document.documentElement.removeAttribute('data-theme');
        if (document.body) document.body.removeAttribute('data-theme');
    } catch (e) { }
    // Restore saved Access Key
    let savedKey = '';
    try {
        savedKey = api.getAccessKey();
        const keyInput = document.getElementById('access-key-input');
        if (savedKey && keyInput) {
            keyInput.value = savedKey;
        }
    } catch (e) { }

    // The desktop build needs an online license before using its API.
    let licenseAllowed = false;
    try {
        const configResponse = await fetch('/api/license/config');
        if (configResponse.ok) {
            const config = await configResponse.json();
            api.licenseRequired = config.required === true;
        }
        // Cloudflare Pages does not expose this desktop-only endpoint.
        licenseAllowed = !api.licenseRequired;
        if (api.licenseRequired) {
            document.getElementById('access-key-group').style.display = '';
            const keyResult = await api.validateKey(savedKey, api.studentInfo?.maSinhVien || '');
            licenseAllowed = keyResult.allowed === true;
            if (!licenseAllowed && savedKey) showError(document.getElementById('login-error'), keyResult.message || 'Key không hợp lệ');
        }
    } catch (_) {
        licenseAllowed = false;
        showError(document.getElementById('login-error'), 'Không thể kiểm tra cấu hình key');
    }
    let result = licenseAllowed ? await api.validateSession() : { success: false };
    if (licenseAllowed && !result.success) {
        // Tự động kiểm tra và đăng nhập lại bằng thông tin đã lưu nếu token cũ đã hết hạn
        const relogged = await api.tryAutoRelogin();
        if (relogged) {
            result = await api.validateSession();
        }
    }

    if (result.success) {
        showDashboard(result.studentInfo);
    } else {
        showLoginPage();
    }

    // Setup event listeners
    updateTime();
    setInterval(updateTime, 1000);
});

// ==================== Persistent Form State ====================
function saveRegisterFormState() {
    try {
        const state = {
            classIds: document.getElementById('class-ids')?.value || '',
            type: document.getElementById('register-type')?.value || 'main',
            loop: document.getElementById('register-loop')?.value || '10',
            delay: document.getElementById('register-delay')?.value || '50',
            delayMax: document.getElementById('register-delay-max')?.value || '100',
            timer: document.getElementById('register-timer-input')?.value || '',
            mode: document.getElementById('register-mode')?.value || 'browser'
        };
        localStorage.setItem('dkhp_register_form_state', JSON.stringify(state));
    } catch (e) {
        console.warn('Không thể lưu trạng thái form ĐKHP:', e);
    }
}

function restoreRegisterFormState() {
    try {
        const raw = localStorage.getItem('dkhp_register_form_state');
        if (raw) {
            const state = JSON.parse(raw);
            if (state.classIds !== undefined && document.getElementById('class-ids')) {
                document.getElementById('class-ids').value = state.classIds;
            }
            if (state.type && document.getElementById('register-type')) {
                document.getElementById('register-type').value = state.type;
            }
            if (state.loop && document.getElementById('register-loop')) {
                document.getElementById('register-loop').value = state.loop;
            }
            if (document.getElementById('register-delay')) {
                const val = (state.delay === '500' || state.delay === '5' || !state.delay) ? '50' : state.delay;
                document.getElementById('register-delay').value = val;
            }
            if (document.getElementById('register-delay-max')) {
                const valMax = (state.delayMax === '1000' || state.delayMax === '10' || !state.delayMax) ? '100' : state.delayMax;
                document.getElementById('register-delay-max').value = valMax;
            }
            if (state.timer !== undefined && document.getElementById('register-timer-input')) {
                document.getElementById('register-timer-input').value = state.timer;
            }
            if (state.mode && document.getElementById('register-mode')) {
                document.getElementById('register-mode').value = state.mode;
            }
        } else {
            if (document.getElementById('register-delay')) document.getElementById('register-delay').value = '50';
            if (document.getElementById('register-delay-max')) document.getElementById('register-delay-max').value = '100';
        }
    } catch (e) {
        console.warn('Không thể phục hồi trạng thái form ĐKHP:', e);
    }
}

function setupEventListeners() {
    // Login form
    document.getElementById('login-form').addEventListener('submit', handleLogin);

    // Tab navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => switchTab(btn.dataset.tab));
    });

    // Auto-save form events
    ['class-ids', 'register-type', 'register-loop', 'register-delay', 'register-delay-max', 'register-timer-input', 'register-mode'].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', saveRegisterFormState);
            el.addEventListener('change', saveRegisterFormState);
        }
    });

    // Select all checkboxes
    document.getElementById('select-all-classes')?.addEventListener('change', (e) => {
        document.querySelectorAll('#classes-table tbody input[type="checkbox"]').forEach(cb => {
            cb.checked = e.target.checked;
        });
    });

    document.getElementById('select-all-extra-classes')?.addEventListener('change', (e) => {
        document.querySelectorAll('#extra-classes-table tbody input[type="checkbox"]').forEach(cb => {
            cb.checked = e.target.checked;
        });
    });

    document.getElementById('select-all-inline-classes')?.addEventListener('change', (e) => {
        document.querySelectorAll('#inline-classes-table tbody input[type="checkbox"]').forEach(cb => {
            if (!cb.disabled) cb.checked = e.target.checked;
        });
    });

    // Step 2 Auto Register trigger button
    document.getElementById('step2-trigger-autoregister-btn')?.addEventListener('click', triggerAutoRegisterFromStep2);

    // Listen for auto-register success to update UI
    window.addEventListener('auto-register-success', (e) => {
        const { classId } = e.detail;

        // Remove ID from textarea
        const textarea = document.getElementById('class-ids');
        if (textarea) {
            const currentIds = textarea.value.split('\n').map(id => id.trim());
            const newIds = currentIds.filter(id => id !== classId && id !== '');
            textarea.value = newIds.join('\n');
            saveRegisterFormState();
        }

        // Do not clear logs here so we can see the full progress of multi-class registration
    });

    // Initialize improvement class lookup
    initImprovementLookup();
}

// ==================== Auth ====================

// Track which login tab is active
let currentLoginTab = 'portal';

function switchLoginTab(tab) {
    currentLoginTab = tab;
    const portalFields = document.getElementById('login-portal-fields');
    const tokenFields = document.getElementById('login-token-fields');
    const tabPortal = document.getElementById('tab-portal');
    const tabToken = document.getElementById('tab-token');

    if (tab === 'portal') {
        portalFields.style.display = '';
        tokenFields.style.display = 'none';
        tabPortal.style.color = 'var(--primary)';
        tabPortal.style.borderBottom = '2px solid var(--primary)';
        tabToken.style.color = 'var(--text-secondary)';
        tabToken.style.borderBottom = '2px solid transparent';
    } else {
        portalFields.style.display = 'none';
        tokenFields.style.display = '';
        tabToken.style.color = 'var(--primary)';
        tabToken.style.borderBottom = '2px solid var(--primary)';
        tabPortal.style.color = 'var(--text-secondary)';
        tabPortal.style.borderBottom = '2px solid transparent';
    }

    // Clear errors
    const errorEl = document.getElementById('login-error');
    if (errorEl) {
        errorEl.classList.add('hidden');
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }
}

function showError(element, message) {
    if (typeof element === 'string') {
        element = document.getElementById(element);
    }
    if (element) {
        element.textContent = message || 'Đã xảy ra lỗi';
        element.classList.remove('hidden');
        element.style.display = 'block';
    }
}

async function handleLogin(e) {
    if (e && e.preventDefault) e.preventDefault();

    const btn = document.getElementById('login-btn');
    const errorEl = document.getElementById('login-error');

    if (errorEl) {
        errorEl.classList.add('hidden');
        errorEl.style.display = 'none';
        errorEl.textContent = '';
    }

    if (btn) {
        btn.disabled = true;
        const btnText = btn.querySelector('.btn-text');
        if (btnText) btnText.textContent = 'Đang xác thực...';
        const loader = btn.querySelector('.btn-loader');
        if (loader) loader.classList.remove('hidden');
    }

    try {
        let result;

        // Desktop builds validate the key with Cloudflare before Portal login.
        const accessKeyInput = document.getElementById('access-key-input');
        const accessKey = accessKeyInput ? accessKeyInput.value.trim() : '';
        if (api.licenseRequired) {
            const keyResult = await api.validateKey(accessKey, document.getElementById('username-input')?.value.trim() || '');
            if (!keyResult.allowed) {
                showError(errorEl, keyResult.message || 'Key không hợp lệ');
                return;
            }
        }
        if (accessKey) {
            api.saveAccessKey(accessKey);
        }

        if (currentLoginTab === 'portal') {
            const usernameInput = document.getElementById('username-input');
            const passwordInput = document.getElementById('password-input');
            const username = usernameInput ? usernameInput.value.trim() : '';
            const password = passwordInput ? passwordInput.value : '';

            if (!username || !password) {
                if (btn) {
                    btn.disabled = false;
                    const btnText = btn.querySelector('.btn-text');
                    if (btnText) btnText.textContent = 'Đăng nhập';
                    const loader = btn.querySelector('.btn-loader');
                    if (loader) loader.classList.add('hidden');
                }
                showError(errorEl, 'Vui lòng nhập đầy đủ tên đăng nhập và mật khẩu');
                return;
            }

            const remember = document.getElementById('remember-login')?.checked ?? true;
            result = await api.login(username, password, remember);
        } else {
            const tokenInput = document.getElementById('token-input');
            const token = tokenInput ? tokenInput.value.trim() : '';

            if (!token) {
                if (btn) {
                    btn.disabled = false;
                    const btnText = btn.querySelector('.btn-text');
                    if (btnText) btnText.textContent = 'Đăng nhập';
                    const loader = btn.querySelector('.btn-loader');
                    if (loader) loader.classList.add('hidden');
                }
                showError(errorEl, 'Vui lòng dán Bearer Token vào ô bên trên');
                return;
            }

            result = await api.loginWithToken(token);
        }

        if (btn) {
            btn.disabled = false;
            const btnText = btn.querySelector('.btn-text');
            if (btnText) btnText.textContent = 'Đăng nhập';
            const loader = btn.querySelector('.btn-loader');
            if (loader) loader.classList.add('hidden');
        }

        if (result && result.success) {
            showDashboard(result.studentInfo);
            showToast('Đăng nhập thành công!', 'success');
        } else {
            const errMsg = result ? (result.message || 'Tài khoản hoặc mật khẩu không chính xác') : 'Đăng nhập thất bại';
            showError(errorEl, errMsg);
        }
    } catch (err) {
        console.error('Lỗi khi đăng nhập:', err);
        if (btn) {
            btn.disabled = false;
            const btnText = btn.querySelector('.btn-text');
            if (btnText) btnText.textContent = 'Đăng nhập';
            const loader = btn.querySelector('.btn-loader');
            if (loader) loader.classList.add('hidden');
        }
        showError(errorEl, err.message || 'Lỗi kết nối đến máy chủ');
    } finally {
        if (btn) {
            btn.disabled = false;
            const btnText = btn.querySelector('.btn-text');
            if (btnText) btnText.textContent = 'Đăng nhập';
            const loader = btn.querySelector('.btn-loader');
            if (loader) loader.classList.add('hidden');
        }
    }
}

async function handleLogout() {
    if (!confirm('Bạn có chắc muốn đăng xuất?')) return;

    await api.logout();
    showLoginPage();
    showToast('Đã đăng xuất', 'info');
}

function togglePasswordInput() {
    const input = document.getElementById('password-input');
    const btn = document.querySelector('#login-portal-fields .toggle-password');
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (btn) {
            btn.innerHTML = `
                <svg class="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
            `;
        }
    } else {
        input.type = 'password';
        if (btn) {
            btn.innerHTML = `
                <svg class="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                </svg>
            `;
        }
    }
}

function toggleTokenInput() {
    const input = document.getElementById('token-input');
    const btn = document.querySelector('#login-token-fields .toggle-password');
    if (!input) return;
    if (input.type === 'password') {
        input.type = 'text';
        if (btn) {
            btn.innerHTML = `
                <svg class="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                </svg>
            `;
        }
    } else {
        input.type = 'password';
        if (btn) {
            btn.innerHTML = `
                <svg class="eye-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                </svg>
            `;
        }
    }
}

window.togglePassword = togglePasswordInput;
window.togglePasswordInput = togglePasswordInput;
window.toggleTokenInput = toggleTokenInput;
window.switchLoginTab = switchLoginTab;
window.handleLogin = handleLogin;

// ==================== Page Navigation ====================
function showLoginPage() {
    const loginPage = document.getElementById('login-page');
    const dashboardPage = document.getElementById('dashboard-page');
    if (loginPage) loginPage.classList.add('active');
    if (dashboardPage) dashboardPage.classList.remove('active');
}

function showDashboard(studentInfo) {
    const loginPage = document.getElementById('login-page');
    const dashboardPage = document.getElementById('dashboard-page');
    if (loginPage) loginPage.classList.remove('active');
    if (dashboardPage) dashboardPage.classList.add('active');

    if (studentInfo) {
        const idEl = document.querySelector('.student-id');
        if (idEl) {
            idEl.textContent = studentInfo.maSinhVien ? `MSSV: ${studentInfo.maSinhVien}` : '';
        }
    }

    // Tự động kích hoạt tab Check môn học
    try { switchTab('courses'); } catch (e) { }

    // Tự động khôi phục lại các môn học và cấu hình đã nhập trước đó
    try { restoreRegisterFormState(); } catch (e) { }

    // Prefetch registered schedules
    try { updateRegisteredSchedules(); } catch (e) { }

    api.getAutoRegisterStatus().then(res => {
        if (res && res.success && (res.status === 'running' || res.status === 'waiting')) {
            autoRegisterRunning = true;
            const startBtn = document.getElementById('start-register-btn');
            const stopBtn = document.getElementById('stop-register-btn');
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
            updateStatus(res.status === 'waiting' ? 'Đã hẹn giờ trên máy chủ' : 'Đang chạy ngầm trên máy chủ...');
            addLog('register-log', '🔄 Phát hiện tiến trình ĐKHP ngầm đang chạy trên máy chủ! Đang đồng bộ log...', 'info');
            startAutoRegisterPolling();
        }
    }).catch(() => {});
}

function switchTab(tab) {
    currentTab = tab;

    // Update tab buttons
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    // Update tab contents
    document.querySelectorAll('.tab-content').forEach(content => {
        content.classList.toggle('active', content.id === `tab-${tab}`);
    });
}

// ==================== Auto Registration (Tab 1) ====================
// Global variables for backend auto register
let autoRegisterRunning = false;
let autoRegisterTimeout = null;

async function startAutoRegister() {
    saveRegisterFormState();

    const classIdsText = document.getElementById('class-ids').value.trim();
    const type = document.getElementById('register-type').value;
    const loop = parseInt(document.getElementById('register-loop').value) || 10;
    const delay = parseInt(document.getElementById('register-delay').value) || 50;
    const delayMax = parseInt(document.getElementById('register-delay-max')?.value) || 100;
    const timerInput = document.getElementById('register-timer-input').value;
    const mode = document.getElementById('register-mode')?.value || 'browser';

    let targetTimeStr = null;
    if (timerInput) {
        const now = new Date();
        const [hours, minutes, seconds] = timerInput.split(':').map(Number);
        const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, seconds || 0);

        if (targetTime <= now) {
            targetTime.setDate(targetTime.getDate() + 1); // Tomorrow
        }
        targetTimeStr = targetTime.toISOString();
    }

    if (!classIdsText) {
        showToast('Vui lòng nhập ID lớp học phần', 'error');
        return;
    }

    const classIds = classIdsText.split('\n').map(id => id.trim()).filter(id => id);

    if (classIds.length === 0) {
        showToast('Không có ID lớp hợp lệ', 'error');
        return;
    }

    autoRegisterRunning = true;
    document.getElementById('start-register-btn').disabled = true;
    document.getElementById('stop-register-btn').disabled = false;
    clearRegisterLog();

    const runLocalDirect = () => {
        if (targetTimeStr) {
            addLog('register-log', `⏳ Đang đợi trên trình duyệt đến ${new Date(targetTimeStr).toLocaleTimeString('vi-VN')}... (Vui lòng không tắt tab này)`, 'info');
            updateStatus('Đang đợi đến giờ...');
            const timeToWait = new Date(targetTimeStr).getTime() - new Date().getTime();
            autoRegisterTimeout = setTimeout(() => {
                if (autoRegisterRunning) {
                    runLocalRegisterLoop(classIds, type, loop, delay, delayMax);
                }
            }, Math.max(0, timeToWait));
        } else {
            runLocalRegisterLoop(classIds, type, loop, delay, delayMax);
        }
    };

    if (mode === 'server') {
        if (targetTimeStr) {
            addLog('register-log', `⏳ Đang gửi lịch hẹn giờ lên máy chủ (thời gian: ${new Date(targetTimeStr).toLocaleTimeString('vi-VN')})...`, 'info');
            updateStatus('Đang đẩy lên máy chủ...');
        } else {
            addLog('register-log', `🚀 Đang khởi chạy đăng ký ngầm trên máy chủ (${loop} lượt, ${classIds.length} môn)...`, 'info');
            updateStatus('Đang kết nối máy chủ...');
        }

        try {
            const credentials = api.getCredentials();
            const result = await api.startAutoRegister(classIds, type, loop, delay, delayMax, targetTimeStr, credentials, _activeCourseGroups);
            if (result.success) {
                if (targetTimeStr) {
                    addLog('register-log', `✅ Đã lưu hẹn giờ lên máy chủ! Bạn có thể tắt trình duyệt, đúng giờ hệ thống sẽ tự chạy ngầm.`, 'success');
                    addLog('register-log', `🔗 Xem nhật ký chạy ngầm tại: <a href="/api/registration/view-logs" target="_blank" style="color:#60a5fa;text-decoration:underline;">/api/registration/view-logs</a>`, 'info');
                    addLog('register-log', `👀 Đang kết nối trực tiếp để theo dõi log máy chủ...`, 'info');
                    updateStatus('Đã hẹn giờ trên máy chủ');
                } else {
                    addLog('register-log', `✅ Đã bắt đầu chạy ngầm trên máy chủ! Bạn có thể tắt tab hoặc chuyển trang thoải mái.`, 'success');
                    addLog('register-log', `🔗 Xem nhật ký chạy ngầm tại: <a href="/api/registration/view-logs" target="_blank" style="color:#60a5fa;text-decoration:underline;">/api/registration/view-logs</a>`, 'info');
                    updateStatus('Đang chạy ngầm trên máy chủ...');
                }
                startAutoRegisterPolling();
            } else {
                addLog('register-log', `⚠️ Máy chủ không chạy ngầm được (${result.message || 'Lỗi'}). Chuyển sang chạy trực tiếp trên trình duyệt...`, 'warning');
                runLocalDirect();
            }
        } catch (error) {
            addLog('register-log', `⚠️ Không thể kết nối chạy ngầm (${error.message}). Chuyển sang chạy trực tiếp trên trình duyệt...`, 'warning');
            runLocalDirect();
        }
    } else {
        // Mặc định chạy trực tiếp trên trình duyệt
        runLocalDirect();
    }
}

async function runLocalRegisterLoop(initialClassIds, type, loop, delay, delayMax) {
    let pendingClassIds = [...initialClassIds];
    updateStatus('Đang đăng ký tự động...');
    addLog('register-log', `🚀 Bắt đầu spam trên trình duyệt: ${pendingClassIds.length} môn (${pendingClassIds.join(', ')}), tối đa ${loop} lượt`, 'info');
    addLog('register-log', `🛡️ Tự phục hồi: Đã bật Auto Re-login khi đứt phiên & chống mất lượt khi cổng trường quá tải.`, 'info');

    let currentIteration = 0;
    let consecutiveServerErrorCount = 0;

    while (currentIteration < loop && autoRegisterRunning && pendingClassIds.length > 0) {
        addLog('register-log', `===== Lượt thử ${currentIteration + 1}/${loop} (Còn ${pendingClassIds.length} môn) =====`, 'info');

        const currentBatch = [...pendingClassIds];
        let iterationRetryNeeded = false;

        for (const classId of currentBatch) {
            if (!autoRegisterRunning) return;
            if (!pendingClassIds.includes(classId)) continue;

            addLog('register-log', `🔄 Thử đăng ký lớp: ${classId}`, 'info');

            let result;
            if (type === 'main') result = await api.registerMainClass(classId);
            else if (type === 'extra') result = await api.registerExtraClass(classId);
            else result = await api.registerImprovementClass(classId);

            if (result.success) {
                consecutiveServerErrorCount = 0;
                addLog('register-log', `✅ THÀNH CÔNG: ${result.message} (Lớp: ${classId})`, 'success');
                
                // Tìm xem lớp này có thuộc nhóm môn (courseGroup) nào không
                const strClassId = String(classId);
                const matchedGroup = (_activeCourseGroups || []).find(g => 
                    g.classIds && g.classIds.map(String).includes(strClassId)
                );

                if (matchedGroup && matchedGroup.classIds && matchedGroup.classIds.length > 1) {
                    const siblingIds = matchedGroup.classIds.map(String);
                    const otherSiblings = siblingIds.filter(id => id !== strClassId);
                    pendingClassIds = pendingClassIds.filter(id => !siblingIds.includes(String(id)));
                    addLog('register-log', `🎉 Môn [${matchedGroup.tenHocPhan || matchedGroup.maHocPhan}] đã đăng ký thành công lớp ${strClassId}! Tự động loại bỏ ${otherSiblings.length} lớp dự phòng còn lại (${otherSiblings.join(', ')}) khỏi danh sách chờ.`, 'success');
                } else {
                    pendingClassIds = pendingClassIds.filter(id => String(id) !== strClassId);
                    addLog('register-log', `🗑️ Đã xóa lớp ${classId} khỏi danh sách chờ. Còn lại: ${pendingClassIds.length} môn`, 'info');
                }

                // Cập nhật textarea giao diện & lưu vào localStorage
                const textarea = document.getElementById('class-ids');
                if (textarea) {
                    textarea.value = pendingClassIds.join('\n');
                }
                saveRegisterFormState();

                showToast(`Đăng ký thành công lớp ${classId}!`, 'success');
                if (typeof playSuccessSound === 'function') playSuccessSound();
                updateRegisteredSchedules(); // Update schedules

                // Nếu đã đăng ký hết tất cả các ID thì mới dừng
                if (pendingClassIds.length === 0) {
                    addLog('register-log', '🎉 ĐÃ ĐĂNG KÝ THÀNH CÔNG TẤT CẢ CÁC LỚP!', 'success');
                    stopAutoRegisterLocally('Hoàn thành');
                    return;
                }
            } else if (result.isUnauthorized || (result.message && (result.message.toLowerCase().includes('hết hạn') || result.message.toLowerCase().includes('token')))) {
                // Xử lý khi cổng trường ngắt phiên / 401 Unauthorized
                addLog('register-log', `⚠️ Phiên làm việc hết hạn hoặc bị ngắt! Đang tự động đăng nhập lại...`, 'warning');
                updateStatus('Đang tự động đăng nhập lại...');
                const relogged = await api.tryAutoRelogin();
                if (relogged) {
                    addLog('register-log', `✅ Đã đăng nhập lại thành công! Thử lại ngay lớp: ${classId}...`, 'success');
                    updateStatus('Đang đăng ký tự động...');
                    iterationRetryNeeded = true;
                    break; // Ngắt batch này để thử lại ngay
                } else {
                    addLog('register-log', `❌ Không thể tự động đăng nhập lại cổng trường. Vui lòng đăng nhập lại bằng tay!`, 'error');
                    stopAutoRegisterLocally('Hết phiên');
                    return;
                }
            } else if (result.isServerError || result.isNetworkError || (result.statusCode && result.statusCode >= 500)) {
                // Xử lý khi cổng trường nghẽn 500/502/503/504 hoặc rớt mạng
                consecutiveServerErrorCount++;
                const waitTime = Math.min(2000 + consecutiveServerErrorCount * 500, 5000);
                addLog('register-log', `⚠️ Cổng trường quá tải/nghẽn mạng (${result.message}). Giữ nguyên lượt thử, tự động chờ ${waitTime / 1000}s rồi thử lại...`, 'warning');
                updateStatus(`Đang chờ cổng trường hồi phục (${waitTime / 1000}s)...`);
                await new Promise(resolve => setTimeout(resolve, waitTime));
                updateStatus('Đang đăng ký tự động...');
                iterationRetryNeeded = true;
                break; // Thử lại batch này, không tăng currentIteration!
            } else {
                // Thất bại nghiệp vụ bình thường (Lớp đầy, trùng lịch...)
                consecutiveServerErrorCount = 0;
                addLog('register-log', `❌ Thất bại: ${result.message} (Lớp: ${classId})`, 'error');
            }
        }

        if (iterationRetryNeeded) {
            // Không tăng currentIteration để không bị mất lượt oan!
            continue;
        }

        currentIteration++;

        if (currentIteration < loop && autoRegisterRunning && pendingClassIds.length > 0) {
            const currentDelay = Math.floor(Math.random() * (delayMax - delay + 1)) + delay;
            addLog('register-log', `⏳ Chờ ${currentDelay}ms trước lượt tiếp theo...`, 'warning');
            await new Promise(resolve => setTimeout(resolve, currentDelay));
        }
    }

    if (autoRegisterRunning) {
        if (pendingClassIds.length === 0) {
            addLog('register-log', '🎉 ĐÃ ĐĂNG KÝ THÀNH CÔNG TẤT CẢ CÁC LỚP!', 'success');
        } else {
            addLog('register-log', `🛑 Đã hoàn thành tất cả các lượt thử. Còn lại ${pendingClassIds.length} lớp chưa đăng ký: ${pendingClassIds.join(', ')}`, 'warning');
        }
        stopAutoRegisterLocally('Hoàn thành');
    }
}

function stopAutoRegisterLocally(statusText) {
    autoRegisterRunning = false;
    if (autoRegisterTimeout) {
        clearTimeout(autoRegisterTimeout);
        autoRegisterTimeout = null;
    }
    if (backendPollInterval) {
        clearInterval(backendPollInterval);
        backendPollInterval = null;
    }
    document.getElementById('start-register-btn').disabled = false;
    document.getElementById('stop-register-btn').disabled = true;
    updateStatus(statusText || 'Sẵn sàng');
}

let backendPollInterval = null;

function startAutoRegisterPolling() {
    if (backendPollInterval) clearInterval(backendPollInterval);

    backendPollInterval = setInterval(async () => {
        if (!autoRegisterRunning) {
            clearInterval(backendPollInterval);
            backendPollInterval = null;
            return;
        }

        try {
            const res = await api.getAutoRegisterStatus();
            if (res.success) {
                if (res.logs && res.logs.length > 0) {
                    res.logs.forEach(log => {
                        addLog('register-log', log.message, log.type);
                    });
                }

                // Cập nhật textarea ID môn học còn lại nếu môn trước đó thành công
                if (Array.isArray(res.pendingClassIds)) {
                    const textarea = document.getElementById('class-ids');
                    if (textarea) {
                        const currentVal = textarea.value.split('\n').map(s => s.trim()).filter(Boolean).join('\n');
                        const newVal = res.pendingClassIds.join('\n');
                        if (currentVal !== newVal) {
                            textarea.value = newVal;
                        }
                    }
                }

                // Cập nhật lịch học nếu có môn đăng ký thành công
                if (Array.isArray(res.successfulClassIds) && res.successfulClassIds.length > 0) {
                    if (typeof updateRegisteredSchedules === 'function') {
                        updateRegisteredSchedules();
                    }
                }

                if (res.status === 'stopped' || res.status === 'finished') {
                    clearInterval(backendPollInterval);
                    backendPollInterval = null;
                    autoRegisterRunning = false;
                    document.getElementById('start-register-btn').disabled = false;
                    document.getElementById('stop-register-btn').disabled = true;
                    updateStatus(res.status === 'finished' ? 'Hoàn thành (Server)' : 'Đã dừng (Server)');
                    if (typeof updateRegisteredSchedules === 'function') {
                        updateRegisteredSchedules();
                    }
                    if (res.status === 'finished' && typeof playSuccessSound === 'function') {
                        playSuccessSound();
                    }
                }
            }
        } catch (e) {
            console.error('Lỗi khi lấy log từ máy chủ', e);
        }
    }, 1500);
}

async function stopAutoRegister() {
    stopAutoRegisterLocally('Đã dừng');
    addLog('register-log', '🛑 Đã nhận lệnh dừng từ người dùng', 'warning');
    try {
        await api.stopAutoRegister();
    } catch (e) { }
}

function clearRegisterLog() {
    document.getElementById('register-log').innerHTML = '';
}

// ==================== Semester & Course Hub (Tab 2 New Redesign) ====================
let _mainCoursesData = [];
let _extraCoursesData = [];
let _activeCourseType = 'main'; // 'main' | 'extra'
let _currentStep = 1; // 1: Select Courses, 2: Select Classes
let _selectedCourses = new Map(); // key: maHocPhan -> { course, type, selectedClassIds: [], classes: [] }
let _activeCourseGroups = []; // Array of { maHocPhan, tenHocPhan, classIds: [] }
let _step1SearchQuery = '';
let currentInlineType = 'main';
let currentInlineCourse = { maHocPhan: '', tenHocPhan: '', type: 'main' };

// Semester dropdown sync handlers
function onGlobalSemesterChange(val) {
    const hidden = document.getElementById('global-id-dot');
    if (hidden) hidden.value = val;
    const courseSelect = document.getElementById('course-semester-select');
    if (courseSelect) courseSelect.value = val;
    loadCourses();
}

function onCourseSemesterChange(val) {
    const hidden = document.getElementById('global-id-dot');
    if (hidden) hidden.value = val;
    const globalSelect = document.getElementById('global-semester-select');
    if (globalSelect) globalSelect.value = val;
    loadCourses();
}

// Switch Course Type between Môn chính and Môn điều kiện
function switchCourseTypeTab(type) {
    _activeCourseType = type;
    currentInlineType = type;

    const tabMain = document.getElementById('course-type-tab-main');
    const tabExtra = document.getElementById('course-type-tab-extra');
    if (tabMain) tabMain.classList.toggle('active', type === 'main');
    if (tabExtra) tabExtra.classList.toggle('active', type === 'extra');

    // Update counts
    updateCourseTypeBadges();

    // Check if user is currently looking at Step 1 or Step 2
    const step1View = document.getElementById('step1-view');
    const isStep1Active = step1View && step1View.classList.contains('active');
    const selectedForType = Array.from(_selectedCourses.values()).filter(item => item.type === type);

    // If currently on Step 2 screen but no courses of this type are selected, return to Step 1
    // But don't interrupt if we're currently loading step 2
    if (!_isTransitioningToStep2 && (!isStep1Active || _currentStep === 2) && selectedForType.length === 0) {
        goToStep(1);
    } else if (isStep1Active || _currentStep === 1) {
        _currentStep = 1;
        renderStep1Courses();
        updateStep1Summary();
    } else if (!_isTransitioningToStep2) {
        renderStep2();
    }
}

function updateCourseTypeBadges() {
    const mainBadge = document.getElementById('course-type-badge-main');
    const extraBadge = document.getElementById('course-type-badge-extra');
    if (mainBadge) mainBadge.textContent = `${_mainCoursesData.length} môn mở`;
    if (extraBadge) extraBadge.textContent = `${_extraCoursesData.length} môn mở`;
}

// Helper to determine subject icon based on course name
function getCourseSubjectIcon(courseName = '') {
    const lower = String(courseName).toLowerCase();
    if (lower.includes('bơi') || lower.includes('thể chất') || lower.includes('gdtc') || lower.includes('bóng') || lower.includes('điền kinh') || lower.includes('cầu lông')) {
        return '🏊';
    }
    if (lower.includes('tiếng anh') || lower.includes('anh văn') || lower.includes('toeic') || lower.includes('ielts') || lower.includes('ngoại ngữ') || lower.includes('tiếng')) {
        return '🇬🇧';
    }
    if (lower.includes('lập trình') || lower.includes('tin học') || lower.includes('cntt') || lower.includes('phần mềm') || lower.includes('thuật toán') || lower.includes('dữ liệu') || lower.includes('mạng')) {
        return '💻';
    }
    if (lower.includes('kinh tế') || lower.includes('ngoại thương') || lower.includes('logistics') || lower.includes('quản trị') || lower.includes('tài chính') || lower.includes('kế toán') || lower.includes('thương mại')) {
        return '📊';
    }
    if (lower.includes('toán') || lower.includes('giải tích') || lower.includes('đại số') || lower.includes('xác suất') || lower.includes('vật lý') || lower.includes('hóa')) {
        return '📐';
    }
    if (lower.includes('pháp luật') || lower.includes('luật') || lower.includes('triết') || lower.includes('chính trị') || lower.includes('tư tưởng')) {
        return '⚖️';
    }
    return '🏛️';
}

// Helper to find course name by code across all known course lists
function getCourseNameByCode(maHocPhan) {
    if (!maHocPhan) return '';
    const clean = String(maHocPhan).trim().toUpperCase();

    if (currentInlineCourse && String(currentInlineCourse.maHocPhan || '').trim().toUpperCase() === clean && currentInlineCourse.tenHocPhan) {
        return currentInlineCourse.tenHocPhan;
    }

    if (_selectedCourses.has(clean)) {
        const item = _selectedCourses.get(clean);
        if (item.course && (item.course.tenHocPhan || item.course.tenMonHoc)) {
            return item.course.tenHocPhan || item.course.tenMonHoc;
        }
    }

    if (Array.isArray(_mainCoursesData)) {
        const found = _mainCoursesData.find(c => String(c.maHocPhan || '').trim().toUpperCase() === clean);
        if (found && (found.tenHocPhan || found.tenMonHoc)) return found.tenHocPhan || found.tenMonHoc;
    }

    if (Array.isArray(_extraCoursesData)) {
        const found = _extraCoursesData.find(c => String(c.maHocPhan || '').trim().toUpperCase() === clean);
        if (found && (found.tenHocPhan || found.tenMonHoc)) return found.tenHocPhan || found.tenMonHoc;
    }

    if (typeof cachedImprovementCourses !== 'undefined' && Array.isArray(cachedImprovementCourses)) {
        const found = cachedImprovementCourses.find(c => String(c.maHocPhan || '').trim().toUpperCase() === clean);
        if (found && (found.tenHocPhan || found.tenMonHoc)) return found.tenHocPhan || found.tenMonHoc;
    }

    if (typeof registeredSchedules !== 'undefined' && Array.isArray(registeredSchedules)) {
        const found = registeredSchedules.find(s => String(s.maHocPhan || '').trim().toUpperCase() === clean);
        if (found && (found.tenHocPhan || found.tenMonHoc)) return found.tenHocPhan || found.tenMonHoc;
    }

    return '';
}

// Load all courses for the selected semester
async function loadCourses() {
    const idDot = getIdDot();
    updateStatus('Đang tải danh sách môn học...');

    const container = document.getElementById('step1-courses-container');
    if (container && _mainCoursesData.length === 0 && _extraCoursesData.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 48px 20px;">
                <div class="btn-loader" style="display: inline-block; width: 32px; height: 32px; border-width: 3px; border-color: rgba(37,99,235,0.2); border-top-color: #2563eb; margin-bottom: 12px; border-radius: 50%; animation: spin 0.8s linear infinite;"></div>
                <p style="font-size: 14.5px; color: var(--primary); font-weight: 700; margin: 0 0 6px 0;">Đang tự động tải danh sách môn học từ Portal...</p>
                <p style="font-size: 12px; color: var(--text-secondary); margin: 0;">Vui lòng đợi giây lát</p>
            </div>
        `;
    }

    try {
        const [mainResult, extraResult] = await Promise.all([
            api.getMainCourses(idDot),
            api.getExtraCourses(idDot)
        ]);

        _mainCoursesData = mainResult.success ? (mainResult.data || []) : [];
        _extraCoursesData = extraResult.success ? (extraResult.data || []) : [];

        updateCourseTypeBadges();
        renderStep1Courses();
        updateStep1Summary();

        updateStatus(`Đã tải: ${_mainCoursesData.length} môn chính, ${_extraCoursesData.length} môn điều kiện`);
        showToast(`Tải thành công: ${_mainCoursesData.length} môn chính, ${_extraCoursesData.length} môn điều kiện`, 'success');
    } catch (err) {
        console.error('Lỗi khi tải danh sách môn học:', err);
        showToast('Lỗi khi kết nối lấy danh sách môn học', 'error');
        if (container && _mainCoursesData.length === 0 && _extraCoursesData.length === 0) {
            container.innerHTML = `
                <div class="empty-state-card card" style="grid-column: 1/-1; text-align: center; padding: 40px 20px;">
                    <p style="font-size: 14px; color: #ef4444; font-weight: 600; margin: 0 0 10px 0;">Không thể tải danh sách môn học tự động</p>
                    <button class="btn btn-primary btn-sm" onclick="loadCourses()">🔄 Thử lại ngay</button>
                </div>
            `;
        }
    }
}

// Switch between Step 1 and Step 2
let _isTransitioningToStep2 = false;
async function goToStep(step) {
    const tab1 = document.getElementById('step-tab-1');
    const tab2 = document.getElementById('step-tab-2');
    const view1 = document.getElementById('step1-view');
    const view2 = document.getElementById('step2-view');

    if (step === 1) {
        _currentStep = 1;
        _isTransitioningToStep2 = false;
        if (tab1) tab1.classList.add('active');
        if (tab2) tab2.classList.remove('active');
        if (view1) view1.classList.add('active');
        if (view2) view2.classList.remove('active');
        renderStep1Courses();
        updateStep1Summary();
    } else {
        if (_isTransitioningToStep2) return; // Prevent duplicate calls during loading
        const currentTypeSelected = Array.from(_selectedCourses.values()).filter(item => item.type === _activeCourseType);
        if (_selectedCourses.size === 0 || currentTypeSelected.length === 0) {
            const typeName = _activeCourseType === 'main' ? 'môn học chính' : 'môn học điều kiện';
            showToast(`Vui lòng tích chọn ít nhất 1 ${typeName} ở Bước 1`, 'warning');
            _currentStep = 1;
            return;
        }
        _isTransitioningToStep2 = true;
        _currentStep = 2;
        if (tab1) tab1.classList.remove('active');
        if (tab2) tab2.classList.add('active');
        if (view1) view1.classList.remove('active');
        if (view2) view2.classList.add('active');

        // Show loading overlay while fetching class data
        const loadingOverlay = document.getElementById('step2-loading-overlay');
        const step2Content = document.getElementById('step2-content-wrapper');
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        if (step2Content) step2Content.style.visibility = 'hidden';

        try {
            await loadClassesForSelectedCourses();
            renderStep2();
        } finally {
            _isTransitioningToStep2 = false;
            if (loadingOverlay) loadingOverlay.style.display = 'none';
            if (step2Content) step2Content.style.visibility = 'visible';
        }
    }
}

// Step 1: Render courses grid based on active course type (main vs extra)
function renderStep1Courses() {
    const container = document.getElementById('step1-courses-container');
    if (!container) return;

    let list = _activeCourseType === 'main'
        ? _mainCoursesData.map(c => ({ ...c, courseType: 'main' }))
        : _extraCoursesData.map(c => ({ ...c, courseType: 'extra' }));

    // Update total count pill for current type
    const countEl = document.getElementById('step1-total-count');
    if (countEl) countEl.textContent = `${list.length} môn mở`;

    // Apply search filter
    if (_step1SearchQuery) {
        const query = _step1SearchQuery.toLowerCase();
        list = list.filter(c => {
            const name = (c.tenHocPhan || c.tenMonHoc || '').toLowerCase();
            const code = (c.maHocPhan || '').toLowerCase();
            return name.includes(query) || code.includes(query);
        });
    }

    if (list.length === 0) {
        const typeName = _activeCourseType === 'main' ? 'môn học chính' : 'môn học điều kiện';
        container.innerHTML = `
            <div class="empty-state-card card" style="grid-column: 1/-1; text-align: center; padding: 40px 20px;">
                <p style="font-size: 14px; color: var(--text-secondary); margin: 0;">Chưa có ${typeName} nào được tìm thấy. Nhấn "Kiểm tra môn học" để quét lại.</p>
            </div>
        `;
        return;
    }

    container.innerHTML = '';
    list.forEach(course => {
        const code = String(course.maHocPhan || '').trim();
        const name = course.tenHocPhan || course.tenMonHoc || 'Chưa có tên';
        const credits = course.soTinChi || course.tinChi || 0;
        const isSelected = _selectedCourses.has(code);
        const isExtra = course.courseType === 'extra';
        const isMandatory = course.batBuoc || false;

        let typeBadge = isExtra
            ? `<span class="meta-tag extra">📗 Môn điều kiện</span>`
            : (isMandatory ? `<span class="meta-tag mandatory">Bắt buộc</span>` : `<span class="meta-tag elective">Tự chọn</span>`);

        const card = document.createElement('div');
        card.className = `course-card-item ${isSelected ? 'selected' : ''}`;
        card.id = `course-card-${code}`;
        card.onclick = (e) => {
            if (e.target.tagName !== 'INPUT') {
                const chk = card.querySelector('.course-card-checkbox');
                if (chk) {
                    chk.checked = !chk.checked;
                    toggleCourseSelection(code, chk.checked, course);
                }
            }
        };

        card.innerHTML = `
            <input type="checkbox" class="course-card-checkbox" ${isSelected ? 'checked' : ''}
                onchange="toggleCourseSelection('${code}', this.checked, ${JSON.stringify(course).replace(/"/g, '&quot;')})">
            <div class="course-card-body">
                <span class="course-code-pill">${code}</span>
                <div class="course-card-title">${name}</div>
                <div class="course-meta-tags">
                    <span class="meta-tag credit">${credits} Tín chỉ</span>
                    ${typeBadge}
                </div>
            </div>
        `;
        container.appendChild(card);
    });
}

function filterStep1Courses() {
    _step1SearchQuery = document.getElementById('course-search-input')?.value.trim() || '';
    renderStep1Courses();
}

function toggleCourseSelection(maHocPhan, isChecked, courseObj = null) {
    const cleanCode = String(maHocPhan).trim();
    if (isChecked) {
        let course = courseObj;
        if (!course) {
            course = _mainCoursesData.find(c => String(c.maHocPhan).trim() === cleanCode)
                || _extraCoursesData.find(c => String(c.maHocPhan).trim() === cleanCode)
                || { maHocPhan: cleanCode, tenHocPhan: cleanCode };
        }
        const isExtra = _extraCoursesData.some(c => String(c.maHocPhan).trim() === cleanCode) || _activeCourseType === 'extra';
        _selectedCourses.set(cleanCode, {
            course,
            type: isExtra ? 'extra' : 'main',
            selectedClassIds: [],
            selectedClassId: null,
            classes: []
        });
    } else {
        _selectedCourses.delete(cleanCode);
    }

    const card = document.getElementById(`course-card-${cleanCode}`);
    if (card) {
        card.classList.toggle('selected', isChecked);
        const chk = card.querySelector('.course-card-checkbox');
        if (chk) chk.checked = isChecked;
    }

    updateStep1Summary();
}

function selectAllStep1Courses(select) {
    let list = _activeCourseType === 'main'
        ? _mainCoursesData.map(c => ({ ...c, courseType: 'main' }))
        : _extraCoursesData.map(c => ({ ...c, courseType: 'extra' }));

    if (_step1SearchQuery) {
        const q = _step1SearchQuery.toLowerCase();
        list = list.filter(c => (c.tenHocPhan || c.tenMonHoc || '').toLowerCase().includes(q) || (c.maHocPhan || '').toLowerCase().includes(q));
    }

    list.forEach(c => {
        const code = String(c.maHocPhan || '').trim();
        toggleCourseSelection(code, select, c);
    });
}

function updateStep1Summary() {
    const totalCount = _selectedCourses.size;
    const mainCount = Array.from(_selectedCourses.values()).filter(item => item.type === 'main').length;
    const extraCount = Array.from(_selectedCourses.values()).filter(item => item.type === 'extra').length;

    let totalCredits = 0;
    _selectedCourses.forEach(item => {
        totalCredits += parseInt(item.course.soTinChi || item.course.tinChi || 0, 10) || 0;
    });

    const pill = document.getElementById('step1-selected-pill');
    if (pill) {
        if (totalCount === 0) {
            pill.textContent = 'Chưa chọn môn nào';
        } else if (mainCount > 0 && extraCount > 0) {
            pill.textContent = `Đã chọn ${totalCount} môn (${mainCount} chính, ${extraCount} điều kiện)`;
        } else if (extraCount > 0) {
            pill.textContent = `Đã chọn ${extraCount} môn điều kiện`;
        } else {
            pill.textContent = `Đã chọn ${mainCount} môn chính`;
        }
    }

    const bar = document.getElementById('step1-bottom-bar');
    if (bar) {
        if (totalCount > 0) {
            bar.classList.remove('hidden');
            let desc = `${totalCount} môn`;
            if (mainCount > 0 && extraCount > 0) {
                desc += ` (${mainCount} chính, ${extraCount} điều kiện)`;
            } else if (extraCount > 0) {
                desc += ` (Môn điều kiện)`;
            } else {
                desc += ` (Môn chính)`;
            }
            document.getElementById('step1-selected-count-text').textContent = desc;
            document.getElementById('step1-selected-credits-text').textContent = totalCredits;
        } else {
            bar.classList.add('hidden');
        }
    }
}

// Step 2: Load classes for all selected courses in parallel
async function loadClassesForSelectedCourses() {
    const idDot = getIdDot();
    updateStatus('Đang tải danh sách các lớp học phần...');

    // Prefetch registered schedules for conflict calculation
    if (!registeredSchedules || registeredSchedules.length === 0) {
        await updateRegisteredSchedules();
    }

    const promises = Array.from(_selectedCourses.entries()).map(async ([code, item]) => {
        if (item.classes && item.classes.length > 0) return; // Already loaded

        const type = item.type || _activeCourseType || 'main';
        const res = type === 'main'
            ? await api.getMainClasses(idDot, code)
            : await api.getExtraClasses(idDot, code);

        const classes = (res && res.success) ? (res.data || []) : [];

        // Fetch detailed schedule for each class
        await Promise.all(classes.map(async cls => {
            try {
                const dr = await api.getClassDetail(cls.id, type);
                cls.scheduleDetails = dr.success ? (dr.data || []) : [];
            } catch (e) {
                cls.scheduleDetails = [];
            }
        }));

        item.classes = classes;

        if (!item.selectedClassIds) {
            item.selectedClassIds = [];
        }
        if (item.selectedClassId && item.selectedClassIds.length === 0) {
            item.selectedClassIds = [String(item.selectedClassId)];
        }
    });

    await Promise.all(promises);
    updateStatus('Sẵn sàng');
}

// Step 2: Render entire Step 2 layout
function renderStep2() {
    renderStep2Sidebar();
    renderStep2Classes();
    updateStickySummaryBar();
}

// Step 2: Render Sidebar
function renderStep2Sidebar() {
    const currentCourses = Array.from(_selectedCourses.entries());
    const countEl = document.getElementById('step2-sidebar-count');
    if (countEl) countEl.textContent = `${currentCourses.length} MÔN`;

    const listContainer = document.getElementById('step2-sidebar-list');
    if (!listContainer) return;
    listContainer.innerHTML = '';

    currentCourses.forEach(([code, item]) => {
        const name = item.course.tenHocPhan || item.course.tenMonHoc || code;
        const credits = item.course.soTinChi || item.course.tinChi || 0;
        const classesCount = item.classes?.length || 0;
        const isExtra = item.type === 'extra';
        const typeBadge = isExtra
            ? `<span style="background:#ecfdf5;color:#059669;font-size:10.5px;font-weight:600;padding:2px 6px;border-radius:4px;border:1px solid #a7f3d0;">📗 Môn điều kiện</span>`
            : `<span style="background:#eff6ff;color:#2563eb;font-size:10.5px;font-weight:600;padding:2px 6px;border-radius:4px;border:1px solid #bfdbfe;">📘 Môn chính</span>`;

        const selectedIds = (item.selectedClassIds && item.selectedClassIds.length > 0)
            ? item.selectedClassIds
            : (item.selectedClassId ? [String(item.selectedClassId)] : []);
        const hasClass = selectedIds.length > 0;

        const card = document.createElement('div');
        card.className = `selected-course-mini-card ${hasClass ? 'has-class' : ''}`;
        card.innerHTML = `
            <div class="mini-card-top" style="display:flex;justify-content:space-between;align-items:center;">
                <div style="display:flex;gap:6px;align-items:center;">
                    <span class="mini-card-code">${code}</span>
                    ${typeBadge}
                </div>
                ${hasClass ? '<span class="mini-card-check">✓</span>' : ''}
            </div>
            <div class="mini-card-title">${name}</div>
            <div class="mini-card-sub">${credits} Tín chỉ • ${classesCount} lớp học phần mở</div>
            <div class="mini-card-active-class ${hasClass ? '' : 'empty'}">
                ${hasClass ? `⚙ Đang chọn (${selectedIds.length} lớp): <strong>${selectedIds.join(', ')}</strong>` : '⚠️ Chưa chọn lớp'}
            </div>
        `;
        listContainer.appendChild(card);
    });
}

// Step 2: Render Course Groups & Class Cards
function renderStep2Classes() {
    const container = document.getElementById('step2-classes-container');
    if (!container) return;

    const currentCourses = Array.from(_selectedCourses.entries());

    if (currentCourses.length === 0) {
        container.innerHTML = `
            <div class="empty-state-card card" style="text-align: center; padding: 60px 20px;">
                <p style="font-size: 15px; color: var(--text-secondary); margin-bottom: 12px;">Chưa chọn môn học nào ở Bước 1</p>
                <button class="btn btn-primary" onclick="goToStep(1)">➔ Quay lại Bước 1 để chọn môn</button>
            </div>
        `;
        return;
    }

    const onlyAvailable = document.getElementById('filter-only-available')?.checked ?? false;
    const morningPref = document.getElementById('filter-morning-pref')?.checked ?? false;
    const afternoonPref = document.getElementById('filter-afternoon-pref')?.checked ?? false;

    let totalAvailableClasses = 0;
    container.innerHTML = '';

    currentCourses.forEach(([code, item]) => {
        const name = item.course.tenHocPhan || item.course.tenMonHoc || code;
        const credits = item.course.soTinChi || item.course.tinChi || 0;
        const isExtra = item.type === 'extra';
        const isMandatory = item.course.batBuoc || false;
        const icon = getCourseSubjectIcon(name);

        let classes = item.classes || [];

        // Apply filters
        if (onlyAvailable) {
            classes = classes.filter(cls => {
                const cap = getCapacity(cls);
                return !(cap.hasRawData ? (cap.current >= cap.max) : (cap.percentage >= 100));
            });
        }

        if (morningPref) {
            classes = classes.filter(cls => {
                const sched = cls.scheduleDetails || [];
                return sched.some(s => {
                    const r = parseTietRange(s.tietHoc || s.tiet);
                    return r && r.start <= 5;
                });
            });
        }

        if (afternoonPref) {
            classes = classes.filter(cls => {
                const sched = cls.scheduleDetails || [];
                return sched.some(s => {
                    const r = parseTietRange(s.tietHoc || s.tiet);
                    return r && r.start >= 7;
                });
            });
        }

        totalAvailableClasses += classes.length;

        const groupCard = document.createElement('div');
        groupCard.className = 'course-group-card';

        let typeBadgeHtml = isExtra
            ? `<span class="group-tag mandatory" style="background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;font-weight:600;padding:2px 8px;border-radius:4px;">📗 Môn điều kiện</span>`
            : `<span class="group-tag elective" style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;font-weight:600;padding:2px 8px;border-radius:4px;">📘 Môn chính</span>`;

        const selectedIds = (item.selectedClassIds && item.selectedClassIds.length > 0)
            ? item.selectedClassIds.map(String)
            : (item.selectedClassId ? [String(item.selectedClassId)] : []);

        const pillText = selectedIds.length > 0
            ? `Đã chọn ${selectedIds.length}/${classes.length} lớp`
            : `Chưa chọn lớp nào (${classes.length} lớp mở)`;

        groupCard.innerHTML = `
            <div class="course-group-header">
                <div class="group-header-left">
                    <div class="group-icon-badge">${icon}</div>
                    <div class="group-title-wrap">
                        <div class="group-code-and-name">
                            <span class="group-code-tag">${code}</span>
                            <span class="group-name">${name}</span>
                            ${typeBadgeHtml}
                        </div>
                        <div class="group-meta-row">
                            <span class="group-tag credits">${credits} Tín chỉ</span>
                            ${isMandatory ? `• <span class="group-tag mandatory">Bắt buộc</span>` : ''}
                            • <span class="group-classes-count">${item.classes?.length || 0} lớp mở đợt này</span>
                        </div>
                    </div>
                </div>
                <div style="display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    <button type="button" class="btn btn-sm btn-outline" style="padding: 4px 10px; font-size: 12px; display: inline-flex; align-items: center; gap: 4px; border-radius: 6px; border: 1px solid #cbd5e1; background: #ffffff; color: #1e293b; font-weight: 500; cursor: pointer; transition: all 0.2s;" onclick="exportCourseClassesToExcel('${code}')" title="Xuất toàn bộ ca học của môn này ra file Excel">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2.5"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="8" y1="13" x2="16" y2="13"></line><line x1="8" y1="17" x2="16" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                        Xuất Excel
                    </button>
                    <div class="group-selection-pill" title="Có thể chọn nhiều lớp dự phòng, hệ thống sẽ đăng ký vào bất kỳ lớp nào còn slot">
                        ${pillText}
                    </div>
                </div>
            </div>
            <div class="course-classes-list" id="classes-list-${code}"></div>
        `;

        const listEl = groupCard.querySelector(`#classes-list-${code}`);

        if (classes.length === 0) {
            listEl.innerHTML = `<div style="padding: 20px; text-align: center; color: var(--text-secondary); font-size: 13px;">Không có lớp học phần nào phù hợp với bộ lọc hiện tại.</div>`;
        } else {
            classes.forEach(cls => {
                const isSelected = selectedIds.includes(String(cls.id));
                const cap = getCapacity(cls);
                const isFull = cap.hasRawData ? (cap.current >= cap.max) : (cap.percentage >= 100);

                // Conflict checking
                const conflictInfo = checkConflict(cls.scheduleDetails);
                const hasConflict = conflictInfo.conflict;

                // Capacity fill color
                let capColorClass = 'green';
                if (cap.percentage >= 100) capColorClass = 'red';
                else if (cap.percentage >= 80) capColorClass = 'orange';

                // Status Badge
                let statusBadgeHtml = '';
                if (isFull) {
                    const capLabel = cap.hasRawData ? `${cap.current}/${cap.max}` : `${cap.percentage}%`;
                    statusBadgeHtml = `<span class="class-status-badge full">🔒 Đầy (${capLabel})</span>`;
                } else if (hasConflict) {
                    statusBadgeHtml = `<span class="class-status-badge conflict">⚠️ Trùng lịch</span>`;
                } else {
                    statusBadgeHtml = `<span class="class-status-badge available">✓ Không trùng lịch</span>`;
                }

                // Schedule Details rows
                let scheduleRows = '';
                if (cls.scheduleDetails && cls.scheduleDetails.length > 0) {
                    scheduleRows = cls.scheduleDetails.map(s => {
                        const day = `Thứ ${s.thu}`;
                        const tiet = formatSessionTiet(s) || (s.tietHoc || s.tiet ? `Tiết ${s.tietHoc || s.tiet}` : '');
                        const room = [s.phong, s.dayNha].filter(Boolean).join(' - ') || 'Chưa xếp phòng';
                        const gv = s.giangVien || s.tenGiangVien || '';
                        const dateRange = (s.ngayBatDau && s.ngayKetThuc)
                            ? `${new Date(s.ngayBatDau).toLocaleDateString('vi-VN')} - ${new Date(s.ngayKetThuc).toLocaleDateString('vi-VN')}`
                            : '';

                        return `
                            <div class="class-detail-line">📅 <strong>${day}</strong> (${tiet})</div>
                            <div class="class-detail-line">📍 ${room}</div>
                            ${dateRange ? `<div class="class-detail-line">🕒 Tuần: ${dateRange}</div>` : ''}
                            ${gv ? `<div class="class-detail-line">👤 GV: ${gv}</div>` : ''}
                        `;
                    }).join('');
                } else {
                    scheduleRows = `<div class="class-detail-line">📅 ${cls.lichHoc || cls.tkb || 'Chưa có lịch'}</div>`;
                }

                const cardItem = document.createElement('div');
                cardItem.className = `class-card-item ${isSelected ? 'selected' : ''} ${hasConflict ? 'has-conflict' : ''}`;
                cardItem.onclick = (e) => {
                    onToggleClassForCourse(code, cls.id);
                };

                let selectBtnHtml = '';
                if (isSelected) {
                    selectBtnHtml = `<button type="button" class="btn-select-class selected" onclick="event.stopPropagation(); onToggleClassForCourse('${code}', '${cls.id}')">✓ Đã chọn</button>`;
                } else {
                    selectBtnHtml = `<button type="button" class="btn-select-class unselected" onclick="event.stopPropagation(); onToggleClassForCourse('${code}', '${cls.id}')">Chọn lớp này</button>`;
                }

                cardItem.innerHTML = `
                    <input type="checkbox" name="class-select-${code}" class="class-card-radio class-card-checkbox" ${isSelected ? 'checked' : ''}
                        onchange="onToggleClassForCourse('${code}', '${cls.id}')" onclick="event.stopPropagation()">
                    <div class="class-card-info">
                        <div class="class-info-header">
                            ${cls.maLopHocPhan ? `
                                <span class="class-hp-badge">Mã lớp HP: <strong style="color: #2563eb; font-size: 15.5px;">${cls.maLopHocPhan}</strong></span>
                                <span class="class-id-badge">ID lớp: ${cls.id}</span>
                            ` : `
                                <span class="class-hp-badge">ID lớp: <strong style="color: #2563eb; font-size: 15.5px;">${cls.id}</strong></span>
                            `}
                            ${statusBadgeHtml}
                        </div>
                        <div class="class-details-grid">
                            ${scheduleRows}
                        </div>
                    </div>
                    <div class="class-card-right">
                        <div class="capacity-progress-container">
                            <div class="capacity-progress-bar">
                                <div class="capacity-progress-fill ${capColorClass}" style="width: ${Math.min(cap.percentage, 100)}%;"></div>
                            </div>
                            <span class="capacity-text">${cap.hasRawData ? `${cap.current}/${cap.max}` : `${cap.percentage}%`}</span>
                        </div>
                        ${selectBtnHtml}
                    </div>
                `;

                listEl.appendChild(cardItem);
            });
        }

        container.appendChild(groupCard);
    });

    const pillEl = document.getElementById('step2-classes-pill');
    if (pillEl) pillEl.textContent = `${totalAvailableClasses} lớp khả dụng`;
}

// Toggle / Select a class for a given course in Step 2 (Supports multiple classes)
function onToggleClassForCourse(maHocPhan, classId) {
    const item = _selectedCourses.get(maHocPhan);
    if (!item) return;

    if (!item.selectedClassIds) {
        item.selectedClassIds = item.selectedClassId ? [String(item.selectedClassId)] : [];
    }

    const strId = String(classId);
    const idx = item.selectedClassIds.indexOf(strId);
    if (idx >= 0) {
        item.selectedClassIds.splice(idx, 1);
    } else {
        item.selectedClassIds.push(strId);
    }
    item.selectedClassId = item.selectedClassIds[0] || null;
    renderStep2();
}

function onSelectClassForCourse(maHocPhan, classId) {
    onToggleClassForCourse(maHocPhan, classId);
}

function onStep2FilterChange() {
    renderStep2Classes();
}

// Update Sticky Summary Bar at bottom of screen
function updateStickySummaryBar() {
    const currentCourses = Array.from(_selectedCourses.values());
    const selectedClassIds = [];
    let totalCredits = 0;

    currentCourses.forEach(item => {
        totalCredits += parseInt(item.course.soTinChi || item.course.tinChi || 0, 10) || 0;
        const ids = (item.selectedClassIds && item.selectedClassIds.length > 0)
            ? item.selectedClassIds
            : (item.selectedClassId ? [String(item.selectedClassId)] : []);
        ids.forEach(id => selectedClassIds.push(id));
    });

    const coursesEl = document.getElementById('summary-courses-count');
    const classesEl = document.getElementById('summary-classes-count');
    const idsTextEl = document.getElementById('summary-class-ids-text');
    const creditsPill = document.getElementById('summary-credits-pill');
    const conflictMsg = document.getElementById('summary-conflict-msg');

    if (coursesEl) coursesEl.textContent = currentCourses.length;
    if (classesEl) classesEl.textContent = selectedClassIds.length;
    if (idsTextEl) {
        idsTextEl.textContent = selectedClassIds.length > 0
            ? `(Mã: ${selectedClassIds.join(', ')})`
            : '(Chưa chọn)';
    }
    if (creditsPill) creditsPill.textContent = `${totalCredits} Tín chỉ`;

    if (conflictMsg) {
        conflictMsg.className = 'sticky-summary-sub success';
        conflictMsg.textContent = '✓ Tự động nhận diện API (Môn chính / Môn điều kiện) cho từng lớp học!';
    }
}

// Check mutual conflict between two class schedule arrays
function checkMutualConflict(schedA, schedB) {
    if (!schedA || !schedB || schedA.length === 0 || schedB.length === 0) return false;
    for (const a of schedA) {
        const thuA = parseInt(a.thu) || 0;
        const rangeA = parseTietRange(a.tietHoc || a.tiet);
        if (!rangeA) continue;
        const startA = a.ngayBatDau ? new Date(a.ngayBatDau) : null;
        const endA = a.ngayKetThuc ? new Date(a.ngayKetThuc) : null;

        for (const b of schedB) {
            const thuB = parseInt(b.thu) || 0;
            if (thuA !== thuB) continue;
            const rangeB = parseTietRange(b.tietHoc || b.tiet);
            if (!rangeB) continue;
            const startB = b.ngayBatDau ? new Date(b.ngayBatDau) : null;
            const endB = b.ngayKetThuc ? new Date(b.ngayKetThuc) : null;

            if (startA && endA && startB && endB) {
                if (endA < startB || startA > endB) continue;
            }

            if (rangeA.start <= rangeB.end && rangeA.end >= rangeB.start) {
                return true;
            }
        }
    }
    return false;
}

// ==================== Step 2 Direct Live Auto Register & Spam Request ====================
let _step2AutoRegisterRunning = false;
let _step2ModalLoopCount = 5000;
let _spamRequestCount = 0;
let _spamBaseDelay = 350;

function setSpamDelay(ms, btnEl) {
    _spamBaseDelay = parseInt(ms, 10) || 350;
    document.querySelectorAll('.spam-speed-btn').forEach(btn => {
        btn.classList.remove('active');
        btn.style.background = 'white';
        btn.style.color = '#334155';
        btn.style.borderColor = '#cbd5e1';
    });
    if (btnEl) {
        btnEl.classList.add('active');
        btnEl.style.background = '#2563eb';
        btnEl.style.color = 'white';
        btnEl.style.borderColor = '#2563eb';
    }
}

function getRandomSpamDelay() {
    // Tạo khoảng delay ngẫu nhiên (+- 25%) để mô phỏng người thật và tránh bị chặn
    const min = Math.max(80, Math.floor(_spamBaseDelay * 0.75));
    const max = Math.floor(_spamBaseDelay * 1.25);
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

window.setSpamDelay = setSpamDelay;
window.triggerAutoRegisterFromStep2 = triggerAutoRegisterFromStep2;
window.startAutoRegisterFromStep2 = triggerAutoRegisterFromStep2;
window.triggerScheduledRegisterFromStep2 = triggerScheduledRegisterFromStep2;
window.startSpamNowFromCountdown = startSpamNowFromCountdown;
window.cancelStep2Countdown = cancelStep2Countdown;
window.closeStep2AutoRegisterModal = closeStep2AutoRegisterModal;
window.stopStep2AutoRegister = stopStep2AutoRegister;
window.retryStep2AutoRegister = retryStep2AutoRegister;
window.onToggleClassForCourse = onToggleClassForCourse;

let _step2CountdownInterval = null;
let _step2TargetTimestamp = null;
let _step2WarmupDone = false;

async function triggerScheduledRegisterFromStep2() {
    try {
        if (!_selectedCourses || _selectedCourses.size === 0) {
            showToast('Vui lòng chọn ít nhất 1 môn học ở Bước 1 trước khi hẹn giờ!', 'warning');
            goToStep(1);
            return;
        }

        const timeInput = document.getElementById('step2-timer-time');
        const timeVal = timeInput ? timeInput.value : '';
        if (!timeVal) {
            showToast('Vui lòng chọn mốc thời gian hẹn giờ (VD: 08:59:58)', 'warning');
            return;
        }

        // Calculate target timestamp (today or tomorrow)
        const parts = timeVal.split(':').map(Number);
        const h = parts[0] || 0;
        const m = parts[1] || 0;
        const s = parts[2] || 0;

        const now = new Date();
        const target = new Date();
        target.setHours(h, m, s, 0);

        if (target.getTime() <= now.getTime()) {
            if (now.getTime() - target.getTime() < 5000) {
                // If within 5 seconds of the target time, start immediately
                triggerAutoRegisterFromStep2();
                return;
            } else {
                // Schedule for tomorrow if target time already passed today
                target.setDate(target.getDate() + 1);
            }
        }

        _step2TargetTimestamp = target.getTime();
        _step2WarmupDone = false;

        // Open Step 2 Live Auto Register Modal with Countdown Banner
        const modal = document.getElementById('step2-auto-register-modal');
        if (modal) {
            if (modal.parentElement !== document.body) {
                document.body.appendChild(modal);
            }
            modal.style.cssText = 'display: flex !important; opacity: 1 !important; visibility: visible !important; pointer-events: auto !important; z-index: 9999999 !important; position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100vw !important; height: 100vh !important; background: rgba(15, 23, 42, 0.75) !important; align-items: center !important; justify-content: center !important;';
            modal.classList.add('active', 'show');
        }

        _activeCourseGroups = [];
        _selectedCourses.forEach((item, code) => {
            let ids = [];
            if (Array.isArray(item.selectedClassIds) && item.selectedClassIds.length > 0) {
                ids = item.selectedClassIds.map(String);
            } else if (item.selectedClassId) {
                ids = [String(item.selectedClassId)];
            }

            // Chỉ thêm môn vào danh sách đăng ký nếu người dùng ĐÃ TỰ CHỌN ít nhất 1 lớp
            if (ids.length > 0) {
                _activeCourseGroups.push({
                    maHocPhan: code || item.course?.maHocPhan || '',
                    tenHocPhan: item.course?.tenHocPhan || item.course?.tenMonHoc || code || '',
                    soTinChi: item.course?.soTinChi || item.course?.tinChi || 0,
                    type: item.type || _activeCourseType || 'main',
                    classIds: [...ids],
                    status: 'waiting',
                    successfulClassId: null,
                    currentMsg: `⏳ Đang hẹn giờ kích hoạt lúc ${timeVal}`
                });
            }
        });

        if (_activeCourseGroups.length === 0) {
            showToast('Bạn chưa chọn lớp học phần nào ở Bước 2 để hẹn giờ đăng ký!', 'warning');
            return;
        }

        _spamRequestCount = 0;
        const countEl = document.getElementById('spam-request-count');
        if (countEl) countEl.textContent = '0';
        renderStep2ModalCourses();
        clearStep2ModalLogs();

        addStep2ModalLog(`⏰ ĐÃ THIẾT LẬP HẸN GIỜ ĐKHP VÀO LÚC ${target.toLocaleTimeString('vi-VN')} (${target.toLocaleDateString('vi-VN')})`, 'warning');
        addStep2ModalLog(`⏳ Hệ thống sẽ tự động đếm ngược và bắn request tốc độ cao đúng giây hẹn!`, 'info');

        const countdownBanner = document.getElementById('step2-countdown-banner');
        if (countdownBanner) countdownBanner.style.display = 'block';
        const targetLabel = document.getElementById('step2-target-time-label');
        if (targetLabel) targetLabel.textContent = `${target.toLocaleTimeString('vi-VN')} (${target.toLocaleDateString('vi-VN')})`;

        const bottomStatusEl = document.getElementById('spam-bottom-status');
        if (bottomStatusEl) {
            bottomStatusEl.style.color = '#b45309';
            bottomStatusEl.textContent = `⏳ Đang hẹn giờ lúc ${timeVal}...`;
        }

        // Prefetch classes if not loaded yet
        let needsLoad = false;
        _selectedCourses.forEach((item) => {
            if (!item.classes || item.classes.length === 0) {
                needsLoad = true;
            }
        });

        if (needsLoad) {
            addStep2ModalLog('Đang tải danh sách các lớp mở cho môn học...', 'info');
            loadClassesForSelectedCourses().then(() => {
                renderStep2ModalCourses();
            }).catch(() => {});
        }

        if (_step2CountdownInterval) clearInterval(_step2CountdownInterval);
        _step2CountdownInterval = setInterval(updateStep2CountdownTick, 250);
        updateStep2CountdownTick();
    } catch (err) {
        console.error('Lỗi khi hẹn giờ ĐKHP:', err);
        showToast('Lỗi: ' + (err.message || err), 'error');
    }
}

function updateStep2CountdownTick() {
    if (!_step2TargetTimestamp) {
        if (_step2CountdownInterval) clearInterval(_step2CountdownInterval);
        return;
    }

    const now = Date.now();
    const diff = _step2TargetTimestamp - now;

    if (diff <= 0) {
        // Target time reached!
        if (_step2CountdownInterval) clearInterval(_step2CountdownInterval);
        _step2CountdownInterval = null;
        _step2TargetTimestamp = null;

        const countdownBanner = document.getElementById('step2-countdown-banner');
        if (countdownBanner) countdownBanner.style.display = 'none';

        addStep2ModalLog(`⏰ ĐÃ ĐẾN GIỜ HẸN! TỰ ĐỘNG BẮN REQUEST SPAM NGAY LẬP TỨC 🚀`, 'success');
        showToast(`⏰ ĐÃ ĐẾN GIỜ HẸN! Đang kích hoạt spam request...`, 'success');
        runStep2LiveAutoRegister();
        return;
    }

    // Warm-up check (30 seconds before target)
    if (diff <= 30000 && !_step2WarmupDone) {
        _step2WarmupDone = true;
        addStep2ModalLog('⚡ [Warm-up] Chuẩn bị trước 30s: Đang kiểm tra làm mới phiên đăng nhập để sẵn sàng...', 'info');
        api.validateSession().then(res => {
            if (res && res.success) {
                addStep2ModalLog('✅ [Warm-up] Phiên kết nối và Token đã sẵn sàng 100%!', 'success');
            }
        }).catch(() => {});
    }

    // Format remaining time hh:mm:ss.s
    const totalSeconds = Math.floor(diff / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const mins = Math.floor((totalSeconds % 3600) / 60);
    const secs = totalSeconds % 60;
    const ms = Math.floor((diff % 1000) / 100);

    const timeStr = `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${ms}`;
    const cdEl = document.getElementById('step2-countdown-time');
    if (cdEl) cdEl.textContent = timeStr;
}

function startSpamNowFromCountdown() {
    if (_step2CountdownInterval) clearInterval(_step2CountdownInterval);
    _step2CountdownInterval = null;
    _step2TargetTimestamp = null;
    const countdownBanner = document.getElementById('step2-countdown-banner');
    if (countdownBanner) countdownBanner.style.display = 'none';
    addStep2ModalLog('⚡ Người dùng chọn bắn request ngay lập tức!', 'info');
    runStep2LiveAutoRegister();
}

function cancelStep2Countdown() {
    if (_step2CountdownInterval) clearInterval(_step2CountdownInterval);
    _step2CountdownInterval = null;
    _step2TargetTimestamp = null;
    const countdownBanner = document.getElementById('step2-countdown-banner');
    if (countdownBanner) countdownBanner.style.display = 'none';
    addStep2ModalLog('🛑 Đã hủy hẹn giờ.', 'warning');
    const bottomStatusEl = document.getElementById('spam-bottom-status');
    if (bottomStatusEl) {
        bottomStatusEl.style.color = '#475569';
        bottomStatusEl.textContent = 'Đã hủy hẹn giờ';
    }
}

async function triggerAutoRegisterFromStep2() {
    try {
        if (!_selectedCourses || _selectedCourses.size === 0) {
            showToast('Vui lòng chọn ít nhất 1 môn học ở Bước 1 trước khi đăng ký!', 'warning');
            goToStep(1);
            return;
        }

        // Cancel any existing countdown if user clicked run immediately
        if (_step2CountdownInterval) {
            clearInterval(_step2CountdownInterval);
            _step2CountdownInterval = null;
            _step2TargetTimestamp = null;
        }
        const countdownBanner = document.getElementById('step2-countdown-banner');
        if (countdownBanner) countdownBanner.style.display = 'none';

        // Open Step 2 Live Auto Register Modal (Spam Request UI) IMMEDIATELY for instant feedback
        const modal = document.getElementById('step2-auto-register-modal');
        if (modal) {
            if (modal.parentElement !== document.body) {
                document.body.appendChild(modal);
            }
            modal.style.cssText = 'display: flex !important; opacity: 1 !important; visibility: visible !important; pointer-events: auto !important; z-index: 9999999 !important; position: fixed !important; top: 0 !important; left: 0 !important; right: 0 !important; bottom: 0 !important; width: 100vw !important; height: 100vh !important; background: rgba(15, 23, 42, 0.75) !important; align-items: center !important; justify-content: center !important;';
            modal.classList.add('active', 'show');
        }

        _activeCourseGroups = [];

        _selectedCourses.forEach((item, code) => {
            let ids = [];
            if (Array.isArray(item.selectedClassIds) && item.selectedClassIds.length > 0) {
                ids = item.selectedClassIds.map(String);
            } else if (item.selectedClassId) {
                ids = [String(item.selectedClassId)];
            }

            // Chỉ thêm môn vào danh sách đăng ký nếu người dùng ĐÃ TỰ CHỌN ít nhất 1 lớp
            if (ids.length > 0) {
                _activeCourseGroups.push({
                    maHocPhan: code || item.course?.maHocPhan || '',
                    tenHocPhan: item.course?.tenHocPhan || item.course?.tenMonHoc || code || '',
                    soTinChi: item.course?.soTinChi || item.course?.tinChi || 0,
                    type: item.type || _activeCourseType || 'main',
                    classIds: [...ids],
                    status: 'waiting',
                    successfulClassId: null,
                    currentMsg: 'Đang chuẩn bị gửi request...'
                });
            }
        });

        if (_activeCourseGroups.length === 0) {
            showToast('Bạn chưa chọn lớp học phần nào ở Bước 2 để bắt đầu đăng ký!', 'warning');
            return;
        }

        _spamRequestCount = 0;
        const countEl = document.getElementById('spam-request-count');
        if (countEl) countEl.textContent = '0';
        renderStep2ModalCourses();
        clearStep2ModalLogs();

        // Check if classes need to be loaded
        let needsLoad = false;
        _selectedCourses.forEach((item) => {
            if (!item.classes || item.classes.length === 0) {
                needsLoad = true;
            }
        });

        if (needsLoad) {
            addStep2ModalLog('Đang tải danh sách các lớp mở cho môn học...', 'info');
            try {
                await loadClassesForSelectedCourses();
                renderStep2ModalCourses();
            } catch (err) {
                console.error('Lỗi khi tải danh sách lớp:', err);
            }
        }

        if (_activeCourseGroups.length === 0 || _activeCourseGroups.every(g => g.classIds.length === 0)) {
            showToast('Vui lòng tích chọn ít nhất 1 lớp học phần ở Bước 2 để đăng ký!', 'warning');
            addStep2ModalLog('❌ Chưa có lớp học phần nào được chọn.', 'error');
            return;
        }

        runStep2LiveAutoRegister();
    } catch (err) {
        console.error('Lỗi khởi động đăng ký:', err);
        showToast('Lỗi: ' + (err.message || err), 'error');
    }
}

function closeStep2AutoRegisterModal() {
    if (_step2AutoRegisterRunning) {
        stopStep2AutoRegister();
    }
    if (_step2CountdownInterval) {
        clearInterval(_step2CountdownInterval);
        _step2CountdownInterval = null;
        _step2TargetTimestamp = null;
    }
    const modal = document.getElementById('step2-auto-register-modal');
    if (modal) {
        modal.classList.remove('active', 'show');
        modal.style.display = 'none';
    }
}

function renderStep2ModalCourses() {
    const listEl = document.getElementById('spam-courses-list');
    if (!listEl) return;
    listEl.innerHTML = '';

    _activeCourseGroups.forEach((g) => {
        let msg = g.currentMsg || 'Đang chuẩn bị gửi request...';
        let color = '#334155';
        let icon = '';

        if (g.status === 'success') {
            msg = `✓ Đã đăng ký thành công lớp ${g.successfulClassId}! (Đã hoàn thành)`;
            color = '#15803d';
            icon = '🎉 ';
        } else if (g.status === 'running') {
            color = '#2563eb';
        }

        // Tự động tìm tên môn học chính xác nếu chưa có
        let courseName = g.tenHocPhan;
        if (!courseName || courseName === g.maHocPhan) {
            const found = _mainCoursesData.find(c => String(c.maHocPhan).trim() === String(g.maHocPhan).trim())
                || _extraCoursesData.find(c => String(c.maHocPhan).trim() === String(g.maHocPhan).trim());
            if (found) {
                courseName = found.tenHocPhan || found.tenMonHoc || '';
                g.tenHocPhan = courseName;
            }
        }

        const rowEl = document.createElement('div');
        rowEl.id = `spam-course-row-${g.maHocPhan}`;
        rowEl.style.cssText = `
            display: flex;
            justify-content: space-between;
            align-items: center;
            border-bottom: 1px dashed #e2e8f0;
            padding: 8px 4px;
            font-size: 13px;
            gap: 12px;
            ${g.status === 'success' ? 'background: #f0fdf4; border-radius: 6px; padding-left: 8px; padding-right: 8px;' : ''}
        `;

        const typeBadge = g.type === 'extra'
            ? '<span style="background:#ecfdf5;color:#059669;font-size:10px;font-weight:700;padding:2px 5px;border-radius:4px;border:1px solid #a7f3d0;white-space:nowrap;">📗 Điều kiện</span>'
            : '<span style="background:#eff6ff;color:#2563eb;font-size:10px;font-weight:700;padding:2px 5px;border-radius:4px;border:1px solid #bfdbfe;white-space:nowrap;">📘 Chính</span>';

        rowEl.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 2px; min-width: 170px; max-width: 46%;">
                <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                    <span style="font-weight: 700; color: #1e293b; font-family: monospace; font-size: 13.5px;">${g.maHocPhan}</span>
                    ${typeBadge}
                </div>
                ${courseName ? `<div style="font-size: 12px; font-weight: 600; color: #475569; line-height: 1.3;" title="${courseName}">${courseName}</div>` : ''}
            </div>
            <span id="spam-row-msg-${g.maHocPhan}" style="color: ${color}; font-weight: ${g.status === 'success' ? '700' : '500'}; text-align: right; flex: 1; line-height: 1.4;">
                ${icon}${msg}
            </span>
        `;
        listEl.appendChild(rowEl);
    });
}

function updateCourseSpamMsg(maHocPhan, msg, color = '#334155', isSuccess = false) {
    const msgEl = document.getElementById(`spam-row-msg-${maHocPhan}`);
    if (msgEl) {
        msgEl.style.color = color;
        msgEl.textContent = msg;
        if (isSuccess) {
            msgEl.style.fontWeight = '700';
            const rowEl = document.getElementById(`spam-course-row-${maHocPhan}`);
            if (rowEl) {
                rowEl.style.background = '#f0fdf4';
                rowEl.style.borderRadius = '6px';
                rowEl.style.paddingLeft = '8px';
                rowEl.style.paddingRight = '8px';
            }
        }
    }
}

function clearStep2ModalLogs() {
    const box = document.getElementById('step2-modal-log-box');
    if (box) box.innerHTML = '';
}

function addStep2ModalLog(message, type = 'info') {
    const box = document.getElementById('step2-modal-log-box');
    if (!box) return;

    const time = new Date().toLocaleTimeString('vi-VN');
    const logItem = document.createElement('div');
    logItem.style.marginBottom = '4px';

    let color = '#e2e8f0';
    if (type === 'success') color = '#4ade80';
    else if (type === 'error') color = '#f87171';
    else if (type === 'warning') color = '#fbbf24';

    logItem.innerHTML = `<span style="color:#64748b;">[${time}]</span> <span style="color:${color};">${message}</span>`;
    box.appendChild(logItem);
    box.scrollTop = box.scrollHeight;
}

async function runStep2LiveAutoRegister() {
    _step2AutoRegisterRunning = true;

    const stopBtn = document.getElementById('step2-modal-stop-btn');
    if (stopBtn) stopBtn.style.display = 'inline-block';
    const retryBtn = document.getElementById('step2-modal-retry-btn');
    if (retryBtn) retryBtn.style.display = 'none';

    const countEl = document.getElementById('spam-request-count');
    const bottomStatusEl = document.getElementById('spam-bottom-status');
    if (bottomStatusEl) {
        bottomStatusEl.style.color = '#2563eb';
        bottomStatusEl.textContent = 'Đang spam request các lớp học...';
    }

    addStep2ModalLog(`🚀 Bắt đầu spam request cho ${_activeCourseGroups.length} môn học đã chọn (Delay ngẫu nhiên)...`, 'info');

    let iteration = 0;
    const maxLoop = _step2ModalLoopCount;

    while (iteration < maxLoop && _step2AutoRegisterRunning) {
        // Chỉ lấy những môn CHƯA thành công (môn đã thành công sẽ tự động bị loại bỏ)
        const pendingGroups = _activeCourseGroups.filter(g => g.status !== 'success');
        if (pendingGroups.length === 0) {
            break;
        }

        iteration++;
        addStep2ModalLog(`===== Vòng spam ${iteration}/${maxLoop} (Còn ${pendingGroups.length} môn chưa xong) =====`, 'info');

        for (const group of pendingGroups) {
            if (!_step2AutoRegisterRunning) break;
            if (group.status === 'success') continue;

            group.status = 'running';

            for (const classId of group.classIds) {
                if (!_step2AutoRegisterRunning) break;
                if (group.status === 'success') break;

                // Increment request counter
                _spamRequestCount++;
                if (countEl) countEl.textContent = _spamRequestCount;

                const attemptMsg = `Đang gửi request đăng ký lớp ${classId}...`;
                group.currentMsg = attemptMsg;
                updateCourseSpamMsg(group.maHocPhan, attemptMsg, '#2563eb');
                addStep2ModalLog(`🔄 [${group.maHocPhan}] Thử lớp ${classId} (${group.tenHocPhan})...`, 'info');

                let result;
                try {
                    if (group.type === 'extra') {
                        result = await api.registerExtraClass(classId);
                    } else {
                        result = await api.registerMainClass(classId);
                    }
                } catch (err) {
                    result = { success: false, message: err.message || 'Lỗi kết nối' };
                }

                if (result && result.success) {
                    group.status = 'success';
                    group.successfulClassId = String(classId);
                    const succMsg = `✓ Đã đăng ký thành công lớp ${classId}! (Tự động loại bỏ khỏi hàng đợi)`;
                    group.currentMsg = succMsg;
                    updateCourseSpamMsg(group.maHocPhan, succMsg, '#15803d', true);
                    
                    // Thông báo âm thanh & Toast
                    if (typeof playSuccessSound === 'function') playSuccessSound();
                    showToast(`🎉 THÀNH CÔNG: [${group.maHocPhan}] ${group.tenHocPhan} đã vào lớp ${classId}! Tự động loại môn này khỏi vòng spam.`, 'success');
                    addStep2ModalLog(`🎉 THÀNH CÔNG: [${group.maHocPhan}] ${group.tenHocPhan} đã vào lớp ${classId}! Đã loại khỏi danh sách spam.`, 'success');
                    
                    if (typeof updateRegisteredSchedules === 'function') updateRegisteredSchedules();
                    if (typeof loadRegisteredCourses === 'function') loadRegisteredCourses();
                    
                    // Ngắt môn này ngay để chuyển sang spam các môn tiếp theo còn lại
                    break;
                } else {
                    const rawMsg = (result && result.message) ? result.message : 'Chưa có chỗ';
                    const failMsg = `Lớp ${classId}: ${rawMsg}`;
                    group.currentMsg = failMsg;
                    updateCourseSpamMsg(group.maHocPhan, failMsg, '#dc2626');
                    addStep2ModalLog(`❌ [${group.maHocPhan}] Lớp ${classId}: ${rawMsg}`, 'error');
                }

                // Delay ngẫu nhiên giữa các request
                const delayMs = getRandomSpamDelay();
                await new Promise(r => setTimeout(r, delayMs));
            }

            if (group.status !== 'success') {
                group.status = 'waiting';
            }
        }

        // Delay ngẫu nhiên giữa các vòng lặp
        if (_step2AutoRegisterRunning && _activeCourseGroups.some(g => g.status !== 'success')) {
            const loopDelay = getRandomSpamDelay();
            await new Promise(r => setTimeout(r, loopDelay));
        }
    }

    _step2AutoRegisterRunning = false;
    if (stopBtn) stopBtn.style.display = 'none';

    const allSuccess = _activeCourseGroups.every(g => g.status === 'success');
    if (allSuccess) {
        if (bottomStatusEl) {
            bottomStatusEl.innerHTML = '<span style="color: #15803d;">🎉 ĐÃ ĐĂNG KÝ THÀNH CÔNG TẤT CẢ CÁC MÔN HỌC!</span>';
        }
        addStep2ModalLog('🏆 CHÚC MỪNG! ĐÃ ĐĂNG KÝ THÀNH CÔNG TOÀN BỘ DANH SÁCH MÔN HỌC!', 'success');
    } else {
        if (bottomStatusEl) {
            bottomStatusEl.innerHTML = '<span style="color: #475569;">Đã tạm dừng spam</span>';
        }
        if (retryBtn) retryBtn.style.display = 'inline-block';
        addStep2ModalLog(`⚠️ Đã dừng spam. Bấm "Tiếp tục spam" để tiếp tục săn slot.`, 'warning');
    }
}

function stopStep2AutoRegister() {
    _step2AutoRegisterRunning = false;
    addStep2ModalLog('🛑 Đã nhận lệnh dừng spam từ người dùng.', 'warning');
    const stopBtn = document.getElementById('step2-modal-stop-btn');
    if (stopBtn) stopBtn.style.display = 'none';
    const retryBtn = document.getElementById('step2-modal-retry-btn');
    if (retryBtn) retryBtn.style.display = 'inline-block';
}

function retryStep2AutoRegister() {
    runStep2LiveAutoRegister();
}


// Seamless Link from "Xem trước TKB tuần" directly into Future Schedule Planner
function openWeeklySchedulePreviewModal() {
    const selectedList = [];

    _selectedCourses.forEach((item, code) => {
        const ids = (item.selectedClassIds && item.selectedClassIds.length > 0)
            ? item.selectedClassIds.map(String)
            : (item.selectedClassId ? [String(item.selectedClassId)] : []);

        ids.forEach(classId => {
            const cls = (item.classes || []).find(c => String(c.id) === String(classId));
            if (cls) {
                selectedList.push({
                    id: String(cls.id),
                    maHocPhan: code,
                    tenLopHocPhan: cls.tenLopHocPhan || `Lớp ${cls.id}`,
                    maLopHocPhan: cls.maLopHocPhan || '',
                    tenHocPhan: item.course.tenHocPhan || item.course.tenMonHoc || code,
                    scheduleDetails: cls.scheduleDetails || [],
                    checked: true,
                    type: item.type || _activeCourseType || 'main',
                    siSoHienTai: cls.siSoHienTai || 0,
                    siSoMax: cls.siSoMax || 0
                });
            }
        });
    });

    if (selectedList.length === 0) {
        showToast('Vui lòng chọn ít nhất một lớp học phần để xem lịch!', 'warning');
        return;
    }

    // Merge into previewClasses without duplicates
    selectedList.forEach(newCls => {
        const idx = previewClasses.findIndex(c => String(c.id) === String(newCls.id));
        if (idx >= 0) {
            previewClasses[idx] = newCls;
        } else {
            previewClasses.push(newCls);
        }
    });

    // Populate future-input textarea in "Lịch dự kiến"
    const futureInput = document.getElementById('future-input');
    if (futureInput) {
        const allIds = previewClasses.filter(c => c.checked).map(c => c.id);
        futureInput.value = allIds.join('\n');
    }

    // Switch to tab 'future-schedule'
    switchTab('future-schedule');

    // Update timetable phase & render visual timetable
    renderPlannerChecklist();
    renderVisualTimetable();

    showToast(`Đã nạp ${selectedList.length} lớp sang Lịch dự kiến & hiển thị TKB tuần!`, 'success');
}



function exportCourses() {
    if ((!_mainCoursesData || _mainCoursesData.length === 0) && (!_extraCoursesData || _extraCoursesData.length === 0)) {
        showToast('Chưa có dữ liệu để xuất. Hãy nhấn "Kiểm tra môn học" trước!', 'error');
        return;
    }

    // Create workbook using SheetJS
    const wb = XLSX.utils.book_new();
    const dateStr = new Date().toISOString().split('T')[0];

    // Main courses sheet
    if (_mainCoursesData && _mainCoursesData.length > 0) {
        const mainData = [
            ['DANH SÁCH MÔN HỌC CHÍNH'],
            ['Ngày xuất:', new Date().toLocaleDateString('vi-VN'), '', 'Tổng số môn:', _mainCoursesData.length],
            [],
            ['STT', 'Mã HP', 'Tên học phần', 'Số TC', 'Bắt buộc']
        ];
        _mainCoursesData.forEach((course, idx) => {
            mainData.push([
                idx + 1,
                course.maHocPhan || '',
                course.tenHocPhan || course.tenMonHoc || '',
                course.soTinChi || '',
                course.batBuoc ? 'Có' : 'Không'
            ]);
        });
        const wsMain = XLSX.utils.aoa_to_sheet(mainData);
        wsMain['!cols'] = [{ wch: 6 }, { wch: 18 }, { wch: 45 }, { wch: 10 }, { wch: 12 }];
        for (let i = 5; i <= mainData.length; i++) {
            const cell = wsMain['B' + i];
            if (cell) cell.t = 's';
        }
        XLSX.utils.book_append_sheet(wb, wsMain, 'Môn chính');
    }

    // Extra courses sheet
    if (_extraCoursesData && _extraCoursesData.length > 0) {
        const extraData = [
            ['DANH SÁCH MÔN HỌC ĐIỀU KIỆN / PHỤ'],
            ['Ngày xuất:', new Date().toLocaleDateString('vi-VN'), '', 'Tổng số môn:', _extraCoursesData.length],
            [],
            ['STT', 'Mã HP', 'Tên học phần', 'Số TC']
        ];
        _extraCoursesData.forEach((course, idx) => {
            extraData.push([
                idx + 1,
                course.maHocPhan || '',
                course.tenHocPhan || course.tenMonHoc || '',
                course.soTinChi || ''
            ]);
        });
        const wsExtra = XLSX.utils.aoa_to_sheet(extraData);
        wsExtra['!cols'] = [{ wch: 6 }, { wch: 18 }, { wch: 45 }, { wch: 10 }];
        for (let i = 5; i <= extraData.length; i++) {
            const cell = wsExtra['B' + i];
            if (cell) cell.t = 's';
        }
        XLSX.utils.book_append_sheet(wb, wsExtra, 'Môn điều kiện');
    }

    XLSX.writeFile(wb, `Danh_Sach_Mon_Hoc_${dateStr}.xlsx`);
    showToast('Đã xuất danh sách môn học thành công!', 'success');
}

// ==================== Classes (Tab 3 & 4) ====================
async function loadClasses(type = 'main') {
    const idDot = getIdDot();
    const maHocPhan = type === 'main'
        ? document.getElementById('filter-ma-hp').value.trim()
        : document.getElementById('extra-ma-hp').value.trim();

    if (!maHocPhan) {
        showToast('Vui lòng nhập mã học phần', 'error');
        return;
    }

    const resolvedTenHP = getCourseNameByCode(maHocPhan);
    currentInlineCourse = { maHocPhan, tenHocPhan: resolvedTenHP, type };

    updateStatus('Đang tải danh sách lớp...');

    let result;
    if (type === 'main') {
        result = await api.getMainClasses(idDot, maHocPhan);
    } else if (type === 'extra') {
        result = await api.getExtraClasses(idDot, maHocPhan);
    } else {
        result = await api.getImprovementClasses(idDot, maHocPhan);
    }

    if (!result.success) {
        if (result.message && (result.message.includes('401') || result.message.includes('status code 401') || result.message.includes('Vui lòng đăng nhập'))) {
            showToast('Phiên đăng nhập hết hạn. Vui lòng đăng nhập lại!', 'error');
            updateStatus('Hết phiên đăng nhập');
        } else {
            showToast(result.message || 'Không thể tải danh sách lớp', 'error');
            updateStatus('Lỗi');
        }
        return;
    }

    const classes = result.data || [];
    classes.forEach(c => {
        if (!c.tenHocPhan && resolvedTenHP) c.tenHocPhan = resolvedTenHP;
        if (!c.maHocPhan && maHocPhan) c.maHocPhan = maHocPhan;
    });

    // Apply filters
    const filteredClasses = filterClasses(classes, type);

    // Store data
    if (type === 'main') {
        classesData = filteredClasses;
        renderClassesTable('classes-table', filteredClasses);
    } else if (type === 'extra') {
        extraClassesData = filteredClasses;
        renderClassesTable('extra-classes-table', filteredClasses);
    } else {
        improvementClassesData = filteredClasses;
        renderClassesTable('improvement-classes-table', filteredClasses);
    }

    updateStatus(`Tìm thấy ${filteredClasses.length} lớp`);
    showToast(`Tìm thấy ${filteredClasses.length} lớp`, 'success');
}

function filterClasses(classes, type) {
    const daySelector = type === 'main' ? '.filter-day:checked' : '.extra-filter-day:checked';
    const lessonSelector = type === 'main' ? '.filter-lesson:checked' : '.extra-filter-lesson:checked';

    const selectedDays = Array.from(document.querySelectorAll(daySelector)).map(cb => cb.value);
    const selectedLessons = Array.from(document.querySelectorAll(lessonSelector)).map(cb => cb.value);

    if (selectedDays.length === 0 && selectedLessons.length === 0) {
        return classes;
    }

    return classes.filter(cls => {
        const schedule = cls.lichHoc || cls.tkb || '';

        // Check day filter
        if (selectedDays.length > 0) {
            const dayMatch = selectedDays.some(day => {
                const dayNum = day === '8' ? 'CN' : `T${day}`;
                return schedule.includes(dayNum) || schedule.includes(`Thứ ${day}`);
            });
            if (!dayMatch) return false;
        }

        // Check lesson filter
        if (selectedLessons.length > 0) {
            const lessonMatch = selectedLessons.some(lesson => {
                return schedule.includes(lesson);
            });
            if (!lessonMatch) return false;
        }

        return true;
    });
}

function getCapacity(cls) {
    // Try multiple possible field names
    const current = cls.siSoHienTai || cls.soLuongDangKy || cls.daDangKy || cls.soLuongDaDangKy || 0;
    const max = cls.siSoMax || cls.soLuongDuKien || cls.siSo || cls.soLuong || 0;

    let percentage = 0;
    let hasRawData = false;

    if (max > 0) {
        percentage = Math.round((current / max) * 100);
        hasRawData = true;
    } else if (cls.phanTramDangKy !== undefined && cls.phanTramDangKy !== null) {
        // API provides percentage directly
        percentage = parseFloat(cls.phanTramDangKy);
    }

    return { current, max, percentage, hasRawData };
}

function renderClassesTable(tableId, classes, overrideType = null) {
    const tbody = document.querySelector(`#${tableId} tbody`);
    tbody.innerHTML = '';

    const isInlineTable = tableId === 'inline-classes-table';
    const hideConflict = isInlineTable && (document.getElementById('filter-conflict-checkbox')?.checked || false);

    classes.forEach((cls, index) => {
        if (index === 0) console.log('First Class Data:', cls); // Log first item to debug

        let conflictInfo = { conflict: false };
        if (isInlineTable && cls.scheduleDetails) {
            conflictInfo = checkConflict(cls.scheduleDetails);
        }

        // If filtering conflicts and this class has a conflict, skip it
        if (hideConflict && conflictInfo.conflict) {
            return;
        }

        const row = document.createElement('tr');
        if (conflictInfo.conflict) {
            row.style.backgroundColor = '#fff0f0'; // Subtle red background for conflicting rows
        }

        const { current, max, percentage, hasRawData } = getCapacity(cls);
        const isFull = hasRawData ? (current >= max) : (percentage >= 100);

        const type = overrideType || (tableId.includes('extra') ? 'extra' : tableId.includes('improvement') ? 'improvement' : 'main');

        // Format schedule text from details if available
        let scheduleHtmlContent = '';
        if (cls.scheduleDetails && cls.scheduleDetails.length > 0) {
            scheduleHtmlContent = cls.scheduleDetails.map((item, idx) => {
                const typeText = item.loaiLich || item.loaiHocPhan || 'LT';
                const isTH = typeText.toUpperCase().includes('TH');
                const badgeBg = isTH ? '#f59e0b' : '#3b82f6';
                const dayText = `Thứ ${item.thu}`;
                const tietText = `Tiết ${item.tietHoc || item.tiet}`;

                const startStr = item.ngayBatDau ? new Date(item.ngayBatDau).toLocaleDateString('vi-VN') : '';
                const endStr = item.ngayKetThuc ? new Date(item.ngayKetThuc).toLocaleDateString('vi-VN') : '';
                const dateText = startStr && endStr ? `${startStr} - ${endStr}` : '';

                const roomText = [item.phong, item.dayNha].filter(Boolean).join(' - ');
                const borderStyle = idx < cls.scheduleDetails.length - 1 ? 'border-bottom: 1px dashed var(--border-color);' : '';

                return `
                    <div style="padding: 4px 0; font-size: 13px; line-height: 1.4; ${borderStyle}">
                        <div style="display: flex; align-items: center; gap: 6px; flex-wrap: wrap;">
                            <span style="background-color: ${badgeBg}; color: white; padding: 2px 6px; font-size: 10px; font-weight: bold; border-radius: 4px; display: inline-block;">${typeText}</span>
                            <span style="font-weight: 600; color: var(--text-primary);">${dayText} (${tietText})</span>
                        </div>
                        <div style="color: var(--text-secondary); font-size: 11px; margin-top: 3px; display: flex; flex-direction: column; gap: 2px;">
                            ${dateText ? `<div>📅 <strong>Thời gian:</strong> ${dateText}</div>` : ''}
                            ${roomText ? `<div>📍 <strong>Phòng:</strong> ${roomText}</div>` : ''}
                        </div>
                    </div>
                `;
            }).join('');
        } else {
            scheduleHtmlContent = `<span style="font-weight: 500;">${cls.lichHoc || cls.tkb || ''}</span>`;
        }

        // Conflict warning text
        let conflictHtml = '';
        if (conflictInfo.conflict) {
            conflictHtml = `<div style="color: #d32f2f; font-weight: 500; font-size: 11px; margin-top: 4px;" title="Trùng lịch với lớp ${conflictInfo.conflictingClass} của môn ${conflictInfo.conflictingCourse}">⚠️ Trùng: ${conflictInfo.conflictingCourse} (${conflictInfo.conflictingSchedule})</div>`;
        }

        row.innerHTML = `
            <td><input type="checkbox" value="${cls.id}" ${isFull ? 'disabled' : ''}></td>
            <td>${cls.id || ''}</td>
            <td>${cls.tenLopHocPhan || cls.maLopHocPhan || ''}</td>
            <td>
                <div style="display: flex; flex-direction: column; gap: 4px;">
                    ${scheduleHtmlContent}
                    <div style="margin-top: 2px;">
                        <button class="btn-icon" onclick="viewClassDetail('${cls.id}', '${type}', '${encodeURIComponent(JSON.stringify(cls))}')" title="Xem chi tiết" style="padding: 2px 6px; font-size: 12px; height: auto;">
                            📅 Chi tiết
                        </button>
                    </div>
                    ${conflictHtml}
                </div>
            </td>
            <td>
                ${hasRawData ? `${current}/${max}` : ''}
                <span style="${hasRawData ? 'font-size: 0.85em; color: #6c757d;' : 'font-weight: bold; color: #0d6efd;'}">
                    ${hasRawData ? `(${percentage}%)` : `${percentage}%`}
                </span>
            </td>
            <td class="${isFull ? 'text-danger' : 'text-success'}">${isFull ? 'Đầy' : 'Còn chỗ'}</td>
            <td>
                <button class="btn btn-sm btn-primary" onclick="registerSingleClass('${cls.id}', '${type}')" ${conflictInfo.conflict ? 'style="background-color: #d32f2f; border-color: #d32f2f;"' : ''}>
                    ${conflictInfo.conflict ? 'Trùng lịch' : 'Đăng ký'}
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function registerSingleClass(classId, type) {
    updateStatus(`Đang đăng ký lớp ${classId}...`);

    let result;
    if (type === 'main') {
        result = await api.registerMainClass(classId);
    } else if (type === 'extra') {
        result = await api.registerExtraClass(classId);
    } else {
        result = await api.registerImprovementClass(classId);
    }

    if (result.success) {
        showToast(`Đăng ký thành công: ${result.message}`, 'success');
        playSuccessSound();
        updateRegisteredSchedules(); // Update schedules
    } else {
        showToast(`Thất bại: ${result.message}`, 'error');
    }

    updateStatus('Sẵn sàng');
}

async function autoRegisterClass(type) {
    const tableId = type === 'main' ? 'classes-table' : 'extra-classes-table';
    const selectedIds = Array.from(document.querySelectorAll(`#${tableId} tbody input[type="checkbox"]:checked`))
        .map(cb => cb.value);

    if (selectedIds.length === 0) {
        showToast('Vui lòng chọn ít nhất một lớp', 'error');
        return;
    }

    // Fill class IDs to tab 1 and switch
    document.getElementById('class-ids').value = selectedIds.join('\n');
    document.getElementById('register-type').value = type;
    switchTab('register');
    showToast('Đã điền ID lớp, nhấn "Bắt đầu" để đăng ký', 'info');
}

function clearAutoLog() {
    document.getElementById('auto-register-log').innerHTML = '';
}

function clearExtraLog() {
    document.getElementById('extra-log').innerHTML = '';
}

// Export main classes to Excel
function exportMainClasses() {
    if (!classesData || classesData.length === 0) {
        showToast('Chưa có dữ liệu lớp. Hãy nhấn "Xem lớp" trước!', 'error');
        return;
    }
    const maHP = currentInlineCourse.maHocPhan || document.getElementById('filter-ma-hp')?.value.trim() || '';
    const tenHP = currentInlineCourse.tenHocPhan || getCourseNameByCode(maHP);
    exportClassesToExcel(classesData, maHP || 'lop_mon_chinh', 'main', tenHP);
}

// Export extra classes to Excel
function exportExtraClasses() {
    if (!extraClassesData || extraClassesData.length === 0) {
        showToast('Chưa có dữ liệu lớp. Hãy nhấn "Xem lớp" trước!', 'error');
        return;
    }
    const maHP = currentInlineCourse.maHocPhan || document.getElementById('extra-ma-hp')?.value.trim() || '';
    const tenHP = currentInlineCourse.tenHocPhan || getCourseNameByCode(maHP);
    exportClassesToExcel(extraClassesData, maHP || 'lop_mon_phu', 'extra', tenHP);
}

// Export all classes and session schedules of a specific course in Step 2
async function exportCourseClassesToExcel(courseCode) {
    const item = _selectedCourses.get(courseCode);
    if (!item) {
        showToast('Không tìm thấy thông tin môn học!', 'warning');
        return;
    }
    const classes = item.classes || [];
    if (classes.length === 0) {
        showToast('Chưa tải danh sách lớp của môn này!', 'warning');
        return;
    }
    const name = item.course?.tenHocPhan || item.course?.tenMonHoc || courseCode;
    const type = item.type || _activeCourseType || 'main';
    await exportClassesToExcel(classes, courseCode, type, name);
}

window.exportCourseClassesToExcel = exportCourseClassesToExcel;

// Common function to export classes data to Excel with detailed schedule and course name
async function exportClassesToExcel(classes, filePrefix, type = 'main', courseNameOverride = '') {
    showToast('Đang tải dữ liệu chi tiết...', 'info');
    updateStatus('Đang tải lịch học chi tiết...');

    // Fetch details for all classes if not already fetched
    const detailsPromises = classes.map(async (cls) => {
        if (cls.scheduleDetails && cls.scheduleDetails.length > 0) {
            return cls;
        }
        try {
            const result = await api.getClassDetail(cls.id, type);
            if (result.success && result.data && result.data.length > 0) {
                return { ...cls, scheduleDetails: result.data };
            }
            return { ...cls, scheduleDetails: [] };
        } catch (e) {
            console.error('Error fetching detail for', cls.id, e);
            return { ...cls, scheduleDetails: [] };
        }
    });

    const classesWithDetails = await Promise.all(detailsPromises);

    // Resolve courseCode and courseName
    const isGenericPrefix = !filePrefix || ['lop_mon_chinh', 'lop_mon_phu', 'mon_chinh', 'mon_phu', 'main', 'extra', 'improvement'].includes(filePrefix);
    let courseCode = !isGenericPrefix ? filePrefix : '';
    let courseName = courseNameOverride || '';

    if (!courseCode && classesWithDetails.length > 0) {
        courseCode = classesWithDetails[0].maHocPhan || classesWithDetails[0].maMonHoc || '';
    }
    if (!courseName && courseCode) {
        courseName = getCourseNameByCode(courseCode);
    }
    if (!courseName && classesWithDetails.length > 0) {
        courseName = classesWithDetails[0].tenHocPhan || classesWithDetails[0].tenMonHoc || '';
    }
    if (!courseName && classesWithDetails.length > 0) {
        for (const cls of classesWithDetails) {
            if (cls.scheduleDetails && cls.scheduleDetails.length > 0) {
                const s = cls.scheduleDetails[0];
                if (s.tenHocPhan || s.tenMonHoc) {
                    courseName = s.tenHocPhan || s.tenMonHoc;
                    break;
                }
            }
        }
    }
    if (!courseName && currentInlineCourse && currentInlineCourse.tenHocPhan) {
        courseName = currentInlineCourse.tenHocPhan;
        if (!courseCode && currentInlineCourse.maHocPhan) {
            courseCode = currentInlineCourse.maHocPhan;
        }
    }

    const displayCourseName = courseName || (type === 'extra' ? 'Môn học điều kiện' : type === 'improvement' ? 'Học phần cải thiện' : 'Môn học chính');

    // Prepare data for Excel with header information and detailed schedule columns
    const data = [
        ['BẢNG CHI TIẾT LỚP HỌC PHẦN'],
        ['Học phần:', courseName ? (courseCode ? `${courseName} (${courseCode})` : courseName) : (courseCode || displayCourseName), '', '', 'Ngày xuất:', new Date().toLocaleDateString('vi-VN')],
        [],
        ['STT', 'Mã lớp (ID)', 'Tên lớp học phần', 'Tên học phần', 'Thứ', 'Tiết học', 'Thời gian', 'Phòng học', 'Sĩ số hiện tại', 'Sĩ số tối đa', 'Tỷ lệ', 'Trạng thái']
    ];

    let stt = 1;
    classesWithDetails.forEach(cls => {
        const { current, max, percentage, hasRawData } = getCapacity(cls);
        const isFull = hasRawData ? (current >= max) : (percentage >= 100);

        const schedules = cls.scheduleDetails || [];
        const tenHocPhan = cls.tenHocPhan || cls.tenMonHoc || courseName || '';
        const currentSTT = stt++;

        if (schedules.length > 0) {
            // Add a row for each schedule entry
            schedules.forEach((schedule, index) => {
                const dayName = schedule.thu ? `Thứ ${schedule.thu}` : '';
                // Use tietHoc or tiet field
                const lessons = schedule.tietHoc || schedule.tiet || '';
                // Format dates properly
                const startDate = schedule.ngayBatDau ? new Date(schedule.ngayBatDau).toLocaleDateString('vi-VN') : '';
                const endDate = schedule.ngayKetThuc ? new Date(schedule.ngayKetThuc).toLocaleDateString('vi-VN') : '';
                const dateRange = startDate && endDate ? `${startDate} - ${endDate}` : '';
                // Room and building
                const room = schedule.phong || schedule.phongHoc || '';
                const building = schedule.dayNha || '';
                const fullRoom = building ? `${room} - ${building}` : room;

                data.push([
                    index === 0 ? currentSTT : '',
                    index === 0 ? (cls.id || '') : '',
                    index === 0 ? (cls.tenLopHocPhan || cls.maLopHocPhan || '') : '',
                    index === 0 ? tenHocPhan : '',
                    dayName,
                    lessons ? `Tiết ${lessons}` : '',
                    dateRange,
                    fullRoom,
                    index === 0 && hasRawData ? current : '',
                    index === 0 && hasRawData ? max : '',
                    index === 0 ? `${percentage}%` : '',
                    index === 0 ? (isFull ? 'Đầy' : 'Còn chỗ') : ''
                ]);
            });
        } else {
            data.push([
                currentSTT,
                cls.id || '',
                cls.tenLopHocPhan || cls.maLopHocPhan || '',
                tenHocPhan,
                '', '', '', '',
                hasRawData ? current : '',
                hasRawData ? max : '',
                `${percentage}%`,
                isFull ? 'Đầy' : 'Còn chỗ'
            ]);
        }
    });

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(data);

    // Set column widths
    ws['!cols'] = [
        { wch: 6 },   // STT
        { wch: 14 },  // Mã lớp (ID)
        { wch: 24 },  // Tên lớp HP
        { wch: 32 },  // Tên học phần
        { wch: 10 },  // Thứ
        { wch: 12 },  // Tiết học
        { wch: 25 },  // Thời gian
        { wch: 18 },  // Phòng học
        { wch: 14 },  // Sĩ số hiện tại
        { wch: 14 },  // Sĩ số tối đa
        { wch: 10 },  // Tỷ lệ
        { wch: 12 }   // Trạng thái
    ];

    // Format ID column as text (starting from row 5)
    for (let i = 5; i <= data.length; i++) {
        const cell = ws['B' + i];
        if (cell) cell.t = 's';
    }

    // Format safe filename
    function sanitizeForFileName(name) {
        if (!name) return '';
        return name
            .replace(/[\\/:*?"<>|]/g, '')
            .replace(/\s+/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_+|_+$/g, '');
    }

    const dateStr = new Date().toISOString().split('T')[0];
    const safeCourseName = sanitizeForFileName(courseName);
    const safeCourseCode = sanitizeForFileName(courseCode);

    let fileName = '';
    if (safeCourseName && safeCourseCode) {
        fileName = `Lop_${safeCourseName}_${safeCourseCode}_${dateStr}.xlsx`;
    } else if (safeCourseName) {
        fileName = `Lop_${safeCourseName}_${dateStr}.xlsx`;
    } else if (safeCourseCode) {
        fileName = `Lop_${safeCourseCode}_${dateStr}.xlsx`;
    } else {
        fileName = `Lop_${sanitizeForFileName(filePrefix) || 'danh_sach'}_${dateStr}.xlsx`;
    }

    // Sheet name (max 31 chars)
    const sheetName = (courseName || courseCode || 'Danh sach lop')
        .replace(/[\\/*?:[\]]/g, '')
        .substring(0, 31)
        .trim();

    XLSX.utils.book_append_sheet(wb, ws, sheetName || 'Danh sach lop');
    XLSX.writeFile(wb, fileName);

    updateStatus('Sẵn sàng');
    showToast(`Đã xuất file Excel: ${fileName}`, 'success');
}

// ==================== Registered Courses (Tab 5) ====================

function calculateCourseFee(course) {
    if (course.hocPhi !== undefined && course.hocPhi !== null) {
        const fee = Number(course.hocPhi);
        return {
            val: fee,
            text: fee > 0 ? `${fee.toLocaleString('vi-VN')} đ` : '<span style="color:#059669;font-weight:600;">Miễn phí</span>'
        };
    }
    if (course.thanhTien !== undefined && course.thanhTien !== null) {
        const fee = Number(course.thanhTien);
        return {
            val: fee,
            text: fee > 0 ? `${fee.toLocaleString('vi-VN')} đ` : '<span style="color:#059669;font-weight:600;">Miễn phí</span>'
        };
    }
    const tc = parseInt(course.soTinChi || course.tinChi || course.stc || 0, 10);
    if (tc === 0) {
        return { val: 0, text: '<span style="color:#059669;font-weight:600;">Miễn phí</span>' };
    }
    // Học phí đại học UTH trung bình ~408.333 đ / TC (~1.225.000 đ cho 3 TC)
    const estimatedFee = Math.round(tc * 408333.33);
    return {
        val: estimatedFee,
        text: `${estimatedFee.toLocaleString('vi-VN')} đ`
    };
}

function formatClassScheduleAndRoom(course) {
    const id = String(course.id);
    const maLHP = course.maLopHocPhan || course.maHocPhan;
    const matches = (registeredSchedules || []).filter(s =>
        (s.idDangKy && String(s.idDangKy) === id) ||
        (s.maLopHocPhan && s.maLopHocPhan === maLHP)
    );

    if (matches.length > 0) {
        const days = matches.map(m => `Thứ ${m.thu} (Tiết ${m.tietHoc || m.tiet || '?'})`).join(', ');
        const rooms = [...new Set(matches.map(m => m.phong).filter(Boolean))].join(', ');
        return {
            schedule: days,
            room: rooms ? `Phòng: ${rooms}` : ''
        };
    }

    if (course.lichHoc || course.tkb) {
        return {
            schedule: course.lichHoc || course.tkb,
            room: course.phong ? `Phòng: ${course.phong}` : ''
        };
    }

    return {
        schedule: '',
        room: ''
    };
}

async function loadRegisteredCourses() {
    const idDot = getIdDot();
    updateStatus('Đang tải môn đã đăng ký...');

    const result = await api.getRegisteredCourses(idDot);

    if (!result.success) {
        showToast(result.message || 'Không thể tải danh sách', 'error');
        return;
    }

    const { main, extra, improvement } = result.data;
    const mainList = main || [];
    const extraList = extra || [];
    const allCourses = [...mainList, ...extraList];

    // Asynchronously update schedules cache
    updateRegisteredSchedules();

    // Calculate Summary Statistics
    const totalCourses = allCourses.length;
    const totalCredits = allCourses.reduce((sum, c) => sum + (parseInt(c.soTinChi || c.tinChi || c.stc || 0, 10) || 0), 0);
    const totalFee = allCourses.reduce((sum, c) => sum + calculateCourseFee(c).val, 0);

    const elTotalCourses = document.getElementById('registered-total-courses');
    const elTotalCredits = document.getElementById('registered-total-credits');
    const elTotalFee = document.getElementById('registered-total-fee');
    const elMainBadge = document.getElementById('registered-main-count-badge');
    const elExtraBadge = document.getElementById('registered-extra-count-badge');

    if (elTotalCourses) elTotalCourses.textContent = String(totalCourses).padStart(2, '0');
    if (elTotalCredits) elTotalCredits.textContent = String(totalCredits).padStart(2, '0');
    if (elTotalFee) elTotalFee.textContent = totalFee > 0 ? `${totalFee.toLocaleString('vi-VN')} đ` : '0 đ';
    if (elMainBadge) elMainBadge.textContent = `${mainList.length} học phần`;
    if (elExtraBadge) elExtraBadge.textContent = `${extraList.length} học phần`;

    // Render Tables
    renderRegisteredTable('registered-main-table', mainList, 'main');
    renderRegisteredTable('registered-extra-table', extraList, 'extra');

    updateStatus(`Đã tải: ${mainList.length} môn chính, ${extraList.length} môn phụ`);
    showToast('Đã tải danh sách môn đã đăng ký', 'success');
}

function renderRegisteredTable(tableId, courses, type = 'main') {
    const tbody = document.querySelector(`#${tableId} tbody`);
    if (!tbody) return;
    tbody.innerHTML = '';

    if (!courses || courses.length === 0) {
        tbody.innerHTML = `
            <tr>
                <td colspan="7" style="text-align: center; padding: 32px 16px; color: #94a3b8; font-size: 13px;">
                    Chưa có học phần nào được ghi danh trong mục này
                </td>
            </tr>
        `;
        return;
    }

    courses.forEach((course, index) => {
        const row = document.createElement('tr');
        row.style.cssText = 'transition: background 0.15s; border-bottom: 1px solid #f1f5f9;';
        row.addEventListener('mouseenter', () => row.style.background = '#f8fafc');
        row.addEventListener('mouseleave', () => row.style.background = '');

        const canCancel = course.isAllowCancel === true;
        const maHP = course.maLopHocPhan || course.maHocPhan || '—';
        const tenHP = course.tenMonHoc || course.tenHocPhan || 'Học phần';
        const subTen = course.ghiChu || course.moTa || (type === 'extra' ? 'Lớp kỹ năng / điều kiện' : '');
        const tenLop = course.lopDuKien || course.tenLopHocPhan || course.maLopHocPhan || '—';

        const schedInfo = formatClassScheduleAndRoom(course);
        const tc = parseInt(course.soTinChi || course.tinChi || course.stc || 0, 10);

        const classInfo = {
            maLopHocPhan: maHP,
            tenLopHocPhan: tenHP,
        };
        const classDataEncoded = encodeURIComponent(JSON.stringify(classInfo));
        const idDangKy = course.id;

        row.innerHTML = `
            <td style="text-align: center; color: #64748b; font-size: 12px; font-weight: 500;">${index + 1}</td>
            <td style="font-family: monospace; font-size: 12px; font-weight: 600; color: #334155;">${maHP}</td>
            <td style="vertical-align: middle;">
                <div style="font-weight: 600; color: #0f172a; font-size: 13px;">${tenHP}</div>
                ${subTen ? `<div style="font-size: 11px; color: #64748b; margin-top: 2px;">${subTen}</div>` : ''}
            </td>
            <td>
                <span style="background: #f1f5f9; border: 1px solid #e2e8f0; padding: 3px 8px; border-radius: 6px; font-size: 11px; font-weight: 600; color: #334155; font-family: monospace; white-space: nowrap;">
                    ${tenLop}
                </span>
            </td>
            <td>
                <div style="display: flex; align-items: flex-start; gap: 6px;">
                    <button class="btn-icon" onclick="viewClassDetail('${idDangKy}', 'registered', '${classDataEncoded}')" 
                        title="Xem lịch học chi tiết" 
                        style="background: #e0f2fe; color: #0284c7; border: none; border-radius: 6px; padding: 3px 5px; cursor: pointer; flex-shrink: 0; font-size: 12px;">
                        📅
                    </button>
                    <div>
                        <div style="font-size: 12px; font-weight: 600; color: #1e293b;">${schedInfo.schedule}</div>
                        ${schedInfo.room ? `<div style="font-size: 11px; color: #64748b; margin-top: 1px;">${schedInfo.room}</div>` : ''}
                    </div>
                </div>
            </td>
            <td style="text-align: center; font-weight: 700; font-size: 13px; color: #1e293b;">
                ${tc > 0 ? tc : '—'}
            </td>
            <td style="text-align: center; white-space: nowrap;">
                ${canCancel
                ? `<button class="btn btn-sm btn-danger" onclick="cancelRegistration('${course.id}')" style="border-radius: 20px; padding: 3px 12px; font-size: 11px; font-weight: 600;">🗑️ Hủy môn</button>`
                : `<span style="background: #f8fafc; color: #94a3b8; border: 1px solid #e2e8f0; border-radius: 20px; padding: 4px 10px; font-size: 11px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px; cursor: not-allowed;"><span style="font-size: 10px;">🔒</span> Không thể hủy</span>`
            }
            </td>
        `;
        tbody.appendChild(row);
    });
}

async function cancelRegistration(idDangKy) {
    if (!confirm('Bạn có chắc muốn hủy đăng ký môn này?')) return;

    updateStatus('Đang hủy đăng ký...');
    const result = await api.cancelRegistration(idDangKy);

    if (result.success) {
        showToast('Đã hủy đăng ký thành công', 'success');
        updateRegisteredSchedules(); // Update schedules
        loadRegisteredCourses(); // Reload
    } else {
        showToast(`Lỗi: ${result.message}`, 'error');
    }

    updateStatus('Sẵn sàng');
}

function exportRegisteredCoursesToExcel() {
    if (typeof XLSX === 'undefined') {
        showToast('Thư viện Excel chưa sẵn sàng', 'error');
        return;
    }

    const data = [
        ['DANH SÁCH MÔN HỌC ĐÃ ĐĂNG KÝ'],
        ['Đợt học:', document.getElementById('global-id-dot')?.value || ''],
        ['Ngày xuất:', new Date().toLocaleDateString('vi-VN')],
        [],
        ['STT', 'Loại môn', 'Mã HP', 'Tên học phần', 'Tên lớp', 'Lịch học & Phòng', 'Số TC', 'Học phí tạm tính']
    ];

    let stt = 1;
    document.querySelectorAll('#registered-main-table tbody tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 7) {
            data.push([
                stt++,
                'Môn chính',
                cells[1].textContent.trim(),
                cells[2].querySelector('div')?.textContent.trim() || cells[2].textContent.trim(),
                cells[3].textContent.trim(),
                cells[4].textContent.trim().replace(/\s+/g, ' '),
                cells[5].textContent.trim(),
                cells[6].textContent.trim()
            ]);
        }
    });

    document.querySelectorAll('#registered-extra-table tbody tr').forEach(row => {
        const cells = row.querySelectorAll('td');
        if (cells.length >= 7) {
            data.push([
                stt++,
                'Môn phụ / điều kiện',
                cells[1].textContent.trim(),
                cells[2].querySelector('div')?.textContent.trim() || cells[2].textContent.trim(),
                cells[3].textContent.trim(),
                cells[4].textContent.trim().replace(/\s+/g, ' '),
                cells[5].textContent.trim(),
                cells[6].textContent.trim()
            ]);
        }
    });

    if (data.length <= 5) {
        showToast('Chưa có dữ liệu môn học để xuất file', 'warning');
        return;
    }

    const ws = XLSX.utils.aoa_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'MonDaDK');
    XLSX.writeFile(wb, `Mon_Da_Dang_Ky_${new Date().toISOString().split('T')[0]}.xlsx`);
    showToast('Đã xuất file Excel thành công!', 'success');
}

function printRegisteredCourses() {
    window.print();
}

// ==================== Improvement Courses (Tab 6) ====================
let cachedImprovementCourses = [];
let expandedImprovementCourse = null;

function escapeHtml(str) {
    if (!str) return '';
    return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function initImprovementLookup() {
    const inputEl = document.getElementById('improvement-lookup-input');
    const clearBtn = document.getElementById('improvement-lookup-clear');
    if (!inputEl) return;

    let debounceTimer = null;
    inputEl.addEventListener('input', () => {
        if (clearBtn) clearBtn.style.display = inputEl.value.trim() ? 'block' : 'none';
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            if (inputEl.value.trim().length >= 3) {
                lookupImprovementClass();
            } else if (inputEl.value.trim().length === 0) {
                clearImprovementLookup();
            }
        }, 350);
    });

    inputEl.addEventListener('paste', () => {
        setTimeout(() => {
            if (inputEl.value.trim()) {
                if (clearBtn) clearBtn.style.display = 'block';
                lookupImprovementClass();
            }
        }, 50);
    });
}

function clearImprovementLookup() {
    const inputEl = document.getElementById('improvement-lookup-input');
    const clearBtn = document.getElementById('improvement-lookup-clear');
    const resultEl = document.getElementById('improvement-lookup-result');
    if (inputEl) inputEl.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    if (resultEl) {
        resultEl.innerHTML = '';
        resultEl.style.display = 'none';
    }
}

async function lookupImprovementClass() {
    const inputEl = document.getElementById('improvement-lookup-input');
    const resultEl = document.getElementById('improvement-lookup-result');
    if (!inputEl || !resultEl) return;

    const rawVal = inputEl.value.trim();
    if (!rawVal) {
        clearImprovementLookup();
        return;
    }

    resultEl.style.display = 'block';
    resultEl.innerHTML = `
        <div style="background: white; border: 1px solid #bfdbfe; border-radius: 8px; padding: 10px 14px; color: #1e40af; font-size: 13px; display: flex; align-items: center; gap: 8px;">
            <span class="btn-loader" style="border-top-color: #2563eb; width: 14px; height: 14px; display: inline-block;"></span>
            Đang tìm kiếm thông tin môn học cho mã: <strong>${escapeHtml(rawVal)}</strong>...
        </div>
    `;

    // 1. Tải trước danh sách môn cải thiện nếu chưa tải
    if (cachedImprovementCourses.length === 0) {
        const idDot = getIdDot();
        try {
            const res = await api.getImprovementCourses(idDot);
            if (res.success && Array.isArray(res.data)) {
                cachedImprovementCourses = res.data;
            }
        } catch (e) {
            console.error('Lỗi khi tải trước danh sách cải thiện:', e);
        }
    }

    let foundMaHP = '';
    let foundTenHP = '';
    let foundTenLop = '';
    let foundMaLop = '';
    let foundClassId = '';

    // Kiểm tra nếu là số thuần túy (rất có thể là ID lớp, ví dụ 219184)
    const isNumericId = /^\d+$/.test(rawVal);

    if (isNumericId) {
        try {
            let detailRes = await api.getClassDetail(rawVal, 'main');
            if (!detailRes.success || !Array.isArray(detailRes.data) || detailRes.data.length === 0) {
                detailRes = await api.getClassDetail(rawVal, 'extra');
            }

            if (detailRes.success && Array.isArray(detailRes.data) && detailRes.data.length > 0) {
                const d = detailRes.data[0];
                foundMaHP = d.maHocPhan || d.maMonHoc || d.maHP || '';
                foundTenHP = d.tenHocPhan || d.tenMonHoc || d.tenHocPhanMoi || '';
                foundTenLop = d.tenLopHocPhan || `Lớp ${rawVal}`;
                foundMaLop = d.maLopHocPhan || '';
                foundClassId = rawVal;
            }
        } catch (err) {
            console.warn('Không tìm thấy theo ID lớp:', err);
        }
    }

    // 2. Nếu chưa tìm thấy, đối chiếu với danh sách môn cải thiện của sinh viên
    if (!foundMaHP && cachedImprovementCourses.length > 0) {
        const exactMatch = cachedImprovementCourses.find(c => String(c.maHocPhan).toLowerCase() === rawVal.toLowerCase());
        if (exactMatch) {
            foundMaHP = exactMatch.maHocPhan;
            foundTenHP = exactMatch.tenHocPhan || '';
        } else {
            // Khớp tiền tố mã lớp: ví dụ rawVal = "010441203101", course.maHocPhan = "0104412031"
            const prefixMatch = cachedImprovementCourses.find(c => c.maHocPhan && rawVal.startsWith(c.maHocPhan));
            if (prefixMatch) {
                foundMaHP = prefixMatch.maHocPhan;
                foundTenHP = prefixMatch.tenHocPhan || '';
                foundMaLop = rawVal;
            } else {
                const softMatch = cachedImprovementCourses.find(c =>
                    (c.maHocPhan && c.maHocPhan.includes(rawVal)) ||
                    (c.tenHocPhan && c.tenHocPhan.toLowerCase().includes(rawVal.toLowerCase()))
                );
                if (softMatch) {
                    foundMaHP = softMatch.maHocPhan;
                    foundTenHP = softMatch.tenHocPhan || '';
                }
            }
        }
    }

    // 3. Nếu vẫn chưa thấy và chuỗi dài > 7, thử bỏ 2-3 ký tự cuối (hậu tố lớp UTH)
    if (!foundMaHP && rawVal.length > 7) {
        const candidatePrefix2 = rawVal.slice(0, -2);
        const candidatePrefix3 = rawVal.slice(0, -3);
        const match2 = cachedImprovementCourses.find(c => c.maHocPhan === candidatePrefix2);
        const match3 = cachedImprovementCourses.find(c => c.maHocPhan === candidatePrefix3);
        if (match2) {
            foundMaHP = match2.maHocPhan;
            foundTenHP = match2.tenHocPhan || '';
            foundMaLop = rawVal;
        } else if (match3) {
            foundMaHP = match3.maHocPhan;
            foundTenHP = match3.tenHocPhan || '';
            foundMaLop = rawVal;
        }
    }

    // 4. Nếu vẫn chưa ra, truy vấn API trường để tìm mã học phần
    if (!foundMaHP) {
        const idDot = getIdDot();
        try {
            const testCode = rawVal.length > 7 ? rawVal.slice(0, -2) : rawVal;
            const classRes = await api.getMainClasses(idDot, testCode);
            if (classRes.success && Array.isArray(classRes.data) && classRes.data.length > 0) {
                const c0 = classRes.data[0];
                foundMaHP = testCode;
                foundTenHP = c0.tenHocPhan || c0.tenMonHoc || '';
                foundMaLop = rawVal;
            }
        } catch (e) { }
    }

    if (!foundMaHP) {
        resultEl.innerHTML = `
            <div style="background: #fff1f2; border: 1px solid #fecdd3; border-radius: 8px; padding: 12px 16px; color: #be123c; font-size: 13px; display: flex; align-items: center; justify-content: space-between;">
                <div>
                    <strong>❌ Không tìm thấy Mã học phần:</strong> Không tìm thấy thông tin môn học tương ứng với mã <code>${escapeHtml(rawVal)}</code>.
                    <div style="font-size: 11.5px; color: #9f1239; margin-top: 3px;">Gợi ý: Kiểm tra lại mã lớp hoặc thử nhập trực tiếp Mã học phần.</div>
                </div>
                <button class="btn btn-sm btn-ghost" onclick="clearImprovementLookup()">Đóng</button>
            </div>
        `;
        return;
    }

    // Kiểm tra xem môn này có nằm trong danh sách cải thiện của sinh viên không
    const inImprovementList = cachedImprovementCourses.some(c => String(c.maHocPhan) === String(foundMaHP));

    resultEl.innerHTML = `
        <div style="background: #ffffff; border: 2px solid #3b82f6; border-radius: 10px; padding: 14px 18px; box-shadow: 0 4px 6px -1px rgba(59, 130, 246, 0.1); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px;">
            <div>
                <div style="font-size: 11px; font-weight: 700; color: #2563eb; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 6px;">
                    <span>🎯</span> KẾT QUẢ TÌM THẤY MÃ HỌC PHẦN
                </div>
                <div style="font-size: 16px; font-weight: 700; color: #0f172a; margin-top: 3px;">
                    Mã HP: <span style="color: #1d4ed8; font-family: monospace; font-size: 18px; background: #eff6ff; padding: 1px 8px; border-radius: 4px; border: 1px solid #bfdbfe;">${escapeHtml(foundMaHP)}</span> 
                    ${foundTenHP ? `— <span style="color: #1e293b;">${escapeHtml(foundTenHP)}</span>` : ''}
                </div>
                <div style="font-size: 12.5px; color: #64748b; margin-top: 4px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap;">
                    ${foundTenLop ? `<span>Lớp: <strong>${escapeHtml(foundTenLop)}</strong></span>` : ''}
                    ${foundMaLop ? `<span>(Mã lớp: <code>${escapeHtml(foundMaLop)}</code>)</span>` : ''}
                    ${foundClassId ? `<span>• ID: <code>${escapeHtml(foundClassId)}</code></span>` : ''}
                    ${inImprovementList
            ? `<span style="background: #dcfce7; color: #15803d; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 11.5px;">✅ Có trong danh sách cải thiện</span>`
            : `<span style="background: #fef3c7; color: #b45309; padding: 2px 8px; border-radius: 4px; font-weight: 600; font-size: 11.5px;">⚠️ Không nằm trong danh sách cải thiện đợt này</span>`
        }
                </div>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
                <button class="btn btn-sm btn-outline" onclick="copyImprovementMaHP('${escapeHtml(foundMaHP)}')" 
                    style="border-radius: 6px; font-weight: 600; background: white; border-color: #cbd5e1; display: flex; align-items: center; gap: 4px;">
                    📋 Sao chép Mã HP
                </button>
                ${inImprovementList
            ? `<button class="btn btn-sm btn-primary" onclick="focusImprovementCourseRow('${escapeHtml(foundMaHP)}', '${escapeHtml(foundTenHP)}')" 
                        style="border-radius: 6px; font-weight: 600; background: linear-gradient(135deg, #2563eb, #1d4ed8); display: flex; align-items: center; gap: 4px;">
                        🎯 Xem lớp trong bảng
                    </button>`
            : ''
        }
            </div>
        </div>
    `;

    // Tự động định vị nếu môn này có trong danh sách cải thiện
    if (inImprovementList) {
        focusImprovementCourseRow(foundMaHP, foundTenHP);
    }
}

function copyImprovementMaHP(maHP) {
    if (!maHP) return;
    navigator.clipboard.writeText(maHP).then(() => {
        showToast(`Đã sao chép Mã HP: ${maHP}`, 'success');
    }).catch(() => {
        showToast(`Mã HP: ${maHP}`, 'info');
    });
}

function focusImprovementCourseRow(maHP, tenHP) {
    const row = document.getElementById(`improvement-course-row-${maHP}`);
    if (row) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
        row.style.outline = '3px solid #3b82f6';
        row.style.backgroundColor = '#fef08a';
        setTimeout(() => {
            row.style.transition = 'background-color 2s, outline 2s';
            row.style.backgroundColor = '#eff6ff';
            row.style.outline = '1px solid #bfdbfe';
        }, 1000);

        const existingExpandRow = document.getElementById(`expand-row-${maHP}`);
        if (!existingExpandRow) {
            loadImprovementClasses(maHP, tenHP);
        }
    } else {
        loadImprovementCourses().then(() => {
            setTimeout(() => {
                const r2 = document.getElementById(`improvement-course-row-${maHP}`);
                if (r2) {
                    r2.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    r2.style.backgroundColor = '#eff6ff';
                    r2.style.outline = '2px solid #3b82f6';
                }
            }, 300);
        });
    }
}

async function loadImprovementCourses() {
    const idDot = getIdDot();
    updateStatus('Đang tải học phần cải thiện...');

    const result = await api.getImprovementCourses(idDot);

    if (!result.success) {
        showToast(result.message || 'Không thể tải danh sách', 'error');
        return;
    }

    const tbody = document.querySelector('#improvement-courses-table tbody');
    tbody.innerHTML = '';

    const courses = result.data || [];
    cachedImprovementCourses = courses;

    const badgeEl = document.getElementById('improvement-count-badge');
    if (badgeEl) {
        badgeEl.textContent = `${courses.length} học phần`;
        badgeEl.style.display = 'inline-block';
    }

    courses.forEach((course, index) => {
        const row = document.createElement('tr');
        row.id = `improvement-course-row-${course.maHocPhan}`;
        row.innerHTML = `
            <td>${index + 1}</td>
            <td><strong style="color:#1e40af;font-family:monospace;">${course.maHocPhan || ''}</strong></td>
            <td style="font-weight:600;color:#0f172a;">${course.tenHocPhan || ''}</td>
            <td style="text-align:center;">${course.soTinChi || ''}</td>
            <td style="text-align:center;font-weight:600;color:#d97706;">${course.diemCu || course.diemTongKet || ''}</td>
            <td>
                <button class="btn btn-sm btn-outline" onclick="toggleImprovementClasses('${course.maHocPhan}', '${course.tenHocPhan?.replace(/'/g, "\\'")}')" id="btn-view-${course.maHocPhan}" style="border-radius:6px;font-size:11.5px;">
                    ▼ Xem lớp
                </button>
            </td>
        `;
        tbody.appendChild(row);
    });

    updateStatus(`Tìm thấy ${courses.length} học phần có thể cải thiện`);
    showToast(`Tìm thấy ${courses.length} học phần`, 'success');
}

async function toggleImprovementClasses(maHocPhan, tenHocPhan) {
    const existingExpandRow = document.getElementById(`expand-row-${maHocPhan}`);
    const btn = document.getElementById(`btn-view-${maHocPhan}`);

    // If already expanded, collapse it
    if (existingExpandRow) {
        existingExpandRow.remove();
        if (btn) btn.innerHTML = '▼ Xem lớp';
        expandedImprovementCourse = null;
        return;
    }

    // Collapse any other expanded row
    if (expandedImprovementCourse && expandedImprovementCourse !== maHocPhan) {
        const oldExpandRow = document.getElementById(`expand-row-${expandedImprovementCourse}`);
        if (oldExpandRow) oldExpandRow.remove();
        const oldBtn = document.getElementById(`btn-view-${expandedImprovementCourse}`);
        if (oldBtn) oldBtn.innerHTML = '▼ Xem lớp';
    }

    // Load and expand
    await loadImprovementClasses(maHocPhan, tenHocPhan);
}

async function loadImprovementClasses(maHocPhan, tenHocPhan) {
    const idDot = getIdDot();
    const parentRow = document.getElementById(`improvement-course-row-${maHocPhan}`);
    const btn = document.getElementById(`btn-view-${maHocPhan}`);

    if (!parentRow) {
        console.error('Parent row not found');
        return;
    }

    // Show loading state
    if (btn) btn.innerHTML = '⏳ Đang tải...';
    updateStatus('Đang tải danh sách lớp...');

    const result = await api.getImprovementClasses(idDot, maHocPhan);

    if (!result.success) {
        showToast(result.message || 'Không thể tải danh sách lớp', 'error');
        if (btn) btn.innerHTML = '▼ Xem lớp';
        return;
    }

    const resolvedTenHP = tenHocPhan || getCourseNameByCode(maHocPhan);
    improvementClassesData = result.data || [];
    improvementClassesData.forEach(c => {
        if (!c.tenHocPhan && resolvedTenHP) c.tenHocPhan = resolvedTenHP;
        if (!c.maHocPhan && maHocPhan) c.maHocPhan = maHocPhan;
    });

    // Update button state
    if (btn) btn.innerHTML = '▲ Ẩn lớp';
    expandedImprovementCourse = maHocPhan;

    // Create expanded row with classes table
    const expandRow = document.createElement('tr');
    expandRow.id = `expand-row-${maHocPhan}`;
    expandRow.className = 'expand-row';

    const classesHtml = improvementClassesData.length > 0
        ? renderImprovementClassesInline(improvementClassesData)
        : '<div class="text-muted p-3">Không tìm thấy lớp học phần nào</div>';

    expandRow.innerHTML = `
        <td colspan="6" class="expand-cell">
            <div class="expand-content">
                <div class="expand-header" style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
                    <div>
                        <strong>📚 Danh sách lớp: ${resolvedTenHP || maHocPhan}</strong>
                    </div>
                    <div>
                        <span class="badge" style="margin-right: 10px;">${improvementClassesData.length} lớp</span>
                        <button class="btn btn-sm btn-outline" onclick="exportImprovementClasses('${maHocPhan}')">📥 Xuất Excel</button>
                    </div>
                </div>
                ${classesHtml}
            </div>
        </td>
    `;

    // Insert after parent row
    parentRow.after(expandRow);

    updateStatus(`Tìm thấy ${improvementClassesData.length} lớp`);
}

function renderImprovementClassesInline(classes) {
    if (classes.length === 0) return '';

    let html = '<table class="data-table inline-classes-table"><thead><tr>';
    html += '<th><input type="checkbox" class="select-all-inline"></th>';
    html += '<th>ID</th><th>Tên lớp</th><th>Lịch học</th><th>Sĩ số</th><th>Trạng thái</th><th>Hành động</th>';
    html += '</tr></thead><tbody>';

    classes.forEach(cls => {
        const { current, max, percentage, hasRawData } = getCapacity(cls);
        const isFull = hasRawData ? (current >= max) : (percentage >= 100);
        html += `
            <tr>
                <td><input type="checkbox" value="${cls.id}" class="inline-class-checkbox"></td>
                <td>${cls.id || ''}</td>
                <td>${cls.tenLopHocPhan || cls.maLopHocPhan || ''}</td>
                <td>
                    ${cls.lichHoc || cls.tkb || ''}
                    <button class="btn-icon" onclick="viewClassDetail('${cls.id}', 'improvement', '${encodeURIComponent(JSON.stringify(cls))}')" title="Xem chi tiết">
                        📅
                    </button>
                </td>
                <td>
                    ${hasRawData ? `${current}/${max}` : ''}
                    <span style="${hasRawData ? 'font-size: 0.85em; color: #6c757d;' : 'font-weight: bold; color: #0d6efd;'}">
                        ${hasRawData ? `(${percentage}%)` : `${percentage}%`}
                    </span>
                </td>
                <td class="${isFull ? 'text-danger' : 'text-success'}">${isFull ? 'Đầy' : 'Còn chỗ'}</td>
                <td>
                    <button class="btn btn-sm btn-primary" onclick="registerSingleClass('${cls.id}', 'improvement')">
                        Đăng ký
                    </button>
                </td>
            </tr>
        `;
    });

    html += '</tbody></table>';
    return html;
}

// Export improvement classes to Excel
function exportImprovementClasses(maHocPhan) {
    if (!improvementClassesData || improvementClassesData.length === 0) {
        showToast('Chưa có dữ liệu lớp cải thiện!', 'error');
        return;
    }
    const course = (typeof cachedImprovementCourses !== 'undefined' && Array.isArray(cachedImprovementCourses))
        ? cachedImprovementCourses.find(c => c.maHocPhan === maHocPhan)
        : null;
    const tenHP = (course ? (course.tenHocPhan || course.tenMonHoc) : '') || getCourseNameByCode(maHocPhan);
    exportClassesToExcel(improvementClassesData, maHocPhan, 'improvement', tenHP);
}

// ==================== Schedule (Tab 7) ====================
async function loadAllSchedules() {
    const idDot = getIdDot();
    updateStatus('Đang tải lịch học...');
    const container = document.getElementById('schedule-container');
    container.innerHTML = '<div class="text-center">Đang tải dữ liệu...</div>';

    // 1. Get all registered courses
    const regResult = await api.getRegisteredCourses(idDot);
    if (!regResult.success) {
        showToast('Không thể tải danh sách môn đã đăng ký', 'error');
        container.innerHTML = '<div class="text-center text-danger">Lỗi tải dữ liệu</div>';
        return;
    }

    const { main, extra } = regResult.data;
    const allCourses = [...(main || []), ...(extra || [])];

    if (allCourses.length === 0) {
        container.innerHTML = '<div class="text-center">Chưa đăng ký môn học nào</div>';
        updateStatus('Sẵn sàng');
        return;
    }

    // 2. Fetch schedule for each course
    updateStatus(`Đang tải lịch cho ${allCourses.length} môn...`);
    const schedulePromises = allCourses.map(async (course) => {
        const result = await api.getSchedule(course.id);
        if (result.success && result.data && result.data.length > 0) {
            return result.data.map(item => ({
                ...item,
                tenMonHoc: course.tenMonHoc || course.tenHocPhan,
                maLopHocPhan: course.maLopHocPhan || course.maHocPhan
            }));
        }
        return [];
    });

    const results = await Promise.all(schedulePromises);
    const allSchedules = results.flat();

    // 3. Render
    renderScheduleList(allSchedules);
    updateStatus('Đã tải xong lịch học');
}

function renderScheduleList(schedules) {
    const container = document.getElementById('schedule-container');
    container.innerHTML = '';

    if (schedules.length === 0) {
        container.innerHTML = `
            <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;padding:60px 20px;color:var(--text-secondary);text-align:center;">
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" style="margin-bottom:16px;opacity:0.3;">
                    <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect><line x1="16" y1="2" x2="16" y2="6"></line><line x1="8" y1="2" x2="8" y2="6"></line><line x1="3" y1="10" x2="21" y2="10"></line>
                </svg>
                <p style="margin:0;font-size:15px;font-weight:500;color:#64748b;">Không có lịch học nào</p>
            </div>
        `;
        return;
    }

    // Lọc bỏ các lớp E-learning
    const filteredSchedules = schedules.filter(item => {
        const p = (item.phong || '').toLowerCase();
        return !p.includes('e-learning') && !p.includes('elearning');
    });

    if (filteredSchedules.length === 0) {
        container.innerHTML = '<div class="text-center text-muted mt-4">Chỉ có lớp E-learning hoặc không có lịch học nào.</div>';
        return;
    }

    // Sort by Day (Thứ) then Period (Tiết)
    filteredSchedules.sort((a, b) => {
        const dayA = parseInt(a.thu) || 0;
        const dayB = parseInt(b.thu) || 0;
        if (dayA !== dayB) return dayA - dayB;
        const startA = parseInt(a.tietHoc?.split('-')[0]) || 0;
        const startB = parseInt(b.tietHoc?.split('-')[0]) || 0;
        return startA - startB;
    });

    // Group by Day
    const days = { 2: 'Thứ Hai', 3: 'Thứ Ba', 4: 'Thứ Tư', 5: 'Thứ Năm', 6: 'Thứ Sáu', 7: 'Thứ Bảy', 8: 'Chủ Nhật' };

    // Create grid container for day cards
    const gridContainer = document.createElement('div');
    gridContainer.style.cssText = 'display: flex; gap: 8px; flex-wrap: nowrap; overflow-x: auto; padding-bottom: 8px; align-items: stretch;';
    container.appendChild(gridContainer);

    let currentDay = null;
    let dayGroup = null;
    let classesContainer = null;

    // A colorful palette for day headers
    const dayColors = {
        2: 'linear-gradient(135deg, #f59e0b, #d97706)', // amber
        3: 'linear-gradient(135deg, #10b981, #059669)', // emerald
        4: 'linear-gradient(135deg, #3b82f6, #2563eb)', // blue
        5: 'linear-gradient(135deg, #8b5cf6, #7c3aed)', // violet
        6: 'linear-gradient(135deg, #ec4899, #db2777)', // pink
        7: 'linear-gradient(135deg, #06b6d4, #0891b2)', // cyan
        8: 'linear-gradient(135deg, #ef4444, #dc2626)'  // red
    };

    filteredSchedules.forEach(item => {
        if (item.thu !== currentDay) {
            currentDay = item.thu;
            dayGroup = document.createElement('div');
            dayGroup.style.cssText = 'background: white; border: 1px solid var(--border-color); border-radius: 6px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.05); flex: 1 1 140px; min-width: 150px; display: flex; flex-direction: column;';

            const headerColor = dayColors[currentDay] || 'linear-gradient(135deg, #64748b, #475569)';
            const header = document.createElement('div');
            header.style.cssText = `background: ${headerColor}; color: white; padding: 6px 8px; font-weight: 700; font-size: 11px; text-transform: uppercase; letter-spacing: 0.5px; display: flex; align-items: center; gap: 4px; justify-content: center;`;
            header.innerHTML = `${days[currentDay] || 'Thứ ' + currentDay}`;

            classesContainer = document.createElement('div');
            classesContainer.style.cssText = 'padding: 0;';

            dayGroup.appendChild(header);
            dayGroup.appendChild(classesContainer);
            gridContainer.appendChild(dayGroup);
        }

        const itemEl = document.createElement('div');
        itemEl.style.cssText = 'padding: 8px; border-bottom: 1px solid var(--border-color); position: relative;';

        // Remove bottom border for last item visually
        itemEl.classList.add('schedule-detail-item');

        // Parse dates safely
        let dateStr = '';
        if (item.ngayBatDau && item.ngayKetThuc) {
            const sd = new Date(item.ngayBatDau), ed = new Date(item.ngayKetThuc);
            if (!isNaN(sd) && !isNaN(ed)) {
                dateStr = `${String(sd.getDate()).padStart(2, '0')}/${String(sd.getMonth() + 1).padStart(2, '0')} - ${String(ed.getDate()).padStart(2, '0')}/${String(ed.getMonth() + 1).padStart(2, '0')}`;
            }
        }

        itemEl.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 4px; margin-bottom: 6px;">
                <div style="display: flex; justify-content: space-between; align-items: flex-start;">
                    <h4 style="margin: 0; color: #1e293b; font-size: 11px; font-weight: 700; line-height: 1.3; flex: 1;">${item.tenMonHoc || 'Môn học chưa rõ'}</h4>
                    <div style="font-weight: 700; color: var(--primary); font-size: 10px; background: var(--primary-light, #dbeafe); padding: 1px 4px; border-radius: 4px; white-space: nowrap; margin-left: 4px;">Tiết ${item.tietHoc || '?'}</div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center;">
                    <div style="font-family: monospace; font-size: 10px; color: #64748b;">${item.maLopHocPhan}</div>
                    <div style="font-size: 10px; font-weight: 600; color: #475569;">${item.phong ? `P.${item.phong}` : ''}</div>
                </div>
            </div>
            <div style="font-size: 9px; color: #475569; background: #f8fafc; padding: 4px 6px; border-radius: 4px; border: 1px dashed #cbd5e1; display: flex; flex-direction: column; gap: 2px;">
                ${dateStr ? `<div>📅 ${dateStr}</div>` : ''}
                ${item.dayNha ? `<div>🏢 ${item.dayNha}</div>` : ''}
            </div>
            ${item.ghiChu ? `<div style="margin-top: 4px; font-size: 9px; color: #d97706; background: #fef3c7; padding: 3px 6px; border-radius: 3px; font-weight: 600;">⚠️ ${item.ghiChu}</div>` : ''}
        `;
        classesContainer.appendChild(itemEl);
    });

    // Add custom styles for removing last border
    const styleEl = document.createElement('style');
    styleEl.innerHTML = `.schedule-detail-item:last-child { border-bottom: none !important; }`;
    container.appendChild(styleEl);
}

// ==================== Modal & Details ====================
async function viewClassDetail(classId, type, classDataEncoded) {
    const modal = document.getElementById('class-detail-modal');
    const content = document.getElementById('class-detail-content');

    // Parse class info from the button
    let classInfo = {};
    try {
        classInfo = JSON.parse(decodeURIComponent(classDataEncoded));
    } catch (e) {
        console.error('Error parsing class info', e);
    }

    modal.classList.add('show');
    content.innerHTML = '<div class="text-center">Đang tải thông tin...</div>';

    let result;
    if (type === 'registered') {
        result = await api.getSchedule(classId);
    } else {
        result = await api.getClassDetail(classId, type);
    }

    if (!result.success) {
        content.innerHTML = `<div class="text-danger">Lỗi: ${result.message}</div>`;
        return;
    }

    const scheduleList = result.data; // API returns array directly
    console.log('Schedule Data:', scheduleList);

    // Format schedule data
    let scheduleHtml = '';
    if (Array.isArray(scheduleList) && scheduleList.length > 0) {
        scheduleHtml = scheduleList.map(item => `
            <div class="schedule-item">
                <div class="schedule-row">
                    <strong>Lịch học:</strong> ${item.loaiLich || item.loaiHocPhan || 'LT'} - Thứ ${item.thu || ''} (Tiết ${item.tietHoc || item.tiet || ''})
                </div>
                <div class="schedule-row">
                    <strong>Thời gian:</strong> ${item.ngayBatDau ? new Date(item.ngayBatDau).toLocaleDateString('vi-VN') : ''} - ${item.ngayKetThuc ? new Date(item.ngayKetThuc).toLocaleDateString('vi-VN') : ''}
                </div>
                <div class="schedule-row">
                    <strong>Phòng:</strong> ${item.phong || ''} - ${item.dayNha || ''}
                </div>
                <div class="schedule-row">
                    <strong>Ghi chú:</strong> ${item.ghiChu || ''}
                </div>
            </div>
        `).join('');
    } else {
        scheduleHtml = '<div>Không có thông tin lịch học chi tiết</div>';
    }

    content.innerHTML = `
        <div class="detail-info">
            <div class="info-group">
                <label>Mã LHP:</label> <span>${classInfo.maLopHocPhan || classInfo.maMonHoc || ''}</span>
            </div>
            <div class="info-group">
                <label>Tên HP:</label> <span>${classInfo.tenLopHocPhan || classInfo.tenHocPhan || classInfo.tenMonHoc || ''}</span>
            </div>
            ${type !== 'registered' ? `
            <div class="info-group">
                <label>Sĩ số:</label> <span>${classInfo.siSoHienTai || 0}/${classInfo.siSoMax || 0}</span>
            </div>
             <div class="info-group">
                <label>Trạng thái:</label> <span>${classInfo.trangThai || (classInfo.siSoHienTai >= classInfo.siSoMax ? 'Đầy' : 'Còn chỗ')}</span>
            </div>
            ` : ''}
        </div>
        
        <h3 class="mt-3">Lịch học chi tiết</h3>
        <div class="schedule-list">
            ${scheduleHtml}
        </div>
    `;
}





async function updateRegisteredSchedules() {
    const idDot = getIdDot();
    try {
        const result = await api.getRegisteredCourses(idDot);
        if (!result.success) return;

        const { main, extra, improvement } = result.data;
        const allRegistered = [...(main || []), ...(extra || []), ...(improvement || [])];

        const schedulePromises = allRegistered.map(async (course) => {
            try {
                const detail = await api.getSchedule(course.id);
                if (detail.success && Array.isArray(detail.data)) {
                    return detail.data.map(item => ({
                        ...item,
                        maLopHocPhan: course.maLopHocPhan || course.maHocPhan,
                        tenMonHoc: course.tenMonHoc || course.tenHocPhan,
                    }));
                }
            } catch (e) {
                console.error('Error loading schedule for registered course', course.id, e);
            }
            return [];
        });

        const results = await Promise.all(schedulePromises);
        registeredSchedules = results.flat();
        console.log('Loaded registered schedules:', registeredSchedules);
    } catch (err) {
        console.error('Error updating registered schedules:', err);
    }
}

function parseTietRange(tietStr, s = null) {
    if (!tietStr && s) {
        if (s.tietBatDau !== undefined && s.tietBatDau !== null && s.tietBatDau !== '') {
            const start = parseInt(s.tietBatDau, 10);
            const count = parseInt(s.soTiet || 1, 10);
            const end = (s.tietKetThuc !== undefined && s.tietKetThuc !== null && s.tietKetThuc !== '')
                ? parseInt(s.tietKetThuc, 10)
                : start + count - 1;
            return { start, end };
        }
    }
    if (!tietStr) return null;
    let str = String(tietStr).trim().replace(/^tiết\s*/i, '');
    if (str.includes(',')) {
        const nums = str.split(',').map(Number).filter(n => !isNaN(n));
        if (nums.length > 0) {
            return { start: Math.min(...nums), end: Math.max(...nums) };
        }
    }
    const parts = str.split(/[-_]/).map(Number);
    if (parts.length === 1 && !isNaN(parts[0])) {
        return { start: parts[0], end: parts[0] };
    }
    if (parts.length >= 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
        return { start: parts[0], end: parts[1] };
    }
    return null;
}

function formatSessionTiet(s, fallbackCa = null) {
    if (!s) return fallbackCa ? `Tiết ${fallbackCa.startPeriod} - ${fallbackCa.endPeriod}` : '';
    const raw = s.tietHoc || s.tiet;
    if (raw) {
        let clean = String(raw).trim().replace(/^tiết\s*/i, '');
        if (clean.includes(',')) {
            const nums = clean.split(',').map(Number).filter(n => !isNaN(n));
            if (nums.length > 0) {
                const min = Math.min(...nums);
                const max = Math.max(...nums);
                return min === max ? `Tiết ${min}` : `Tiết ${min} - ${max}`;
            }
        }
        const parts = clean.split(/[-_]/).map(p => p.trim()).filter(Boolean);
        if (parts.length >= 2) {
            return `Tiết ${parts[0]} - ${parts[1]}`;
        } else if (parts.length === 1 && parts[0]) {
            return `Tiết ${parts[0]}`;
        }
    }
    if (s.tietBatDau !== undefined && s.tietBatDau !== null && s.tietBatDau !== '') {
        const start = parseInt(s.tietBatDau, 10);
        if (s.tietKetThuc !== undefined && s.tietKetThuc !== null && s.tietKetThuc !== '') {
            const end = parseInt(s.tietKetThuc, 10);
            return start === end ? `Tiết ${start}` : `Tiết ${start} - ${end}`;
        }
        if (s.soTiet !== undefined && s.soTiet !== null && s.soTiet !== '') {
            const count = parseInt(s.soTiet, 10);
            const end = start + count - 1;
            return count <= 1 ? `Tiết ${start}` : `Tiết ${start} - ${end}`;
        }
        return `Tiết ${start}`;
    }
    if (fallbackCa && fallbackCa.startPeriod && fallbackCa.endPeriod) {
        return `Tiết ${fallbackCa.startPeriod} - ${fallbackCa.endPeriod}`;
    }
    return '';
}

function checkConflict(candidateDetails) {
    if (!candidateDetails || candidateDetails.length === 0 || !registeredSchedules || registeredSchedules.length === 0) {
        return { conflict: false };
    }

    for (const cand of candidateDetails) {
        const candStart = cand.ngayBatDau ? new Date(cand.ngayBatDau) : null;
        const candEnd = cand.ngayKetThuc ? new Date(cand.ngayKetThuc) : null;
        const candThu = parseInt(cand.thu) || 0;

        const candTietRange = parseTietRange(cand.tietHoc || cand.tiet);
        if (!candTietRange) continue;

        for (const reg of registeredSchedules) {
            const regStart = reg.ngayBatDau ? new Date(reg.ngayBatDau) : null;
            const regEnd = reg.ngayKetThuc ? new Date(reg.ngayKetThuc) : null;
            const regThu = parseInt(reg.thu) || 0;

            if (candThu !== regThu) continue;

            // Check if date ranges overlap
            if (candStart && candEnd && regStart && regEnd) {
                if (candEnd < regStart || candStart > regEnd) {
                    continue;
                }
            }

            const regTietRange = parseTietRange(reg.tietHoc || reg.tiet);
            if (!regTietRange) continue;

            if (candTietRange.start <= regTietRange.end && candTietRange.end >= regTietRange.start) {
                return {
                    conflict: true,
                    conflictingCourse: reg.tenMonHoc || reg.maLopHocPhan,
                    conflictingClass: reg.maLopHocPhan,
                    conflictingSchedule: `Thứ ${reg.thu} (Tiết ${reg.tietHoc || reg.tiet})`
                };
            }
        }
    }

    return { conflict: false };
}

function toggleConflictFilter() {
    if (currentInlineType) {
        const classes = currentInlineType === 'main' ? classesData : extraClassesData;
        renderClassesTable('inline-classes-table', classes, currentInlineType);
    }
}

function closeModal() {
    document.getElementById('class-detail-modal').classList.remove('show');
}

function showGuideModal() {
    document.getElementById('guide-modal').classList.add('show');
}

function closeGuideModal() {
    document.getElementById('guide-modal').classList.remove('show');
}

// Close modal when clicking outside
window.onclick = function (event) {
    const classModal = document.getElementById('class-detail-modal');
    const guideModal = document.getElementById('guide-modal');
    const weeklyModal = document.getElementById('weekly-schedule-preview-modal');
    const step2Modal = document.getElementById('step2-auto-register-modal');
    if (event.target == classModal) {
        closeModal();
    }
    if (event.target == guideModal) {
        closeGuideModal();
    }
    if (event.target == weeklyModal) {
        closeWeeklySchedulePreviewModal();
    }
    if (event.target == step2Modal) {
        closeStep2AutoRegisterModal();
    }
}

// ==================== Utilities ====================
function getIdDot() {
    return document.getElementById('global-id-dot')?.value || '77';
}

function updateStatus(text) {
    document.getElementById('status-text').textContent = text;
}

function updateTime() {
    const now = new Date();
    const timeStr = now.toLocaleTimeString('vi-VN');
    document.getElementById('status-time').textContent = timeStr;
}

function addLog(containerId, message, type = 'info') {
    const container = document.getElementById(containerId);
    const logEntry = document.createElement('div');
    logEntry.className = `log-entry log-${type}`;
    logEntry.innerHTML = `
        <span class="log-time">[${new Date().toLocaleTimeString('vi-VN')}]</span>
        <span class="log-message">${message}</span>
    `;
    container.appendChild(logEntry);
    container.scrollTop = container.scrollHeight;
}

function showToast(message, type = 'info') {
    let container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = type === 'success' ? '✓' : (type === 'error' ? '❌' : (type === 'warning' ? '⚠️' : 'ℹ️'));
    toast.innerHTML = `
        <span class="toast-icon">${icon}</span>
        <span class="toast-message">${message}</span>
    `;
    container.appendChild(toast);

    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(() => {
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 300);
    }, 4000);
}

function playSuccessSound() {
    // Simple beep using Web Audio API
    try {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800;
        oscillator.type = 'sine';
        gainNode.gain.value = 0.3;

        // Render schedule if switched to future schedule tab
        if (tab === 'future-schedule') {
            updateRegisteredSchedules().then(() => {
                renderVisualTimetable();
            });
            if (typeof populateFutureQuickCourses === 'function') {
                populateFutureQuickCourses();
            }
        }

        oscillator.start();
        setTimeout(() => {
            oscillator.stop();
            audioContext.close();
        }, 200);
    } catch (e) {
        console.log('Could not play sound');
    }
}

// ==================== Events (Tab 8) ====================
function getEventData() {
    const eventId = document.getElementById('event-id-input').value.trim();
    const dateId = document.getElementById('event-date-id-input').value.trim();
    if (!eventId) {
        showToast('Vui lòng nhập ID sự kiện', 'error');
        return null;
    }
    return { eventId, dateId: dateId || null };
}

async function handleRegisterEvent() {
    const data = getEventData();
    if (!data) return;

    const { eventId, dateId } = data;
    const dateStr = dateId ? `/${dateId}` : '';

    updateStatus(`Đang đăng ký sự kiện ${eventId}${dateStr}...`);
    addLog('event-log', `Đang đăng ký sự kiện ID: ${eventId}${dateStr}...`, 'info');

    const result = await api.registerEvent(eventId, dateId);

    if (result.success) {
        addLog('event-log', `✅ Sự kiện ${eventId}${dateStr}: ${result.message}`, 'success');
        showToast(result.message, 'success');
    } else {
        addLog('event-log', `❌ Sự kiện ${eventId}${dateStr}: ${result.message}`, 'error');
        showToast(result.message, 'error');
    }
    updateStatus('Sẵn sàng');
}

async function handleCancelEvent() {
    const data = getEventData();
    if (!data) return;

    const { eventId } = data;

    if (!confirm(`Bạn có chắc muốn hủy đăng ký sự kiện ID: ${eventId}?`)) return;

    updateStatus(`Đang hủy đăng ký sự kiện ${eventId}...`);
    addLog('event-log', `Đang hủy đăng ký sự kiện ID: ${eventId}...`, 'info');

    const result = await api.cancelEvent(eventId);

    if (result.success) {
        addLog('event-log', `✅ Sự kiện ${eventId}: ${result.message}`, 'success');
        showToast(result.message, 'success');
    } else {
        addLog('event-log', `❌ Sự kiện ${eventId}: ${result.message}`, 'error');
        showToast(result.message, 'error');
    }
    updateStatus('Sẵn sàng');
}

function clearEventLog() {
    document.getElementById('event-log').innerHTML = '';
}

// ==================== Auto Event (Background Backend) ====================
let eventAutoRunning = false;
let eventAutoTimeout = null;

function toggleAutoEvent() {
    if (eventAutoRunning) {
        stopAutoEvent();
    } else {
        startAutoEvent();
    }
}

async function stopAutoEvent() {
    stopAutoEventLocally();
    addLog('event-log', '🛑 Đã dừng Auto Sự kiện', 'warning');
}

function stopAutoEventLocally() {
    eventAutoRunning = false;
    if (eventAutoTimeout) {
        clearInterval(eventAutoTimeout);
        eventAutoTimeout = null;
    }
    const btn = document.getElementById('event-auto-btn');
    if (btn) {
        btn.innerHTML = '▶ Bắt đầu Auto';
        btn.className = 'btn btn-primary';
    }
    updateStatus('Sẵn sàng');
}

async function startAutoEvent() {
    const data = getEventData();
    if (!data) return;

    const retries = parseInt(document.getElementById('event-retry-input').value) || 100;
    const delayMin = parseInt(document.getElementById('event-delay-min-input').value) || 50;
    const delayMax = parseInt(document.getElementById('event-delay-max-input').value) || 100;
    const timerInput = document.getElementById('event-timer-input').value;

    let targetTimeStr = null;
    if (timerInput) {
        const now = new Date();
        const [hours, minutes, seconds] = timerInput.split(':').map(Number);
        const targetTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, seconds || 0);

        if (targetTime <= now) {
            targetTime.setDate(targetTime.getDate() + 1); // Tomorrow
        }
        targetTimeStr = targetTime.toISOString();
    }

    const btn = document.getElementById('event-auto-btn');
    if (btn) {
        btn.innerHTML = '⏹ Dừng Auto ngầm';
        btn.className = 'btn btn-danger';
    }
    eventAutoRunning = true;

    if (targetTimeStr) {
        addLog('event-log', `⏳ Đang đợi đến ${new Date(targetTimeStr).toLocaleTimeString('vi-VN')} để bắt đầu...`, 'info');
        updateStatus('Đang chờ hẹn giờ...');
        const waitTime = new Date(targetTimeStr).getTime() - Date.now();
        eventAutoTimeout = setTimeout(() => runLocalEventLoop(data.eventId, data.dateId, retries, delayMin, delayMax), waitTime);
    } else {
        runLocalEventLoop(data.eventId, data.dateId, retries, delayMin, delayMax);
    }
}

async function runLocalEventLoop(eventId, dateId, retries, delayMin, delayMax) {
    updateStatus('Đang chạy auto...');
    addLog('event-log', `🚀 Bắt đầu Auto Sự kiện: ID ${eventId} (${retries} lượt)`, 'info');

    for (let i = 0; i < retries; i++) {
        if (!eventAutoRunning) return;
        addLog('event-log', `🔄 Lượt ${i + 1}/${retries}...`, 'info');

        const result = await api.registerEvent(eventId, dateId);

        if (result.success && !result.message.toLowerCase().includes('không thành công') && !result.message.toLowerCase().includes('lỗi')) {
            addLog('event-log', `✅ THÀNH CÔNG: ${result.message}`, 'success');
            showToast('Đăng ký sự kiện thành công!', 'success');
            if (typeof playSuccessSound === 'function') playSuccessSound();
            stopAutoEventLocally();
            return;
        } else {
            addLog('event-log', `❌ Thất bại: ${result.message}`, 'error');
        }

        if (i < retries - 1 && eventAutoRunning) {
            const currentDelay = Math.floor(Math.random() * (delayMax - delayMin + 1)) + delayMin;
            addLog('event-log', `⏳ Đợi ${currentDelay}ms...`, 'warning');
            await new Promise(resolve => setTimeout(resolve, currentDelay));
        }
    }

    if (eventAutoRunning) {
        addLog('event-log', '🛑 Đã hoàn thành tất cả lượt thử', 'warning');
        stopAutoEventLocally();
    }
}

// ==================== Future Schedule Planner ====================
let previewClasses = [];
let currentTimetablePhase = 1;
let currentFutureScheduleType = 'main';

function setFutureScheduleType(type) {
    currentFutureScheduleType = type;
    const typeInput = document.getElementById('future-type-select');
    if (typeInput) typeInput.value = type;

    const btnMain = document.getElementById('future-type-btn-main');
    const btnExtra = document.getElementById('future-type-btn-extra');
    const inputEl = document.getElementById('future-input');

    if (btnMain && btnExtra) {
        if (type === 'main') {
            btnMain.style.cssText = 'flex: 1; padding: 7px 10px; font-size: 12px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s; background: #0284c7; color: white; box-shadow: 0 2px 4px rgba(2,132,199,0.25);';
            btnExtra.style.cssText = 'flex: 1; padding: 7px 10px; font-size: 12px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s; background: transparent; color: #475569;';
            if (inputEl) {
                inputEl.placeholder = 'Nhập Mã HP hoặc ID Lớp (Môn chính):\n219001\n0101004117';
            }
        } else {
            btnMain.style.cssText = 'flex: 1; padding: 7px 10px; font-size: 12px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s; background: transparent; color: #475569;';
            btnExtra.style.cssText = 'flex: 1; padding: 7px 10px; font-size: 12px; font-weight: 600; border: none; border-radius: 6px; cursor: pointer; transition: all 0.2s; background: #059669; color: white; box-shadow: 0 2px 4px rgba(5,150,105,0.25);';
            if (inputEl) {
                inputEl.placeholder = 'Nhập Mã HP hoặc ID Lớp (Môn điều kiện):\n219014\n0101004118';
            }
        }
    }

    populateFutureQuickCourses();
}

async function reloadFutureQuickCourses() {
    const idDot = getIdDot();
    updateStatus('Đang tải danh sách môn học...');
    try {
        const [mainRes, extraRes] = await Promise.all([
            api.getMainCourses(idDot),
            api.getExtraCourses(idDot)
        ]);
        if (mainRes && mainRes.success && mainRes.data) _mainCoursesData = mainRes.data;
        if (extraRes && extraRes.success && extraRes.data) _extraCoursesData = extraRes.data;
        populateFutureQuickCourses();
        showToast('Đã cập nhật danh sách môn học', 'success');
    } catch (e) {
        showToast('Không thể tải danh sách môn học', 'error');
    }
}

function populateFutureQuickCourses() {
    const select = document.getElementById('future-course-quick-select');
    if (!select) return;

    const type = document.getElementById('future-type-select')?.value || currentFutureScheduleType || 'main';
    const courses = type === 'extra' ? _extraCoursesData : _mainCoursesData;
    const typeLabel = type === 'extra' ? 'môn điều kiện' : 'môn chính';

    select.innerHTML = `<option value="">-- Chọn nhanh ${typeLabel} (${courses.length} môn) --</option>`;
    if (courses.length === 0) {
        select.innerHTML += `<option value="" disabled>(Chưa có dữ liệu - nhấn 'Tải DS môn')</option>`;
        return;
    }

    courses.forEach(c => {
        const ma = c.maHocPhan || c.maMonHoc || '';
        const ten = c.tenHocPhan || c.tenMonHoc || '';
        const tc = c.soTinChi ? ` (${c.soTinChi} TC)` : '';
        if (ma) {
            const opt = document.createElement('option');
            opt.value = ma;
            opt.textContent = `${ma} - ${ten}${tc}`;
            select.appendChild(opt);
        }
    });
}

function onFutureQuickCourseSelect(maHocPhan) {
    if (!maHocPhan) return;
    const input = document.getElementById('future-input');
    if (!input) return;

    const currentLines = input.value.split('\n').map(l => l.trim()).filter(l => l !== '');
    if (!currentLines.includes(maHocPhan)) {
        currentLines.push(maHocPhan);
        input.value = currentLines.join('\n');
    }
}

async function processFutureScheduleInputs() {
    const inputEl = document.getElementById('future-input');
    const inputVal = inputEl.value.trim();
    if (!inputVal) { showToast('Vui lòng nhập Mã học phần hoặc ID Lớp', 'error'); return; }

    const lines = inputVal.split('\n').map(l => l.trim()).filter(l => l !== '');
    const idDot = getIdDot();
    const selectedType = document.getElementById('future-type-select')?.value || currentFutureScheduleType || 'main';
    const typeText = selectedType === 'extra' ? 'môn điều kiện' : 'môn chính';

    updateStatus(`Đang xử lý lịch dự kiến (${typeText})...`);
    showToast(`Đang tải dữ liệu lịch ${typeText}...`, 'info');

    for (const line of lines) {
        let found = false;

        // 1. Thử lấy thông tin nếu 'line' là ID lớp (dùng đúng API tương ứng với selectedType)
        try {
            const res = await api.getClassDetail(line, selectedType);
            if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
                const d = res.data[0];
                const tenHocPhan = d.tenHocPhan || d.tenMonHoc || d.tenHocPhanMoi || '';
                const maHocPhan = d.maHocPhan || d.maMonHoc || line;
                const tenLop = d.tenLopHocPhan || `Lớp ${line}`;
                const maLop = d.maLopHocPhan || '';

                if (!previewClasses.some(c => String(c.id) === String(line))) {
                    previewClasses.push({
                        id: line,
                        maHocPhan: maHocPhan,
                        tenLopHocPhan: tenLop,
                        maLopHocPhan: maLop,
                        tenHocPhan: tenHocPhan || tenLop,
                        scheduleDetails: res.data,
                        checked: true,
                        type: selectedType
                    });
                }
                found = true;
            }
        } catch (e) {
            // Không phải ID lớp hoặc không tìm thấy
        }

        // 2. Nếu không phải ID lớp, tìm theo Mã Học Phần
        if (!found) {
            try {
                let classRes;
                if (selectedType === 'extra') {
                    // Môn học điều kiện: sử dụng API /dkhpdk/getLopHocPhan
                    classRes = await api.getExtraClasses(idDot, line);
                } else {
                    // Môn học chính: sử dụng API /dkhp/getLopHocPhanChoDangKy
                    classRes = await api.getMainClasses(idDot, line);
                }

                const classes = (classRes && classRes.success) ? (classRes.data || []) : [];
                if (classes.length > 0) {
                    const tenHocPhanFromList = classes[0]?.tenHocPhan || classes[0]?.tenMonHoc || classes[0]?.tenHocPhanMoi || '';
                    const fetched = (await Promise.all(classes.map(async cls => {
                        if (previewClasses.some(c => String(c.id) === String(cls.id))) return null;
                        try {
                            // Gọi chi tiết lịch của lớp theo đúng loại môn
                            const dr = await api.getClassDetail(cls.id, selectedType);
                            if (dr && dr.success && Array.isArray(dr.data) && dr.data.length > 0) {
                                const tHP = cls.tenHocPhan || cls.tenMonHoc || cls.tenHocPhanMoi || dr.data[0]?.tenHocPhan || dr.data[0]?.tenMonHoc || tenHocPhanFromList || line;
                                return {
                                    id: cls.id,
                                    maHocPhan: line,
                                    tenLopHocPhan: cls.tenLopHocPhan || `Lớp ${cls.id}`,
                                    maLopHocPhan: cls.maLopHocPhan || '',
                                    tenHocPhan: tHP,
                                    scheduleDetails: dr.data,
                                    checked: false,
                                    type: selectedType,
                                    siSoHienTai: cls.siSoHienTai || 0,
                                    siSoMax: cls.siSoMax || 0
                                };
                            }
                        } catch (err) { }
                        return null;
                    }))).filter(c => c !== null);

                    if (fetched.length > 0) {
                        previewClasses.push(...fetched);
                        found = true;
                    } else {
                        showToast(`Các lớp của ${line} đã có trong danh sách`, 'info');
                        found = true;
                    }
                }
            } catch (err) {
                console.error('Lỗi khi lấy mã học phần:', line, err);
            }
        }

        if (!found) {
            showToast(`Không tìm thấy ${typeText} hoặc ID lớp: ${line}`, 'warning');
        }
    }

    updateStatus('Đã cập nhật lịch dự kiến');
    showToast('Đã tải lịch dự kiến!', 'success');
    renderPlannerChecklist();
    renderVisualTimetable();
}


function clearFutureInputs() {
    document.getElementById('future-input').value = '';
    previewClasses = [];
    renderPlannerChecklist();
    renderVisualTimetable();
    showToast('Đã xóa dữ liệu lịch dự kiến', 'info');
}

function togglePlannerClass(classId, checked) {
    const cls = previewClasses.find(c => String(c.id) === String(classId));
    if (cls) { cls.checked = checked; renderVisualTimetable(); }
}

function removePlannerClass(classId) {
    previewClasses = previewClasses.filter(c => String(c.id) !== String(classId));
    renderPlannerChecklist();
    renderVisualTimetable();
}

function copyFutureIdsToRegister() {
    const ids = previewClasses.filter(c => c.checked).map(c => c.id);
    if (ids.length === 0) { showToast('Vui lòng chọn ít nhất một lớp', 'error'); return; }
    const ta = document.getElementById('class-ids');
    if (ta) {
        ta.value = ids.join('\n');
        const first = previewClasses.find(c => c.checked);
        if (first && first.type) document.getElementById('register-type').value = first.type;
        switchTab('register');
        showToast(`Đã sao chép ${ids.length} ID lớp sang tab Đăng ký!`, 'success');
    }
}

function formatScheduleDates(details) {
    if (!details || details.length === 0) return '';
    const f = details[0];
    if (!f.ngayBatDau || !f.ngayKetThuc) return '';
    const fmt = s => { const d = new Date(s); return isNaN(d) ? '' : `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`; };
    const s = fmt(f.ngayBatDau), e = fmt(f.ngayKetThuc);
    return s && e ? `${s} - ${e}` : '';
}

function getSemesterStartDate() {
    let earliest = null;
    const check = d => { if (!isNaN(d.getTime()) && (!earliest || d < earliest)) earliest = d; };
    (registeredSchedules || []).forEach(s => s.ngayBatDau && check(new Date(s.ngayBatDau)));
    (previewClasses || []).filter(c => c.checked).forEach(cls => (cls.scheduleDetails || []).forEach(s => s.ngayBatDau && check(new Date(s.ngayBatDau))));
    return earliest;
}

function isClassInPhase(startStr, endStr, phase, earliestDate) {
    if (!startStr) return phase === 1;
    const start = new Date(startStr);
    if (isNaN(start.getTime())) return phase === 1;
    const ref = earliestDate ? new Date(earliestDate) : new Date();
    let yr = ref.getFullYear();
    if (ref.getMonth() < 7) yr--;
    const p1s = new Date(yr, 8, 28), p1e = new Date(yr, 11, 6);
    const p2s = new Date(yr, 11, 7), p2e = new Date(yr + 1, 1, 28);
    const ce = endStr ? new Date(endStr) : start;
    return phase === 1 ? (start <= p1e && ce >= p1s) : (start <= p2e && ce >= p2s);
}

function switchTimetablePhase(phase) {
    currentTimetablePhase = phase;
    const b1 = document.getElementById('btn-phase-1');
    const b2 = document.getElementById('btn-phase-2');
    if (b1 && b2) {
        if (phase === 1) {
            b1.style.cssText = 'padding:5px 14px;border-radius:20px;border:2px solid white;background:white;color:#1e40af;font-weight:700;font-size:12px;cursor:pointer;';
            b2.style.cssText = 'padding:5px 14px;border-radius:20px;border:2px solid rgba(255,255,255,0.5);background:transparent;color:white;font-weight:600;font-size:12px;cursor:pointer;';
        } else {
            b1.style.cssText = 'padding:5px 14px;border-radius:20px;border:2px solid rgba(255,255,255,0.5);background:transparent;color:white;font-weight:600;font-size:12px;cursor:pointer;';
            b2.style.cssText = 'padding:5px 14px;border-radius:20px;border:2px solid white;background:white;color:#1e40af;font-weight:700;font-size:12px;cursor:pointer;';
        }
    }
    renderVisualTimetable();
}


function renderPlannerChecklist() {
    const cardEl = document.getElementById('planner-checklist-card');
    const container = document.getElementById('planner-classes-checklist');
    if (!container || !cardEl) return;
    container.innerHTML = '';
    if (previewClasses.length === 0) { cardEl.style.display = 'none'; return; }
    cardEl.style.display = 'block';

    const groups = {};
    previewClasses.forEach(cls => {
        const key = cls.maHocPhan || cls.id;
        if (!groups[key]) groups[key] = { maHocPhan: cls.maHocPhan, tenHocPhan: cls.tenHocPhan, type: cls.type, classes: [] };
        groups[key].classes.push(cls);
    });

    Object.values(groups).forEach(group => {
        const groupEl = document.createElement('div');
        groupEl.style.marginBottom = '15px';
        const isExtra = group.type === 'extra' || group.classes.some(c => c.type === 'extra');
        const typeBadge = isExtra
            ? '<span style="background:#ecfdf5;color:#059669;border:1px solid #a7f3d0;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:6px;">📗 Điều kiện</span>'
            : '<span style="background:#eff6ff;color:#2563eb;border:1px solid #bfdbfe;padding:2px 6px;border-radius:4px;font-size:10px;font-weight:600;margin-left:6px;">📘 Môn chính</span>';
        groupEl.innerHTML = `<div style="font-weight:bold;color:var(--primary);font-size:13px;margin-bottom:6px;border-bottom:1px solid var(--border-color);padding-bottom:4px;display:flex;align-items:center;flex-wrap:wrap;">📚 ${group.maHocPhan} - ${group.tenHocPhan}${typeBadge}</div>`;
        group.classes.forEach(cls => {
            const schedText = cls.scheduleDetails?.length > 0
                ? cls.scheduleDetails.map(s => {
                    const tStr = formatSessionTiet(s) || (s.tietHoc || s.tiet ? `Tiết ${s.tietHoc || s.tiet}` : '');
                    return `Thứ ${s.thu}${tStr ? ` (${tStr})` : ''}`;
                }).join(', ')
                : 'Chưa có lịch';
            const dateRange = formatScheduleDates(cls.scheduleDetails);
            const dateHtml = dateRange ? `<div style="font-size:11px;color:var(--text-secondary);margin-top:2px;">📅 Thời gian: <strong>${dateRange}</strong></div>` : '';
            const capText = cls.siSoMax > 0 ? ` (${cls.siSoHienTai}/${cls.siSoMax})` : '';
            const earliest = getSemesterStartDate();
            let phaseTag = '';
            if (cls.scheduleDetails?.length > 0 && earliest) {
                const s0 = cls.scheduleDetails[0];
                const p1 = isClassInPhase(s0.ngayBatDau, s0.ngayKetThuc, 1, earliest);
                const p2 = isClassInPhase(s0.ngayBatDau, s0.ngayKetThuc, 2, earliest);
                if (p1 && p2) phaseTag = '<span style="background:#3b82f6;color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:5px;">Đợt 1 & 2</span>';
                else if (p1) phaseTag = '<span style="background:#0d9488;color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:5px;">Đợt 1</span>';
                else if (p2) phaseTag = '<span style="background:#ea580c;color:#fff;padding:2px 6px;border-radius:4px;font-size:10px;margin-left:5px;">Đợt 2</span>';
            }
            const itemEl = document.createElement('div');
            itemEl.style.cssText = 'display:flex;align-items:flex-start;gap:8px;padding:8px;border:1px solid var(--border-color);border-radius:6px;margin-bottom:6px;';
            itemEl.innerHTML = `
                <input type="checkbox" id="chk-prev-${cls.id}" ${cls.checked ? 'checked' : ''} onchange="togglePlannerClass('${cls.id}',this.checked)" style="margin-top:3px;flex-shrink:0;">
                <div style="flex:1;cursor:pointer;" onclick="document.getElementById('chk-prev-${cls.id}').click()">
                    <div style="font-weight:600;font-size:13px;">${cls.tenLopHocPhan}${phaseTag}</div>
                    <div style="font-size:12px;color:var(--text-secondary);">ID: <strong>${cls.id}</strong>${cls.maLopHocPhan ? ` | Mã lớp: <strong>${cls.maLopHocPhan}</strong>` : ''}${capText}</div>
                    <div style="font-size:12px;color:var(--text-secondary);">📅 ${schedText}</div>
                    ${dateHtml}
                </div>
                <button onclick="removePlannerClass('${cls.id}');event.stopPropagation();" style="color:var(--danger);font-size:14px;background:none;border:none;cursor:pointer;padding:4px;">✕</button>
            `;
            groupEl.appendChild(itemEl);
        });
        container.appendChild(groupEl);
    });
}

function renderVisualTimetable() {
    const tbody = document.querySelector('#visual-timetable tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    const caList = [
        { id: 1, name: 'Ca 1', sessionName: 'Sáng', startPeriod: 1, endPeriod: 3, time: '06:45-09:15' },
        { id: 2, name: 'Ca 2', sessionName: 'Sáng', startPeriod: 4, endPeriod: 6, time: '09:25-11:55' },
        { id: 3, name: 'Ca 3', sessionName: 'Chiều', startPeriod: 7, endPeriod: 9, time: '12:10-14:40' },
        { id: 4, name: 'Ca 4', sessionName: 'Chiều', startPeriod: 10, endPeriod: 12, time: '14:50-17:20' },
        { id: 5, name: 'Ca 5', sessionName: 'Tối', startPeriod: 13, endPeriod: 15, time: '17:30-20:00' },
        { id: 6, name: 'Ca 6', sessionName: 'Tối', startPeriod: 16, endPeriod: 18, time: '20:10-22:40' }
    ];
    const days = [2, 3, 4, 5, 6, 7, 8];
    const earliest = getSemesterStartDate();

    caList.forEach(ca => {
        const row = document.createElement('tr');
        if (ca.id % 2 === 1) {
            const sc = document.createElement('td');
            sc.rowSpan = 2;
            sc.style.cssText = 'font-weight:bold;text-align:center;background:var(--bg-secondary);font-size:11px;writing-mode:vertical-rl;';
            sc.textContent = ca.sessionName;
            row.appendChild(sc);
        }
        const caCell = document.createElement('td');
        caCell.style.cssText = 'text-align:center;font-size:11px;background:var(--bg-secondary);white-space:nowrap;min-width:60px;';
        caCell.innerHTML = `<strong>${ca.name}</strong><div style="font-size:9px;color:var(--text-muted);margin-top:2px;">${ca.time}</div>`;
        row.appendChild(caCell);

        days.forEach(day => {
            const cell = document.createElement('td');
            cell.style.cssText = 'vertical-align:top;padding:4px;min-width:90px;';

            const regClasses = (registeredSchedules || []).filter(reg => {
                if (parseInt(reg.thu) !== day) return false;
                const r = parseTietRange(reg.tietHoc || reg.tiet);
                if (!r || Math.max(r.start, ca.startPeriod) > Math.min(r.end, ca.endPeriod)) return false;
                let ss = reg.ngayBatDau, es = reg.ngayKetThuc;
                if (!ss) { const sib = registeredSchedules.find(x => x.ngayBatDau && x.maLopHocPhan === reg.maLopHocPhan); if (sib) { ss = sib.ngayBatDau; es = sib.ngayKetThuc; } }
                return isClassInPhase(ss, es, currentTimetablePhase, earliest);
            });

            const prevList = (previewClasses || []).filter(c => c.checked).flatMap(cls => {
                const first = cls.scheduleDetails?.find(s => s.ngayBatDau) || cls.scheduleDetails?.[0] || {};
                return (cls.scheduleDetails || []).filter(s => {
                    if (parseInt(s.thu) !== day) return false;
                    const r = parseTietRange(s.tietHoc || s.tiet);
                    if (!r || Math.max(r.start, ca.startPeriod) > Math.min(r.end, ca.endPeriod)) return false;
                    return isClassInPhase(s.ngayBatDau || first.ngayBatDau, s.ngayKetThuc || first.ngayKetThuc, currentTimetablePhase, earliest);
                }).map(session => ({ ...cls, sessionDetail: session }));
            });

            const regGrouped = {};
            regClasses.forEach(reg => { const k = reg.maLopHocPhan || reg.tenMonHoc; if (!regGrouped[k]) regGrouped[k] = { ...reg, sessions: [] }; regGrouped[k].sessions.push(reg); });
            const prevGrouped = {};
            prevList.forEach(prev => { if (!prevGrouped[prev.id]) prevGrouped[prev.id] = { ...prev, sessions: [] }; prevGrouped[prev.id].sessions.push(prev.sessionDetail); });

            const hasConflict = false; // Đã tắt cảnh báo trùng lịch

            Object.values(regGrouped).forEach(reg => {
                const card = document.createElement('div');
                card.style.cssText = 'background:#f1f5f9;border-left:3px solid #64748b;border-radius:4px;padding:4px 6px;margin-bottom:4px;font-size:11px;color:#475569;';
                const name = reg.tenMonHoc || reg.maLopHocPhan || 'Đã đăng ký';

                let phaseTag = '';
                if (reg.sessions.length > 0 && earliest) {
                    const s0 = reg.sessions[0];
                    let ss = s0.ngayBatDau, es = s0.ngayKetThuc;
                    if (!ss && registeredSchedules) { const sib = registeredSchedules.find(x => x.ngayBatDau && x.maLopHocPhan === reg.maLopHocPhan); if (sib) { ss = sib.ngayBatDau; es = sib.ngayKetThuc; } }
                    const p1 = isClassInPhase(ss, es, 1, earliest);
                    const p2 = isClassInPhase(ss, es, 2, earliest);
                    if (p1 && p2) phaseTag = '<span style="background:#64748b;color:#fff;padding:2px 4px;border-radius:3px;font-size:9px;margin-left:4px;white-space:nowrap;">Đợt 1 & 2</span>';
                    else if (p1) phaseTag = '<span style="background:#64748b;color:#fff;padding:2px 4px;border-radius:3px;font-size:9px;margin-left:4px;white-space:nowrap;">Đợt 1</span>';
                    else if (p2) phaseTag = '<span style="background:#64748b;color:#fff;padding:2px 4px;border-radius:3px;font-size:9px;margin-left:4px;white-space:nowrap;">Đợt 2</span>';
                }

                let dHtml = '';
                reg.sessions.forEach(s => {
                    const room = s.phong || '';
                    const tietStr = formatSessionTiet(s, ca);
                    let dt = '';
                    if (s.ngayBatDau && s.ngayKetThuc) { const sd = new Date(s.ngayBatDau), ed = new Date(s.ngayKetThuc); if (!isNaN(sd) && !isNaN(ed)) dt = `${String(sd.getDate()).padStart(2, '0')}/${String(sd.getMonth() + 1).padStart(2, '0')}-${String(ed.getDate()).padStart(2, '0')}/${String(ed.getMonth() + 1).padStart(2, '0')}`; }
                    const tBadge = tietStr ? `<span style="background:#e2e8f0;color:#334155;padding:1px 5px;border-radius:3px;font-weight:700;font-size:9.5px;margin-right:4px;display:inline-flex;align-items:center;gap:2px;">⏰ ${tietStr}</span>` : '';
                    dHtml += `<div style="font-size:9px;opacity:.95;margin-top:2px;line-height:1.4;">${tBadge}${room ? `📍 ${room}` : ''} ${dt ? `📅 ${dt}` : ''}</div>`;
                });
                card.innerHTML = `<div style="font-weight:600;display:flex;flex-wrap:wrap;align-items:center;gap:2px;" title="${name}">🔒 ${name}${phaseTag}</div><div>Mã: ${reg.maLopHocPhan || ''}</div>${dHtml}`;
                cell.appendChild(card);
            });

            Object.values(prevGrouped).forEach(prev => {
                const isExtra = prev.type === 'extra';
                const card = document.createElement('div');

                let cardStyle = '';
                let typeBadge = '';

                if (hasConflict) {
                    cardStyle = 'background:#fee2e2;border-left:3px solid #dc2626;border-radius:4px;padding:4px 6px;margin-bottom:4px;font-size:11px;color:#991b1b;';
                    typeBadge = '<span style="background:#dc2626;color:#fff;padding:1px 4px;border-radius:3px;font-size:9px;margin-left:4px;white-space:nowrap;font-weight:bold;">⚠️ Trùng lịch</span>';
                } else if (isExtra) {
                    cardStyle = 'background:#ecfdf5;border-left:3px solid #10b981;border-radius:4px;padding:4px 6px;margin-bottom:4px;font-size:11px;color:#065f46;';
                    typeBadge = '<span style="background:#10b981;color:#fff;padding:1px 4px;border-radius:3px;font-size:9px;margin-left:4px;white-space:nowrap;">Điều kiện</span>';
                } else {
                    cardStyle = 'background:#eff6ff;border-left:3px solid #2563eb;border-radius:4px;padding:4px 6px;margin-bottom:4px;font-size:11px;color:#1e40af;';
                    typeBadge = '<span style="background:#2563eb;color:#fff;padding:1px 4px;border-radius:3px;font-size:9px;margin-left:4px;white-space:nowrap;">Môn chính</span>';
                }

                card.style.cssText = cardStyle;
                const name = prev.tenHocPhan || prev.tenLopHocPhan || 'Dự kiến';

                let phaseTag = '';
                if (prev.sessions.length > 0 && earliest) {
                    const s0 = prev.sessions[0];
                    const p1 = isClassInPhase(s0.ngayBatDau, s0.ngayKetThuc, 1, earliest);
                    const p2 = isClassInPhase(s0.ngayBatDau, s0.ngayKetThuc, 2, earliest);
                    if (p1 && p2) phaseTag = '<span style="background:#3b82f6;color:#fff;padding:2px 4px;border-radius:3px;font-size:9px;margin-left:4px;white-space:nowrap;">Đợt 1 & 2</span>';
                    else if (p1) phaseTag = '<span style="background:#0d9488;color:#fff;padding:2px 4px;border-radius:3px;font-size:9px;margin-left:4px;white-space:nowrap;">Đợt 1</span>';
                    else if (p2) phaseTag = '<span style="background:#ea580c;color:#fff;padding:2px 4px;border-radius:3px;font-size:9px;margin-left:4px;white-space:nowrap;">Đợt 2</span>';
                }

                let dHtml = '';
                prev.sessions.forEach(s => {
                    const room = s.phong || ''; const typeT = s.loaiLich || 'LT';
                    const tietStr = formatSessionTiet(s, ca);
                    let dt = '';
                    if (s.ngayBatDau && s.ngayKetThuc) { const sd = new Date(s.ngayBatDau), ed = new Date(s.ngayKetThuc); if (!isNaN(sd) && !isNaN(ed)) dt = `${String(sd.getDate()).padStart(2, '0')}/${String(sd.getMonth() + 1).padStart(2, '0')}-${String(ed.getDate()).padStart(2, '0')}/${String(ed.getMonth() + 1).padStart(2, '0')}`; }
                    const badgeBg = hasConflict ? '#fecaca' : (isExtra ? '#d1fae5' : '#dbeafe');
                    const badgeColor = hasConflict ? '#991b1b' : (isExtra ? '#047857' : '#1e40af');
                    const tBadge = tietStr ? `<span style="background:${badgeBg};color:${badgeColor};padding:1px 5px;border-radius:3px;font-weight:700;font-size:9.5px;margin-right:4px;display:inline-flex;align-items:center;gap:2px;">⏰ ${tietStr}</span>` : '';
                    dHtml += `<div style="font-size:9px;opacity:.95;margin-top:2px;line-height:1.4;">${tBadge}<span style="opacity:0.85;margin-right:3px;">[${typeT}]</span>${room ? `<span style="margin-right:4px;">📍 ${room}</span>` : ''}${dt ? `<span>🗓️ ${dt}</span>` : ''}</div>`;
                });
                const icon = isExtra ? '📗' : '📘';
                card.innerHTML = `<div style="font-weight:600;display:flex;flex-wrap:wrap;align-items:center;gap:2px;" title="${name}">${icon} ${name}${phaseTag}${typeBadge}</div><div>ID: ${prev.id}${prev.maLopHocPhan ? ` | ${prev.maLopHocPhan}` : ''}</div>${dHtml}`;
                cell.appendChild(card);
            });

            row.appendChild(cell);
        });
        tbody.appendChild(row);
    });
}

function renderFutureScheduleList() { }

