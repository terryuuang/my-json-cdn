/**
 * Supabase 認證與雲端同步模組 - APEINTEL ATLAS
 * 
 * 功能：
 * - Google OAuth 登入
 * - 用戶審核系統（pending/approved/rejected/banned）
 * - 筆記雲端同步（Supabase Storage）
 * - 自動定時同步
 * - 儲存空間管理
 * - 管理員介面
 * - 線上狀態追蹤
 * 
 * 安全注意事項：
 * - ANON KEY 僅用於前端公開操作，透過 RLS 保護資料
 * - 管理員權限通過資料庫 RLS 判斷，不在前端暴露
 */

// ============================================
// Supabase 設定
// ============================================
const SUPABASE_URL = 'https://uxmfhlvmhyktfujcrwao.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InV4bWZobHZtaHlrdGZ1amNyd2FvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQxOTk5OTYsImV4cCI6MjA3OTc3NTk5Nn0.SsqhbaND-gBWZvwNlI3xHzbFBynH9oxfeLt5ToH-jpM';

// Storage Bucket 名稱
const NOTES_BUCKET = 'user-notes';

// 預設儲存限制（15MB）
const DEFAULT_STORAGE_LIMIT_BYTES = 15 * 1024 * 1024;

// 自動同步間隔（毫秒）
const DEFAULT_AUTO_SYNC_INTERVAL_MS = 5 * 60 * 1000; // 5 分鐘

// 線上狀態心跳間隔（毫秒）
const HEARTBEAT_INTERVAL_MS = 60 * 1000; // 1 分鐘

// ============================================
// 狀態管理
// ============================================
let supabaseClient = null;
let currentUser = null;
let userProfile = null;
let authStateSubscription = null;
let autoSyncInterval = null;
let heartbeatInterval = null;
let mapInstance = null;

// ============================================
// SDK 載入
// ============================================
async function loadSupabaseSDK() {
  if (window.supabase) {
    return window.supabase;
  }

  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';
    script.async = true;
    script.onload = () => {
      resolve(window.supabase);
    };
    script.onerror = () => {
      console.error('[Auth] SDK 載入失敗');
      reject(new Error('無法載入 Supabase SDK'));
    };
    document.head.appendChild(script);
  });
}

// ============================================
// 初始化
// ============================================
async function initSupabase() {
  try {
    const sdk = await loadSupabaseSDK();
    
    supabaseClient = sdk.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: true,
        persistSession: true,
        detectSessionInUrl: true,
        flowType: 'pkce'
      }
    });

    // 監聽認證狀態變化（不阻塞 - 非同步處理）
    const { data: { subscription } } = supabaseClient.auth.onAuthStateChange(
      (event, session) => {
        if (session) {
          currentUser = session.user;
          // 非阻塞式處理，不使用 await
          handleAuthenticatedUser().catch(err => {
            console.error('[Auth] 處理登入後邏輯失敗:', err);
          });
        } else {
          currentUser = null;
          userProfile = null;
          stopAutoSync();
          stopHeartbeat();
        }
        
        updateAuthUI();
      }
    );
    authStateSubscription = subscription;

    // 檢查現有 session
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
      currentUser = session.user;
      // 非阻塞式處理
      handleAuthenticatedUser().catch(err => {
        console.error('[Auth] 處理現有 session 失敗:', err);
      });
    }

    updateAuthUI();
    
    return supabaseClient;
  } catch (error) {
    console.error('[Auth] 初始化失敗:', error);
    throw error;
  }
}

// 處理已認證用戶的後續邏輯（非阻塞）
async function handleAuthenticatedUser() {
  try {
    // 載入用戶 profile（帶超時）
    await Promise.race([
      loadUserProfile(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Profile 載入超時')), 10000))
    ]).catch(err => {
      console.warn('[Auth] Profile 載入失敗或超時:', err.message);
    });
    
    // 啟動心跳（不等待）
    startHeartbeat();
    
    // 檢查自動同步
    if (userProfile?.auto_sync_enabled && userProfile?.status === 'approved') {
      startAutoSync();
    }
    
    // 更新 UI
    updateAuthUI();
  } catch (error) {
    console.error('[Auth] handleAuthenticatedUser 錯誤:', error);
  }
}

// ============================================
// 用戶 Profile 管理
// ============================================
async function loadUserProfile() {
  if (!supabaseClient || !currentUser) return null;
  
  try {
    const { data, error } = await supabaseClient.rpc('get_my_profile');
    
    if (error) {
      console.error('[Auth] 載入 Profile 失敗:', error);
      return null;
    }
    
    if (data && data.length > 0) {
      userProfile = data[0];
      return userProfile;
    }
    
    return null;
  } catch (error) {
    console.error('[Auth] 載入 Profile 例外:', error);
    return null;
  }
}

function getUserProfile() {
  return userProfile;
}

function isAdmin() {
  return userProfile?.is_admin === true;
}

function isApproved() {
  return userProfile?.status === 'approved';
}

function getUserStatus() {
  return userProfile?.status || null;
}

// ============================================
// 認證功能
// ============================================
async function signInWithGoogle() {
  if (!supabaseClient) {
    showAuthToast('認證服務尚未就緒，請稍後再試', 'error');
    return { error: new Error('Supabase 尚未初始化') };
  }

  try {
    const redirectTo = window.location.origin + window.location.pathname;
    
    const { data, error } = await supabaseClient.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: redirectTo,
        queryParams: {
          access_type: 'offline',
          prompt: 'consent'
        }
      }
    });

    if (error) {
      console.error('[Auth] Google 登入失敗:', error);
      showAuthToast('登入失敗：' + error.message, 'error');
      return { error };
    }

    return { data };
  } catch (error) {
    console.error('[Auth] Google 登入例外:', error);
    showAuthToast('登入時發生錯誤', 'error');
    return { error };
  }
}

async function signOut() {
  if (!supabaseClient) {
    return { error: new Error('Supabase 尚未初始化') };
  }

  try {
    stopAutoSync();
    stopHeartbeat();
    
    const { error } = await supabaseClient.auth.signOut();
    
    if (error) {
      console.error('[Auth] 登出失敗:', error);
      showAuthToast('登出失敗', 'error');
      return { error };
    }

    userProfile = null;
    showAuthToast('已成功登出');
    return { error: null };
  } catch (error) {
    console.error('[Auth] 登出例外:', error);
    return { error };
  }
}

function getCurrentUser() {
  return currentUser;
}

function isAuthenticated() {
  return currentUser !== null;
}

// ============================================
// 線上狀態（心跳）
// ============================================
async function updateLastSeen() {
  if (!supabaseClient || !currentUser) return;
  
  try {
    await supabaseClient.rpc('update_last_seen');
  } catch (error) {
    console.error('[Auth] 更新 last_seen 失敗:', error);
  }
}

function startHeartbeat() {
  stopHeartbeat();
  // 不等待，避免阻塞
  updateLastSeen().catch(() => {});
  heartbeatInterval = setInterval(() => {
    updateLastSeen().catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ============================================
// 自動同步
// ============================================
function startAutoSync() {
  stopAutoSync();
  
  if (!isApproved()) return;
  
  const interval = (userProfile?.auto_sync_interval_minutes || 5) * 60 * 1000;
  
  autoSyncInterval = setInterval(async () => {
    await syncToCloud(true); // 靜默模式
  }, interval);
}

function stopAutoSync() {
  if (autoSyncInterval) {
    clearInterval(autoSyncInterval);
    autoSyncInterval = null;
  }
}

async function updateAutoSyncSetting(enabled, intervalMinutes = null) {
  if (!supabaseClient || !currentUser) return { error: new Error('未登入') };
  
  try {
    const { data, error } = await supabaseClient.rpc('update_my_settings', {
      p_auto_sync_enabled: enabled,
      p_auto_sync_interval_minutes: intervalMinutes
    });
    
    if (error) throw error;
    
    // 重新載入 Profile
    await loadUserProfile();
    
    if (enabled && isApproved()) {
      startAutoSync();
      showAuthToast('已啟用自動同步');
    } else {
      stopAutoSync();
      if (!enabled) showAuthToast('已停用自動同步');
    }
    
    return { data, error: null };
  } catch (error) {
    console.error('[Auth] 更新自動同步設定失敗:', error);
    return { error };
  }
}

// ============================================
// 雲端同步功能
// ============================================
function getUserNotesPath(userId) {
  return `${userId}/notes.json`;
}

async function uploadNotesToCloud(notes) {
  if (!supabaseClient || !currentUser) {
    return { error: new Error('請先登入') };
  }
  
  if (!isApproved()) {
    return { error: new Error('您的帳號尚未獲得批准，無法使用雲端功能') };
  }

  try {
    const userId = currentUser.id;
    const filePath = getUserNotesPath(userId);
    const storageLimit = userProfile?.storage_limit_bytes || DEFAULT_STORAGE_LIMIT_BYTES;
    
    const exportData = {
      version: '1.0',
      syncedAt: new Date().toISOString(),
      userId: userId,
      notesCount: notes.length,
      notes: notes
    };

    const jsonContent = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonContent], { type: 'application/json' });
    
    if (blob.size > storageLimit) {
      return { 
        error: new Error(`筆記資料超過 ${(storageLimit / 1024 / 1024).toFixed(1)}MB 限制`) 
      };
    }

    const { data, error } = await supabaseClient.storage
      .from(NOTES_BUCKET)
      .upload(filePath, blob, {
        cacheControl: '0',
        upsert: true,
        contentType: 'application/json'
      });

    if (error) {
      console.error('[Auth] 上傳筆記失敗:', error);
      return { error };
    }

    return { data, error: null, size: blob.size };
  } catch (error) {
    console.error('[Auth] 上傳筆記例外:', error);
    return { error };
  }
}

async function downloadNotesFromCloud() {
  if (!supabaseClient || !currentUser) {
    return { data: null, error: new Error('請先登入') };
  }
  
  if (!isApproved()) {
    return { data: null, error: new Error('您的帳號尚未獲得批准') };
  }

  try {
    const userId = currentUser.id;
    const filePath = getUserNotesPath(userId);

    const { data, error } = await supabaseClient.storage
      .from(NOTES_BUCKET)
      .download(filePath);

    if (error) {
      if (error.message.includes('not found') || error.message.includes('Object not found')) {
        return { data: null, error: null, isEmpty: true };
      }
      console.error('[Auth] 下載筆記失敗:', error);
      return { data: null, error };
    }

    const text = await data.text();
    const notesData = JSON.parse(text);

    return { data: notesData, error: null };
  } catch (error) {
    console.error('[Auth] 下載筆記例外:', error);
    return { data: null, error };
  }
}

async function syncToCloud(silent = false) {
  if (!isAuthenticated()) {
    if (!silent) showAuthToast('請先登入以使用雲端同步功能', 'warning');
    return { error: new Error('未登入') };
  }
  
  if (!isApproved()) {
    if (!silent) showAuthToast('您的帳號尚未獲得批准，無法使用雲端功能', 'warning');
    return { error: new Error('帳號未批准') };
  }

  try {
    if (!window.Notes || typeof window.Notes.getAll !== 'function') {
      return { error: new Error('筆記系統尚未就緒') };
    }

    const localNotes = await window.Notes.getAll();
    const { data, error, size } = await uploadNotesToCloud(localNotes);
    
    if (error) {
      if (!silent) showAuthToast('同步失敗：' + error.message, 'error');
      return { error };
    }

    if (!silent) {
      showAuthToast(`已將 ${localNotes.length} 則筆記同步至雲端`);
    }
    return { data, error: null };
  } catch (error) {
    console.error('[Auth] 同步到雲端失敗:', error);
    if (!silent) showAuthToast('同步失敗', 'error');
    return { error };
  }
}

async function syncFromCloud(mode = 'merge') {
  if (!isAuthenticated()) {
    showAuthToast('請先登入以使用雲端同步功能', 'warning');
    return { error: new Error('未登入') };
  }
  
  if (!isApproved()) {
    showAuthToast('您的帳號尚未獲得批准', 'warning');
    return { error: new Error('帳號未批准') };
  }

  try {
    const { data: cloudData, error, isEmpty } = await downloadNotesFromCloud();
    
    if (error) {
      showAuthToast('下載失敗：' + error.message, 'error');
      return { error };
    }

    if (isEmpty || !cloudData || !cloudData.notes) {
      showAuthToast('雲端尚無筆記資料', 'warning');
      return { data: null, error: null };
    }

    if (!window.Notes) {
      return { error: new Error('筆記系統尚未就緒') };
    }

    const cloudNotes = cloudData.notes;
    let importedCount = 0;

    if (mode === 'replace') {
      await window.Notes.clearAll();
      for (const note of cloudNotes) {
        await window.Notes.create({ ...note, id: undefined });
        importedCount++;
      }
      showAuthToast(`已從雲端還原 ${importedCount} 則筆記`);
    } else {
      const localNotes = await window.Notes.getAll();
      const localFeatureIds = new Set(localNotes.map(n => n.featureId).filter(Boolean));
      
      for (const note of cloudNotes) {
        if (!note.featureId || !localFeatureIds.has(note.featureId)) {
          await window.Notes.create({ ...note, id: undefined });
          importedCount++;
        }
      }
      
      if (importedCount > 0) {
        showAuthToast(`已從雲端合併 ${importedCount} 則新筆記`);
      } else {
        showAuthToast('本地筆記已是最新');
      }
    }

    return { data: { importedCount }, error: null };
  } catch (error) {
    console.error('[Auth] 從雲端同步失敗:', error);
    showAuthToast('同步失敗', 'error');
    return { error };
  }
}

// ============================================
// 管理員功能
// ============================================
async function adminGetPendingUsers() {
  if (!supabaseClient || !isAdmin()) {
    return { data: null, error: new Error('權限不足') };
  }
  
  try {
    const { data, error } = await supabaseClient.rpc('admin_get_pending_users');
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[Auth] 取得待審核用戶失敗:', error);
    return { data: null, error };
  }
}

async function adminGetAllUsers() {
  if (!supabaseClient || !isAdmin()) {
    return { data: null, error: new Error('權限不足') };
  }
  
  try {
    const { data, error } = await supabaseClient.rpc('admin_get_all_users');
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[Auth] 取得所有用戶失敗:', error);
    return { data: null, error };
  }
}

async function adminApproveUser(userId) {
  if (!supabaseClient || !isAdmin()) {
    return { error: new Error('權限不足') };
  }
  
  try {
    const { data, error } = await supabaseClient.rpc('admin_approve_user', {
      target_user_id: userId
    });
    if (error) throw error;
    showAuthToast('已批准該用戶');
    return { data, error: null };
  } catch (error) {
    console.error('[Auth] 批准用戶失敗:', error);
    showAuthToast('批准失敗：' + error.message, 'error');
    return { error };
  }
}

async function adminRejectUser(userId, reason = null) {
  if (!supabaseClient || !isAdmin()) {
    return { error: new Error('權限不足') };
  }
  
  try {
    const { data, error } = await supabaseClient.rpc('admin_reject_user', {
      target_user_id: userId,
      reason: reason
    });
    if (error) throw error;
    showAuthToast('已拒絕該用戶');
    return { data, error: null };
  } catch (error) {
    console.error('[Auth] 拒絕用戶失敗:', error);
    showAuthToast('拒絕失敗：' + error.message, 'error');
    return { error };
  }
}

async function adminBanUser(userId, reason = null) {
  if (!supabaseClient || !isAdmin()) {
    return { error: new Error('權限不足') };
  }
  
  try {
    const { data, error } = await supabaseClient.rpc('admin_ban_user', {
      target_user_id: userId,
      reason: reason
    });
    if (error) throw error;
    showAuthToast('已禁用該用戶');
    return { data, error: null };
  } catch (error) {
    console.error('[Auth] 禁用用戶失敗:', error);
    showAuthToast('禁用失敗：' + error.message, 'error');
    return { error };
  }
}

async function adminSetUserStorageLimit(userId, limitBytes) {
  if (!supabaseClient || !isAdmin()) {
    return { error: new Error('權限不足') };
  }
  
  try {
    const { data, error } = await supabaseClient.rpc('admin_set_user_storage_limit', {
      target_user_id: userId,
      new_limit_bytes: limitBytes
    });
    if (error) throw error;
    showAuthToast('已更新儲存限制');
    return { data, error: null };
  } catch (error) {
    console.error('[Auth] 設定儲存限制失敗:', error);
    return { error };
  }
}

// ============================================
// 線上用戶
// ============================================
async function getOnlineUsers() {
  if (!supabaseClient || !isApproved()) {
    return { data: null, error: new Error('權限不足') };
  }
  
  try {
    const { data, error } = await supabaseClient.rpc('get_online_users');
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[Auth] 取得線上用戶失敗:', error);
    return { data: null, error };
  }
}

// ============================================
// UI 相關功能
// ============================================
function updateAuthUI() {
  const settingsBtn = document.getElementById('auth-settings-btn');
  
  if (currentUser) {
    if (settingsBtn) {
      settingsBtn.classList.add('authenticated');
      
      if (isAdmin()) {
        settingsBtn.classList.add('is-admin');
        settingsBtn.title = '帳號設定（管理員）';
      } else if (isApproved()) {
        settingsBtn.title = '帳號設定（已驗證）';
      } else {
        settingsBtn.classList.add('pending');
        settingsBtn.title = '帳號設定（等待審核）';
      }
    }
  } else {
    if (settingsBtn) {
      settingsBtn.classList.remove('authenticated', 'is-admin', 'pending');
      settingsBtn.title = '帳號設定';
    }
  }
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showAuthToast(message, type = 'success') {
  const existing = document.querySelector('.auth-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `auth-toast auth-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => {
    toast.classList.add('show');
  });

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getStatusText(status) {
  const statusMap = {
    'pending': '等待審核',
    'approved': '已批准',
    'rejected': '已拒絕',
    'banned': '已禁用'
  };
  return statusMap[status] || status;
}

function getStatusClass(status) {
  const classMap = {
    'pending': 'status-pending',
    'approved': 'status-approved',
    'rejected': 'status-rejected',
    'banned': 'status-banned'
  };
  return classMap[status] || '';
}

// ============================================
// 設定對話框
// ============================================
async function showSettingsDialog() {
  const existing = document.getElementById('auth-settings-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'auth-settings-dialog';
  dialog.className = 'note-dialog-overlay';
  
  const isLoggedIn = isAuthenticated();
  let contentHtml = '';
  
  if (isLoggedIn) {
    await loadUserProfile(); // 重新載入以獲取最新狀態
    
    const email = currentUser.email;
    const avatar = currentUser.user_metadata?.avatar_url || '';
    const name = userProfile?.display_name || currentUser.user_metadata?.full_name || email.split('@')[0];
    const status = userProfile?.status || 'pending';
    const storageLimit = userProfile?.storage_limit_bytes || DEFAULT_STORAGE_LIMIT_BYTES;
    const storageUsed = userProfile?.storage_used_bytes || 0;
    const autoSyncEnabled = userProfile?.auto_sync_enabled || false;
    
    // 根據用戶狀態顯示不同內容
    let statusBanner = '';
    let syncSection = '';
    let adminSection = '';
    
    if (status === 'pending') {
      statusBanner = `
        <div class="auth-status-banner auth-status-pending">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12,6 12,12 16,14"/>
          </svg>
          <div>
            <strong>帳號審核中</strong>
            <p>您的帳號正在等待管理員審核，審核通過後即可使用雲端同步功能。</p>
          </div>
        </div>
      `;
    } else if (status === 'rejected') {
      statusBanner = `
        <div class="auth-status-banner auth-status-rejected">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="15" y1="9" x2="9" y2="15"/>
            <line x1="9" y1="9" x2="15" y2="15"/>
          </svg>
          <div>
            <strong>帳號申請被拒絕</strong>
            <p>您的帳號申請未獲批准。如有疑問請聯繫管理員。</p>
          </div>
        </div>
      `;
    } else if (status === 'banned') {
      statusBanner = `
        <div class="auth-status-banner auth-status-banned">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <line x1="4.93" y1="4.93" x2="19.07" y2="19.07"/>
          </svg>
          <div>
            <strong>帳號已被禁用</strong>
            <p>您的帳號已被管理員禁用，無法使用雲端功能。</p>
          </div>
        </div>
      `;
    }
    
    if (status === 'approved') {
      syncSection = `
        <div class="auth-section">
          <h4>雲端同步</h4>
          <p class="auth-section-desc">將筆記同步至雲端，實現跨瀏覽器/裝置存取</p>
          
          <div class="auth-storage-info">
            <div class="auth-storage-bar">
              <div class="auth-storage-used" style="width: ${Math.min(100, (storageUsed / storageLimit) * 100)}%"></div>
            </div>
            <div class="auth-storage-text">
              已使用 ${formatBytes(storageUsed)} / ${formatBytes(storageLimit)}
            </div>
          </div>
          
          <div class="auth-sync-actions">
            <button class="auth-btn auth-btn-primary" onclick="handleSyncToCloud()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="17,8 12,3 7,8"/>
                <line x1="12" y1="3" x2="12" y2="15"/>
              </svg>
              上傳至雲端
            </button>
            <button class="auth-btn auth-btn-secondary" onclick="handleSyncFromCloud('merge')">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                <polyline points="7,10 12,15 17,10"/>
                <line x1="12" y1="15" x2="12" y2="3"/>
              </svg>
              從雲端合併
            </button>
          </div>
          
          <div class="auth-auto-sync-setting">
            <label class="auth-toggle">
              <input type="checkbox" id="auto-sync-toggle" ${autoSyncEnabled ? 'checked' : ''} onchange="handleAutoSyncToggle(this.checked)">
              <span class="auth-toggle-slider"></span>
              <span class="auth-toggle-label">自動同步</span>
            </label>
            <span class="auth-setting-hint">每 ${userProfile?.auto_sync_interval_minutes || 5} 分鐘自動上傳</span>
          </div>
          
          <details class="auth-advanced-options">
            <summary>進階選項</summary>
            <button class="auth-btn auth-btn-danger-outline" onclick="handleSyncFromCloud('replace')">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                <path d="M3 3v5h5"/>
              </svg>
              從雲端還原（覆蓋本地）
            </button>
          </details>
        </div>
      `;
    }
    
    // 通知設定區塊
    const notificationSection = buildNotificationSection();
    
    // 管理員區塊
    if (isAdmin()) {
      adminSection = `
        <div class="auth-section auth-admin-section">
          <h4>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
            </svg>
            管理員工具
          </h4>
          <div class="auth-admin-actions">
            <button class="auth-btn auth-btn-admin" onclick="showAdminPanel()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
                <circle cx="9" cy="7" r="4"/>
                <path d="M23 21v-2a4 4 0 0 0-3-3.87"/>
                <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
              </svg>
              用戶管理
            </button>
            <button class="auth-btn auth-btn-admin-outline" onclick="showOnlineUsers()">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <circle cx="12" cy="12" r="10"/>
                <circle cx="12" cy="12" r="3" fill="currentColor"/>
              </svg>
              線上用戶
            </button>
          </div>
        </div>
      `;
    }
    
    contentHtml = `
      <div class="auth-dialog">
        <div class="note-dialog-header">
          <h3>帳號設定</h3>
          <button class="note-dialog-close" onclick="closeSettingsDialog()">&times;</button>
        </div>
        <div class="note-dialog-body">
          ${statusBanner}
          
          <div class="auth-user-profile">
            ${avatar ? `<img src="${avatar}" alt="頭像" class="auth-avatar">` : '<div class="auth-avatar-placeholder"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>'}
            <div class="auth-user-details">
              <div class="auth-user-name">${escapeHtml(name)}</div>
              <div class="auth-user-email">${escapeHtml(email)}</div>
              <div class="auth-user-status ${getStatusClass(status)}">${getStatusText(status)}</div>
            </div>
          </div>
          
          ${syncSection}
          ${notificationSection}
          ${adminSection}
        </div>
        <div class="note-dialog-footer">
          <button class="note-btn note-btn-secondary" onclick="handleSignOut()">登出</button>
          <button class="note-btn note-btn-primary" onclick="closeSettingsDialog()">完成</button>
        </div>
      </div>
    `;
  } else {
    // 未登入
    contentHtml = `
      <div class="auth-dialog">
        <div class="note-dialog-header">
          <h3>登入帳號</h3>
          <button class="note-dialog-close" onclick="closeSettingsDialog()">&times;</button>
        </div>
        <div class="note-dialog-body">
          <div class="auth-login-intro">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" stroke-width="1.5">
              <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>
            </svg>
            <h4>雲端同步您的筆記</h4>
            <p>登入後即可將筆記同步至雲端，在任何裝置上存取您的資料。</p>
          </div>
          
          <div class="auth-login-benefits">
            <div class="auth-benefit">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22,4 12,14.01 9,11.01"/>
              </svg>
              <span>跨瀏覽器同步</span>
            </div>
            <div class="auth-benefit">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22,4 12,14.01 9,11.01"/>
              </svg>
              <span>跨裝置存取</span>
            </div>
            <div class="auth-benefit">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/>
                <polyline points="22,4 12,14.01 9,11.01"/>
              </svg>
              <span>安全雲端備份</span>
            </div>
          </div>
          
          <div class="auth-notice">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="16" x2="12" y2="12"/>
              <line x1="12" y1="8" x2="12.01" y2="8"/>
            </svg>
            <span>本服務需要管理員審核後才能使用</span>
          </div>
          
          <button class="auth-google-btn" onclick="handleGoogleSignIn()">
            <svg width="18" height="18" viewBox="0 0 24 24">
              <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
              <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
              <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
              <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
            </svg>
            使用 Google 帳號登入
          </button>
          
          <p class="auth-privacy-note">
            登入即表示您同意我們的服務條款。您的資料將安全地儲存於雲端。
          </p>
        </div>
      </div>
    `;
  }

  dialog.innerHTML = contentHtml;
  document.body.appendChild(dialog);
}

function closeSettingsDialog() {
  const dialog = document.getElementById('auth-settings-dialog');
  if (dialog) dialog.remove();
}

// ============================================
// 管理員面板
// ============================================
async function showAdminPanel() {
  if (!isAdmin()) {
    showAuthToast('權限不足', 'error');
    return;
  }
  
  closeSettingsDialog();
  
  const existing = document.getElementById('admin-panel-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'admin-panel-dialog';
  dialog.className = 'note-dialog-overlay';
  
  dialog.innerHTML = `
    <div class="auth-dialog admin-panel">
      <div class="note-dialog-header">
        <h3>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
          用戶管理
        </h3>
        <button class="note-dialog-close" onclick="closeAdminPanel()">&times;</button>
      </div>
      <div class="note-dialog-body">
        <div class="admin-tabs">
          <button class="admin-tab active" onclick="switchAdminTab('pending')">待審核</button>
          <button class="admin-tab" onclick="switchAdminTab('all')">所有用戶</button>
        </div>
        <div id="admin-users-list" class="admin-users-list">
          <div class="admin-loading">載入中...</div>
        </div>
      </div>
      <div class="note-dialog-footer">
        <button class="note-btn note-btn-secondary" onclick="closeAdminPanel()">關閉</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  // 載入待審核用戶
  await loadAdminUsersList('pending');
}

function closeAdminPanel() {
  const dialog = document.getElementById('admin-panel-dialog');
  if (dialog) dialog.remove();
}

async function switchAdminTab(tab) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.admin-tab[onclick="switchAdminTab('${tab}')"]`).classList.add('active');
  await loadAdminUsersList(tab);
}

async function loadAdminUsersList(type) {
  const container = document.getElementById('admin-users-list');
  if (!container) return;
  
  container.innerHTML = '<div class="admin-loading">載入中...</div>';
  
  let users = [];
  if (type === 'pending') {
    const { data, error } = await adminGetPendingUsers();
    if (error) {
      container.innerHTML = '<div class="admin-error">載入失敗</div>';
      return;
    }
    users = data || [];
  } else {
    const { data, error } = await adminGetAllUsers();
    if (error) {
      container.innerHTML = '<div class="admin-error">載入失敗</div>';
      return;
    }
    users = data || [];
  }
  
  if (users.length === 0) {
    container.innerHTML = '<div class="admin-empty">沒有用戶</div>';
    return;
  }
  
  container.innerHTML = users.map(user => `
    <div class="admin-user-item" data-user-id="${user.id}">
      <div class="admin-user-info">
        ${user.avatar_url ? `<img src="${user.avatar_url}" class="admin-user-avatar">` : '<div class="admin-user-avatar-placeholder"></div>'}
        <div class="admin-user-details">
          <div class="admin-user-name">${escapeHtml(user.display_name || user.email)}</div>
          <div class="admin-user-email">${escapeHtml(user.email)}</div>
          <div class="admin-user-meta">
            <span class="admin-user-status ${getStatusClass(user.status)}">${getStatusText(user.status)}</span>
            ${user.is_admin ? '<span class="admin-badge">管理員</span>' : ''}
            <span class="admin-user-date">註冊於 ${new Date(user.created_at).toLocaleDateString()}</span>
          </div>
        </div>
      </div>
      <div class="admin-user-actions">
        ${user.status === 'pending' ? `
          <button class="admin-action-btn approve" onclick="handleAdminApprove('${user.id}')">批准</button>
          <button class="admin-action-btn reject" onclick="handleAdminReject('${user.id}')">拒絕</button>
        ` : ''}
        ${user.status === 'approved' && !user.is_admin ? `
          <button class="admin-action-btn ban" onclick="handleAdminBan('${user.id}')">禁用</button>
        ` : ''}
        ${user.status === 'rejected' || user.status === 'banned' ? `
          <button class="admin-action-btn approve" onclick="handleAdminApprove('${user.id}')">重新批准</button>
        ` : ''}
        ${!user.is_admin ? `
          <button class="admin-action-btn storage" onclick="handleAdminSetStorage('${user.id}', ${user.storage_limit_bytes || DEFAULT_STORAGE_LIMIT_BYTES})">
            配額 ${formatBytes(user.storage_limit_bytes || DEFAULT_STORAGE_LIMIT_BYTES)}
          </button>
        ` : ''}
      </div>
    </div>
  `).join('');
}

async function handleAdminApprove(userId) {
  await adminApproveUser(userId);
  await loadAdminUsersList(document.querySelector('.admin-tab.active').textContent.includes('待審核') ? 'pending' : 'all');
  await updatePendingBadge();
}

async function handleAdminReject(userId) {
  const reason = prompt('拒絕原因（可留空）：');
  await adminRejectUser(userId, reason || null);
  await loadAdminUsersList('pending');
  await updatePendingBadge();
}

async function handleAdminBan(userId) {
  if (!confirm('確定要禁用此用戶嗎？')) return;
  const reason = prompt('禁用原因（可留空）：');
  await adminBanUser(userId, reason || null);
  await loadAdminUsersList('all');
}

async function handleAdminSetStorage(userId, currentLimit) {
  const newLimitMB = prompt(`設定儲存空間限制（MB），目前為 ${(currentLimit / 1024 / 1024).toFixed(1)}MB：`, (currentLimit / 1024 / 1024).toFixed(0));
  if (newLimitMB === null) return;
  
  const newLimitBytes = parseFloat(newLimitMB) * 1024 * 1024;
  if (isNaN(newLimitBytes) || newLimitBytes <= 0) {
    showAuthToast('請輸入有效的數字', 'error');
    return;
  }
  
  await adminSetUserStorageLimit(userId, Math.round(newLimitBytes));
  await loadAdminUsersList('all');
}

// ============================================
// 線上用戶面板
// ============================================
async function showOnlineUsers() {
  closeSettingsDialog();
  
  const existing = document.getElementById('online-users-dialog');
  if (existing) existing.remove();

  const dialog = document.createElement('div');
  dialog.id = 'online-users-dialog';
  dialog.className = 'note-dialog-overlay';
  
  dialog.innerHTML = `
    <div class="auth-dialog online-users-panel">
      <div class="note-dialog-header">
        <h3>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <circle cx="12" cy="12" r="3" fill="#22c55e"/>
          </svg>
          線上用戶
        </h3>
        <button class="note-dialog-close" onclick="closeOnlineUsers()">&times;</button>
      </div>
      <div class="note-dialog-body">
        <div id="online-users-list" class="online-users-list">
          <div class="admin-loading">載入中...</div>
        </div>
      </div>
      <div class="note-dialog-footer">
        <button class="note-btn note-btn-secondary" onclick="refreshOnlineUsers()">重新整理</button>
        <button class="note-btn note-btn-primary" onclick="closeOnlineUsers()">關閉</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  await loadOnlineUsersList();
}

function closeOnlineUsers() {
  const dialog = document.getElementById('online-users-dialog');
  if (dialog) dialog.remove();
}

async function refreshOnlineUsers() {
  await loadOnlineUsersList();
}

async function loadOnlineUsersList() {
  const container = document.getElementById('online-users-list');
  if (!container) return;
  
  const { data: users, error } = await getOnlineUsers();
  
  if (error) {
    container.innerHTML = '<div class="admin-error">載入失敗</div>';
    return;
  }
  
  if (!users || users.length === 0) {
    container.innerHTML = '<div class="admin-empty">目前沒有用戶在線上</div>';
    return;
  }
  
  container.innerHTML = users.map(user => `
    <div class="online-user-item">
      ${user.avatar_url ? `<img src="${user.avatar_url}" class="online-user-avatar">` : '<div class="online-user-avatar-placeholder"></div>'}
      <div class="online-user-info">
        <div class="online-user-name">${escapeHtml(user.display_name)}</div>
        <div class="online-user-time">最後活動：${getRelativeTime(new Date(user.last_seen_at))}</div>
      </div>
      <div class="online-indicator"></div>
    </div>
  `).join('');
}

function getRelativeTime(date) {
  const now = new Date();
  const diff = (now - date) / 1000;
  
  if (diff < 60) return '剛剛';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
  return `${Math.floor(diff / 86400)} 天前`;
}

// ============================================
// 事件處理
// ============================================
async function handleGoogleSignIn() {
  closeSettingsDialog();
  showAuthToast('正在導向 Google 登入...', 'info');
  await signInWithGoogle();
}

async function handleSignOut() {
  closeSettingsDialog();
  await signOut();
}

async function handleSyncToCloud() {
  const btn = document.querySelector('.auth-sync-actions .auth-btn-primary');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="auth-spinner"></span> 同步中...';
  }
  
  await syncToCloud();
  
  if (btn) {
    btn.disabled = false;
    btn.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
        <polyline points="17,8 12,3 7,8"/>
        <line x1="12" y1="3" x2="12" y2="15"/>
      </svg>
      上傳至雲端
    `;
  }
}

async function handleSyncFromCloud(mode) {
  const confirmMsg = mode === 'replace' 
    ? '這將會清除所有本地筆記並以雲端版本取代，確定要繼續嗎？'
    : '這將會從雲端下載筆記並與本地合併，確定要繼續嗎？';
  
  if (!confirm(confirmMsg)) return;
  
  closeSettingsDialog();
  await syncFromCloud(mode);
}

async function handleAutoSyncToggle(enabled) {
  await updateAutoSyncSetting(enabled);
}

// ============================================
// 推播通知設定
// ============================================

// 檢測通知相關環境
function getNotificationStatus() {
  const isStandalone = window.matchMedia('(display-mode: standalone)').matches || 
                       window.navigator.standalone === true;
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || 
                (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const supportsNotification = 'Notification' in window;
  const supportsPush = 'PushManager' in window;
  const hasServiceWorker = 'serviceWorker' in navigator;
  
  let permission = 'unsupported';
  if (supportsNotification) {
    permission = Notification.permission; // 'granted', 'denied', 'default'
  }
  
  // iOS PWA 需要 iOS 16.4+ 且在 standalone 模式下才支援 Web Push
  const isIOSPWACapable = isIOS && isStandalone;
  
  return {
    isStandalone,
    isIOS,
    supportsNotification,
    supportsPush,
    hasServiceWorker,
    permission,
    isIOSPWACapable,
    canRequestPermission: supportsNotification && permission === 'default'
  };
}

// 建構通知設定區塊 HTML
function buildNotificationSection() {
  const status = getNotificationStatus();
  const isEnabled = status.permission === 'granted';
  const isDenied = status.permission === 'denied';
  const isUnsupported = !status.supportsNotification;
  const needsIOSInstall = status.isIOS && !status.isStandalone;
  
  let hintText = '';
  let toggleDisabled = false;
  
  if (isUnsupported) {
    hintText = '此瀏覽器不支援推播通知';
    toggleDisabled = true;
  } else if (needsIOSInstall) {
    hintText = 'iOS 需先將網站加入主畫面';
    toggleDisabled = true;
  } else if (isDenied) {
    hintText = '通知已被封鎖，點擊開關查看如何開啟';
  } else if (isEnabled) {
    hintText = '收到群聊或私訊時會通知您';
  } else {
    hintText = '開啟後可接收即時訊息通知';
  }
  
  return `
    <div class="auth-section">
      <h4>推播通知</h4>
      <p class="auth-section-desc">接收群聊與私訊的即時通知</p>
      
      <div class="auth-notification-toggle-row">
        <label class="auth-toggle ${toggleDisabled ? 'disabled' : ''}">
          <input type="checkbox" 
                 id="notification-toggle" 
                 ${isEnabled ? 'checked' : ''} 
                 ${toggleDisabled ? 'disabled' : ''}
                 onchange="handleNotificationToggle(this.checked)">
          <span class="auth-toggle-slider"></span>
          <span class="auth-toggle-label">啟用通知</span>
        </label>
      </div>
      <span class="auth-setting-hint">${hintText}</span>
    </div>
  `;
}

// 處理通知開關切換（用戶點擊觸發 - 符合 iOS PWA 政策）
async function handleNotificationToggle(enabled) {
  const status = getNotificationStatus();
  
  if (!status.supportsNotification) {
    showAuthToast('此瀏覽器不支援推播通知', 'error');
    return;
  }
  
  if (enabled) {
    // 嘗試啟用
    if (status.permission === 'granted') {
      localStorage.setItem('push_notifications_enabled', 'true');
      showAuthToast('推播通知已啟用', 'success');
    } else if (status.permission === 'denied') {
      // 已被封鎖，顯示說明
      showNotificationHelp();
      // 重設開關狀態
      const toggle = document.getElementById('notification-toggle');
      if (toggle) toggle.checked = false;
    } else {
      // 請求權限
      try {
        const permission = await Notification.requestPermission();
        if (permission === 'granted') {
          localStorage.setItem('push_notifications_enabled', 'true');
          showAuthToast('推播通知已啟用', 'success');
        } else {
          // 重設開關狀態
          const toggle = document.getElementById('notification-toggle');
          if (toggle) toggle.checked = false;
          if (permission === 'denied') {
            showAuthToast('通知權限被拒絕', 'error');
          }
        }
      } catch (error) {
        console.error('[Auth] 請求通知權限失敗:', error);
        const toggle = document.getElementById('notification-toggle');
        if (toggle) toggle.checked = false;
      }
    }
  } else {
    // 關閉通知
    localStorage.setItem('push_notifications_enabled', 'false');
    showAuthToast('推播通知已關閉', 'info');
  }
}

// 舊函數保留相容性
async function handleEnableNotifications() {
  handleNotificationToggle(true);
}

// 顯示如何開啟通知的說明
function showNotificationHelp() {
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);
  const isChrome = /Chrome/.test(navigator.userAgent) && !/Edge/.test(navigator.userAgent);
  const isSafari = /Safari/.test(navigator.userAgent) && !/Chrome/.test(navigator.userAgent);
  
  let steps = '';
  
  if (isIOS) {
    steps = `
      <li>開啟「設定」App</li>
      <li>找到「Safari」或此 App 的設定</li>
      <li>點擊「通知」</li>
      <li>開啟「允許通知」</li>
    `;
  } else if (isAndroid && isChrome) {
    steps = `
      <li>點擊網址列左側的鎖頭或 ⓘ 圖示</li>
      <li>找到「通知」選項</li>
      <li>將設定改為「允許」</li>
      <li>重新整理頁面</li>
    `;
  } else if (isChrome) {
    steps = `
      <li>點擊網址列左側的鎖頭圖示</li>
      <li>點擊「網站設定」</li>
      <li>找到「通知」選項</li>
      <li>將設定改為「允許」</li>
    `;
  } else if (isSafari) {
    steps = `
      <li>點擊 Safari 選單 > 設定</li>
      <li>選擇「網站」標籤頁</li>
      <li>點擊左側的「通知」</li>
      <li>找到此網站並設為「允許」</li>
    `;
  } else {
    steps = `
      <li>點擊網址列的設定圖示</li>
      <li>找到網站權限或通知設定</li>
      <li>將通知權限改為「允許」</li>
      <li>重新整理頁面</li>
    `;
  }
  
  const helpDialog = document.createElement('div');
  helpDialog.className = 'note-dialog-overlay';
  helpDialog.id = 'notification-help-dialog';
  helpDialog.innerHTML = `
    <div class="auth-dialog" style="max-width: 400px;">
      <div class="note-dialog-header">
        <h3>如何開啟通知權限</h3>
        <button class="note-dialog-close" onclick="closeNotificationHelp()">&times;</button>
      </div>
      <div class="note-dialog-body">
        <div class="notification-help-content">
          <p style="color: #1f2937; font-weight: 500;">通知權限已被封鎖，請依照以下步驟手動開啟：</p>
          <ol class="notification-help-steps" style="color: #1f2937;">
            ${steps}
          </ol>
        </div>
      </div>
      <div class="note-dialog-footer">
        <button class="note-btn note-btn-primary" onclick="closeNotificationHelp()">我知道了</button>
      </div>
    </div>
  `;
  document.body.appendChild(helpDialog);
}

// 關閉通知說明對話框
function closeNotificationHelp() {
  const dialog = document.getElementById('notification-help-dialog');
  if (dialog) dialog.remove();
}

// 從設定顯示 iOS 安裝教學
function showIOSInstallGuideFromSettings() {
  closeSettingsDialog();
  // 使用 pwa.js 中的函數
  if (typeof showIOSInstallGuide === 'function') {
    const isIPad = /iPad/.test(navigator.userAgent) || 
                   (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    showIOSInstallGuide(isIPad);
  }
}

// 顯示 Auth Toast（如果沒有的話）
function showAuthToast(message, type = 'success') {
  // 嘗試使用 PWA 的 toast
  if (window.PWA?.showToast) {
    window.PWA.showToast(message);
    return;
  }
  
  // 或使用 chat 的 toast
  if (typeof showChatToast === 'function') {
    showChatToast(message, type);
    return;
  }
  
  // 備用方案
  alert(message);
}

// ============================================
// 地圖控制按鈕
// ============================================
function addAuthControlToMap(map) {
  mapInstance = map;
  
  const AuthControl = L.Control.extend({
    options: {
      position: 'bottomright'
    },
    
    onAdd: function() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control auth-control');
      
      const btn = L.DomUtil.create('a', 'auth-control-btn', container);
      btn.href = '#';
      btn.id = 'auth-settings-btn';
      btn.title = '帳號設定';
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="3"/>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>
        </svg>
        <span id="admin-pending-badge" class="chat-badge" style="display:none;background:#f59e0b">0</span>
      `;
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', '開啟帳號設定');
      
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', function(e) {
        L.DomEvent.preventDefault(e);
        showSettingsDialog();
      });
      
      return container;
    }
  });
  
  new AuthControl().addTo(map);
}

// 更新待審核徽章
async function updatePendingBadge() {
  if (!isAdmin()) return;
  
  try {
    const { data, error } = await supabaseClient.rpc('admin_get_pending_count');
    if (error) return;
    
    const badge = document.getElementById('admin-pending-badge');
    if (badge) {
      if (data > 0) {
        badge.textContent = data > 99 ? '99+' : data;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  } catch (e) {
    console.error('[Auth] 更新待審核徽章失敗:', e);
  }
}

// 取得 Supabase Client（供聊天模組使用）
function getSupabaseClient() {
  return supabaseClient;
}

// ============================================
// 初始化
// ============================================
async function initAuth(map) {
  try {
    await initSupabase();
    addAuthControlToMap(map);
    
    // 如果是管理員，更新待審核徽章
    if (isAdmin()) {
      await updatePendingBadge();
    }
    
    // 初始化聊天模組
    if (window.Chat && typeof window.Chat.init === 'function') {
      await window.Chat.init(map, supabaseClient);
    }
  } catch (error) {
    console.error('[Auth] 認證系統初始化失敗:', error);
  }
}

// ============================================
// 全域 API
// ============================================
window.SupabaseAuth = {
  init: initAuth,
  signInWithGoogle,
  signOut,
  getCurrentUser,
  isAuthenticated,
  isApproved,
  isAdmin,
  getUserProfile,
  getUserStatus,
  syncToCloud,
  syncFromCloud,
  updateAutoSyncSetting,
  getOnlineUsers,
  updatePendingBadge,
  showSettings: showSettingsDialog,
  getSupabaseClient,
  _getClient: getSupabaseClient,
  // 管理員 API
  admin: {
    getPendingUsers: adminGetPendingUsers,
    getAllUsers: adminGetAllUsers,
    approveUser: adminApproveUser,
    rejectUser: adminRejectUser,
    banUser: adminBanUser,
    setUserStorageLimit: adminSetUserStorageLimit
  }
};

// 暴露到全域供 onclick 使用
window.showSettingsDialog = showSettingsDialog;
window.closeSettingsDialog = closeSettingsDialog;
window.handleGoogleSignIn = handleGoogleSignIn;
window.handleSignOut = handleSignOut;
window.handleSyncToCloud = handleSyncToCloud;
window.handleSyncFromCloud = handleSyncFromCloud;
window.handleAutoSyncToggle = handleAutoSyncToggle;
window.showAdminPanel = showAdminPanel;
window.closeAdminPanel = closeAdminPanel;
window.switchAdminTab = switchAdminTab;
window.handleAdminApprove = handleAdminApprove;
window.handleAdminReject = handleAdminReject;
window.handleAdminBan = handleAdminBan;
window.handleAdminSetStorage = handleAdminSetStorage;
window.showOnlineUsers = showOnlineUsers;
window.closeOnlineUsers = closeOnlineUsers;
window.refreshOnlineUsers = refreshOnlineUsers;
window.handleEnableNotifications = handleEnableNotifications;
window.handleNotificationToggle = handleNotificationToggle;
window.showNotificationHelp = showNotificationHelp;
window.closeNotificationHelp = closeNotificationHelp;
window.showIOSInstallGuideFromSettings = showIOSInstallGuideFromSettings;
