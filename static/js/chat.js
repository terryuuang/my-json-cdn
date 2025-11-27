/**
 * 聊天功能模組 - APEINTEL ATLAS
 * 
 * 功能：
 * - 群聊（使用 Supabase Realtime）
 * - 私訊（1 天後自動過期）
 * - 未讀訊息通知
 * 
 * 依賴：supabase_auth.js（需先載入）
 */

// ============================================
// 狀態管理
// ============================================
let chatSubscription = null;
let privateSubscription = null;
let unreadCount = 0;
let currentChatPartner = null;

// ============================================
// 群聊功能
// ============================================

// 取得群聊訊息
async function getChatMessages(limit = 50, beforeId = null) {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: new Error('未連接') };
  
  try {
    const { data, error } = await client.rpc('get_chat_messages', {
      p_limit: limit,
      p_before_id: beforeId
    });
    
    if (error) throw error;
    return { data: data?.reverse() || [], error: null };
  } catch (error) {
    console.error('[Chat] 取得訊息失敗:', error);
    return { data: null, error };
  }
}

// 發送群聊訊息
async function sendChatMessage(content) {
  const client = getSupabaseClient();
  if (!client) return { error: new Error('未連接') };
  
  if (!content || content.trim().length === 0) {
    return { error: new Error('訊息不能為空') };
  }
  
  if (content.length > 2000) {
    return { error: new Error('訊息長度超過限制') };
  }
  
  try {
    const { data, error } = await client.rpc('send_chat_message', {
      p_content: content.trim()
    });
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[Chat] 發送訊息失敗:', error);
    return { error };
  }
}

// 訂閱群聊 Realtime
function subscribeToChatMessages(onMessage) {
  const client = getSupabaseClient();
  if (!client) return null;
  
  // 取消現有訂閱
  if (chatSubscription) {
    chatSubscription.unsubscribe();
  }
  
  chatSubscription = client
    .channel('public:chat_messages')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'chat_messages'
    }, async (payload) => {
      // 取得完整訊息資訊（包含用戶資料）
      const { data } = await client
        .from('chat_messages')
        .select(`
          id,
          user_id,
          content,
          created_at,
          user_profiles!inner(display_name, avatar_url)
        `)
        .eq('id', payload.new.id)
        .single();
      
      if (data) {
        const message = {
          id: data.id,
          user_id: data.user_id,
          display_name: data.user_profiles?.display_name || 'Unknown',
          avatar_url: data.user_profiles?.avatar_url,
          content: data.content,
          created_at: data.created_at,
          is_own: data.user_id === window.SupabaseAuth?.getCurrentUser()?.id
        };
        onMessage(message);
      }
    })
    .subscribe();
  
  return chatSubscription;
}

// 管理員刪除訊息
async function adminDeleteMessage(messageId) {
  const client = getSupabaseClient();
  if (!client) return { error: new Error('未連接') };
  
  try {
    const { data, error } = await client.rpc('admin_delete_message', {
      message_id: messageId
    });
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[Chat] 刪除訊息失敗:', error);
    return { error };
  }
}

// ============================================
// 私訊功能
// ============================================

// 取得可發送私訊的用戶列表
async function getMessageableUsers() {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: new Error('未連接') };
  
  try {
    const { data, error } = await client.rpc('get_messageable_users');
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[Chat] 取得用戶列表失敗:', error);
    return { data: null, error };
  }
}

// 取得私訊對話列表
async function getPrivateConversations() {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: new Error('未連接') };
  
  try {
    const { data, error } = await client.rpc('get_private_conversations');
    if (error) throw error;
    return { data: data || [], error: null };
  } catch (error) {
    console.error('[Chat] 取得對話列表失敗:', error);
    return { data: null, error };
  }
}

// 取得與特定用戶的私訊
async function getPrivateMessages(partnerId, limit = 50) {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: new Error('未連接') };
  
  try {
    const { data, error } = await client.rpc('get_private_messages', {
      p_partner_id: partnerId,
      p_limit: limit
    });
    
    if (error) throw error;
    return { data: data?.reverse() || [], error: null };
  } catch (error) {
    console.error('[Chat] 取得私訊失敗:', error);
    return { data: null, error };
  }
}

// 發送私訊
async function sendPrivateMessage(recipientId, content) {
  const client = getSupabaseClient();
  if (!client) return { error: new Error('未連接') };
  
  if (!content || content.trim().length === 0) {
    return { error: new Error('訊息不能為空') };
  }
  
  try {
    const { data, error } = await client.rpc('send_private_message', {
      p_recipient_id: recipientId,
      p_content: content.trim()
    });
    
    if (error) throw error;
    return { data, error: null };
  } catch (error) {
    console.error('[Chat] 發送私訊失敗:', error);
    return { error };
  }
}

// 取得未讀訊息數
async function getUnreadCount() {
  const client = getSupabaseClient();
  if (!client) return 0;
  
  try {
    const { data, error } = await client.rpc('get_unread_message_count');
    if (error) throw error;
    unreadCount = data || 0;
    return unreadCount;
  } catch (error) {
    console.error('[Chat] 取得未讀數失敗:', error);
    return 0;
  }
}

// 取得待審核用戶數
async function getPendingCount() {
  const client = getSupabaseClient();
  if (!client) return 0;
  
  try {
    const { data, error } = await client.rpc('admin_get_pending_count');
    if (error) return 0;
    return data || 0;
  } catch (error) {
    return 0;
  }
}

// ============================================
// UI 功能
// ============================================

function getSupabaseClient() {
  return window.supabase?.createClient ? null : 
    (window.SupabaseAuth?._getClient?.() || window._supabaseClient);
}

// 設定 Supabase Client 參考
function setSupabaseClient(client) {
  window._supabaseClient = client;
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function formatMessageTime(dateStr) {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = (now - date) / 1000;
  
  if (diff < 60) return '剛剛';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分鐘前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小時前`;
  
  return date.toLocaleDateString('zh-TW', { 
    month: 'numeric', 
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}

// ============================================
// 群聊面板
// ============================================

async function showChatPanel() {
  if (!window.SupabaseAuth?.isApproved()) {
    showChatToast('需要獲得批准才能使用聊天功能', 'warning');
    return;
  }
  
  const existing = document.getElementById('chat-panel');
  if (existing) existing.remove();
  
  const panel = document.createElement('div');
  panel.id = 'chat-panel';
  panel.className = 'chat-panel';
  
  const isAdmin = window.SupabaseAuth?.isAdmin();
  
  panel.innerHTML = `
    <div class="chat-container">
      <div class="chat-header">
        <div class="chat-header-left">
          <button class="chat-tab active" data-tab="group">群組聊天</button>
          <button class="chat-tab" data-tab="private">私訊</button>
        </div>
        <button class="chat-close" onclick="closeChatPanel()">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"/>
            <line x1="6" y1="6" x2="18" y2="18"/>
          </svg>
        </button>
      </div>
      <div class="chat-content">
        <div id="chat-group-view" class="chat-view active">
          <div id="chat-messages" class="chat-messages">
            <div class="chat-loading">載入中...</div>
          </div>
          <div class="chat-input-area">
            <textarea id="chat-input" placeholder="輸入訊息..." maxlength="2000" rows="1"></textarea>
            <button id="chat-send-btn" class="chat-send-btn" onclick="handleSendChatMessage()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22,2 15,22 11,13 2,9"/>
              </svg>
            </button>
          </div>
        </div>
        <div id="chat-private-view" class="chat-view">
          <div id="private-conversations" class="private-conversations">
            <div class="chat-loading">載入中...</div>
          </div>
        </div>
        <div id="chat-dm-view" class="chat-view">
          <div class="dm-header">
            <button class="dm-back" onclick="showPrivateConversations()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="15,18 9,12 15,6"/>
              </svg>
            </button>
            <div class="dm-partner-info">
              <span id="dm-partner-name"></span>
            </div>
          </div>
          <div id="dm-messages" class="chat-messages"></div>
          <div class="chat-input-area">
            <textarea id="dm-input" placeholder="輸入訊息..." maxlength="2000" rows="1"></textarea>
            <button class="chat-send-btn" onclick="handleSendPrivateMessage()">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="22" y1="2" x2="11" y2="13"/>
                <polygon points="22,2 15,22 11,13 2,9"/>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(panel);
  
  // 綁定標籤切換
  panel.querySelectorAll('.chat-tab').forEach(tab => {
    tab.addEventListener('click', () => switchChatTab(tab.dataset.tab));
  });
  
  // 綁定輸入框事件
  const chatInput = document.getElementById('chat-input');
  chatInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendChatMessage();
    }
  });
  chatInput.addEventListener('input', autoResizeTextarea);
  
  const dmInput = document.getElementById('dm-input');
  dmInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendPrivateMessage();
    }
  });
  dmInput.addEventListener('input', autoResizeTextarea);
  
  // 載入群聊訊息
  await loadChatMessages();
  
  // 訂閱即時訊息
  subscribeToChatMessages((msg) => {
    appendChatMessage(msg);
  });
}

function closeChatPanel() {
  const panel = document.getElementById('chat-panel');
  if (panel) panel.remove();
  
  if (chatSubscription) {
    chatSubscription.unsubscribe();
    chatSubscription = null;
  }
}

function switchChatTab(tab) {
  document.querySelectorAll('.chat-tab').forEach(t => t.classList.remove('active'));
  document.querySelector(`.chat-tab[data-tab="${tab}"]`).classList.add('active');
  
  document.querySelectorAll('.chat-view').forEach(v => v.classList.remove('active'));
  
  if (tab === 'group') {
    document.getElementById('chat-group-view').classList.add('active');
  } else if (tab === 'private') {
    document.getElementById('chat-private-view').classList.add('active');
    loadPrivateConversations();
  }
}

async function loadChatMessages() {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  const { data, error } = await getChatMessages();
  
  if (error) {
    container.innerHTML = '<div class="chat-error">載入失敗</div>';
    return;
  }
  
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="chat-empty">尚無訊息，開始聊天吧</div>';
    return;
  }
  
  const isAdmin = window.SupabaseAuth?.isAdmin();
  
  container.innerHTML = data.map(msg => renderChatMessage(msg, isAdmin)).join('');
  container.scrollTop = container.scrollHeight;
}

function renderChatMessage(msg, isAdmin = false) {
  const timeStr = formatMessageTime(msg.created_at);
  const avatarHtml = msg.avatar_url 
    ? `<img src="${msg.avatar_url}" class="chat-msg-avatar" alt="">`
    : `<div class="chat-msg-avatar-placeholder"></div>`;
  
  return `
    <div class="chat-message ${msg.is_own ? 'own' : ''}" data-msg-id="${msg.id}">
      ${!msg.is_own ? avatarHtml : ''}
      <div class="chat-msg-content">
        ${!msg.is_own ? `<div class="chat-msg-name">${escapeHtml(msg.display_name)}</div>` : ''}
        <div class="chat-msg-bubble">
          <div class="chat-msg-text">${escapeHtml(msg.content)}</div>
          ${isAdmin && !msg.is_own ? `
            <button class="chat-msg-delete" onclick="handleDeleteMessage('${msg.id}')" title="刪除訊息">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polyline points="3,6 5,6 21,6"/>
                <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
              </svg>
            </button>
          ` : ''}
        </div>
        <div class="chat-msg-time">${timeStr}</div>
      </div>
      ${msg.is_own ? avatarHtml : ''}
    </div>
  `;
}

function appendChatMessage(msg) {
  const container = document.getElementById('chat-messages');
  if (!container) return;
  
  // 移除空狀態
  const empty = container.querySelector('.chat-empty');
  if (empty) empty.remove();
  
  const isAdmin = window.SupabaseAuth?.isAdmin();
  container.insertAdjacentHTML('beforeend', renderChatMessage(msg, isAdmin));
  container.scrollTop = container.scrollHeight;
}

async function handleSendChatMessage() {
  const input = document.getElementById('chat-input');
  const content = input.value.trim();
  
  if (!content) return;
  
  const btn = document.getElementById('chat-send-btn');
  btn.disabled = true;
  
  const { error } = await sendChatMessage(content);
  
  btn.disabled = false;
  
  if (error) {
    showChatToast('發送失敗: ' + error.message, 'error');
    return;
  }
  
  input.value = '';
  input.style.height = 'auto';
}

async function handleDeleteMessage(messageId) {
  if (!confirm('確定要刪除這則訊息嗎?')) return;
  
  const { error } = await adminDeleteMessage(messageId);
  
  if (error) {
    showChatToast('刪除失敗', 'error');
    return;
  }
  
  // 移除 DOM 元素
  const msgEl = document.querySelector(`[data-msg-id="${messageId}"]`);
  if (msgEl) msgEl.remove();
  
  showChatToast('訊息已刪除');
}

// ============================================
// 私訊面板
// ============================================

async function loadPrivateConversations() {
  const container = document.getElementById('private-conversations');
  if (!container) return;
  
  container.innerHTML = '<div class="chat-loading">載入中...</div>';
  
  const { data: conversations, error } = await getPrivateConversations();
  const { data: users } = await getMessageableUsers();
  
  if (error) {
    container.innerHTML = '<div class="chat-error">載入失敗</div>';
    return;
  }
  
  let html = '';
  
  // 新對話按鈕
  html += `
    <div class="private-section">
      <div class="private-section-header">開始新對話</div>
      <div class="private-users-grid">
        ${(users || []).slice(0, 6).map(user => `
          <button class="private-user-btn" onclick="startPrivateChat('${user.id}', '${escapeHtml(user.display_name)}')">
            ${user.avatar_url 
              ? `<img src="${user.avatar_url}" class="private-user-avatar" alt="">`
              : `<div class="private-user-avatar-placeholder"></div>`
            }
            <span class="private-user-name">${escapeHtml(user.display_name || 'Unknown')}</span>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  
  // 現有對話
  if (conversations && conversations.length > 0) {
    html += `
      <div class="private-section">
        <div class="private-section-header">最近對話</div>
        <div class="private-conversation-list">
          ${conversations.map(conv => `
            <div class="private-conversation-item" onclick="startPrivateChat('${conv.partner_id}', '${escapeHtml(conv.partner_name)}')">
              ${conv.partner_avatar 
                ? `<img src="${conv.partner_avatar}" class="private-conv-avatar" alt="">`
                : `<div class="private-conv-avatar-placeholder"></div>`
              }
              <div class="private-conv-info">
                <div class="private-conv-name">
                  ${escapeHtml(conv.partner_name)}
                  ${conv.unread_count > 0 ? `<span class="private-unread-badge">${conv.unread_count}</span>` : ''}
                </div>
                <div class="private-conv-preview">${escapeHtml(conv.last_message?.substring(0, 30))}${conv.last_message?.length > 30 ? '...' : ''}</div>
              </div>
              <div class="private-conv-time">${formatMessageTime(conv.last_message_at)}</div>
            </div>
          `).join('')}
        </div>
      </div>
    `;
  }
  
  container.innerHTML = html || '<div class="chat-empty">尚無對話</div>';
}

async function startPrivateChat(partnerId, partnerName) {
  currentChatPartner = partnerId;
  
  // 切換視圖
  document.querySelectorAll('.chat-view').forEach(v => v.classList.remove('active'));
  document.getElementById('chat-dm-view').classList.add('active');
  document.getElementById('dm-partner-name').textContent = partnerName;
  
  // 載入訊息
  await loadDMMessages(partnerId);
}

function showPrivateConversations() {
  currentChatPartner = null;
  document.querySelectorAll('.chat-view').forEach(v => v.classList.remove('active'));
  document.getElementById('chat-private-view').classList.add('active');
  loadPrivateConversations();
}

async function loadDMMessages(partnerId) {
  const container = document.getElementById('dm-messages');
  if (!container) return;
  
  container.innerHTML = '<div class="chat-loading">載入中...</div>';
  
  const { data, error } = await getPrivateMessages(partnerId);
  
  if (error) {
    container.innerHTML = '<div class="chat-error">載入失敗</div>';
    return;
  }
  
  if (!data || data.length === 0) {
    container.innerHTML = '<div class="chat-empty">尚無訊息</div>';
    return;
  }
  
  container.innerHTML = data.map(msg => `
    <div class="chat-message ${msg.is_own ? 'own' : ''}" data-msg-id="${msg.id}">
      <div class="chat-msg-content">
        <div class="chat-msg-bubble">
          <div class="chat-msg-text">${escapeHtml(msg.content)}</div>
        </div>
        <div class="chat-msg-time">${formatMessageTime(msg.created_at)}</div>
      </div>
    </div>
  `).join('');
  
  container.scrollTop = container.scrollHeight;
  
  // 更新未讀數
  updateUnreadBadge();
}

async function handleSendPrivateMessage() {
  if (!currentChatPartner) return;
  
  const input = document.getElementById('dm-input');
  const content = input.value.trim();
  
  if (!content) return;
  
  const { error } = await sendPrivateMessage(currentChatPartner, content);
  
  if (error) {
    showChatToast('發送失敗: ' + error.message, 'error');
    return;
  }
  
  input.value = '';
  input.style.height = 'auto';
  
  // 重新載入訊息
  await loadDMMessages(currentChatPartner);
}

// ============================================
// 通知徽章
// ============================================

async function updateUnreadBadge() {
  const count = await getUnreadCount();
  const badge = document.getElementById('chat-unread-badge');
  
  if (badge) {
    if (count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
}

async function updatePendingBadge() {
  const count = await getPendingCount();
  const badge = document.getElementById('admin-pending-badge');
  
  if (badge) {
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
}

// ============================================
// 工具函數
// ============================================

function autoResizeTextarea(e) {
  const textarea = e.target;
  textarea.style.height = 'auto';
  textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
}

function showChatToast(message, type = 'success') {
  const existing = document.querySelector('.chat-toast');
  if (existing) existing.remove();

  const toast = document.createElement('div');
  toast.className = `chat-toast chat-toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);

  requestAnimationFrame(() => toast.classList.add('show'));

  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// ============================================
// 聊天按鈕（添加到地圖）
// ============================================

function addChatControlToMap(map) {
  const ChatControl = L.Control.extend({
    options: {
      position: 'bottomright'
    },
    
    onAdd: function() {
      const container = L.DomUtil.create('div', 'leaflet-bar leaflet-control chat-control');
      
      const btn = L.DomUtil.create('a', 'chat-control-btn', container);
      btn.href = '#';
      btn.id = 'chat-btn';
      btn.title = '聊天室';
      btn.innerHTML = `
        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
        </svg>
        <span id="chat-unread-badge" class="chat-badge" style="display:none">0</span>
      `;
      btn.setAttribute('role', 'button');
      btn.setAttribute('aria-label', '開啟聊天室');
      
      L.DomEvent.disableClickPropagation(btn);
      L.DomEvent.on(btn, 'click', function(e) {
        L.DomEvent.preventDefault(e);
        if (window.SupabaseAuth?.isAuthenticated()) {
          showChatPanel();
        } else {
          showChatToast('請先登入', 'warning');
        }
      });
      
      return container;
    }
  });
  
  new ChatControl().addTo(map);
}

// ============================================
// 初始化
// ============================================

async function initChat(map, supabaseClient) {
  setSupabaseClient(supabaseClient);
  addChatControlToMap(map);
  
  // 如果已登入且已批准，更新徽章
  if (window.SupabaseAuth?.isApproved()) {
    await updateUnreadBadge();
  }
  
  // 如果是管理員，更新待審核徽章
  if (window.SupabaseAuth?.isAdmin()) {
    await updatePendingBadge();
  }
  
  console.log('[Chat] 聊天模組初始化完成');
}

// ============================================
// 全域 API
// ============================================

window.Chat = {
  init: initChat,
  show: showChatPanel,
  close: closeChatPanel,
  sendMessage: sendChatMessage,
  sendPrivateMessage,
  getUnreadCount,
  updateUnreadBadge,
  updatePendingBadge
};

// 暴露到全域供 onclick 使用
window.showChatPanel = showChatPanel;
window.closeChatPanel = closeChatPanel;
window.handleSendChatMessage = handleSendChatMessage;
window.handleSendPrivateMessage = handleSendPrivateMessage;
window.handleDeleteMessage = handleDeleteMessage;
window.startPrivateChat = startPrivateChat;
window.showPrivateConversations = showPrivateConversations;

