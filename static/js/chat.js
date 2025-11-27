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
async function getChatMessages(limit = 50, offset = 0) {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: new Error('未連接') };
  
  try {
    const { data, error } = await client.rpc('get_chat_messages', {
      p_limit: limit,
      p_offset: offset
    });
    
    if (error) throw error;
    // 反轉順序讓最新訊息在底部
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
        const currentUserId = window.SupabaseAuth?.getCurrentUser()?.id;
        const isOwn = data.user_id === currentUserId;
        
        const message = {
          id: data.id,
          user_id: data.user_id,
          display_name: data.user_profiles?.display_name || 'Unknown',
          avatar_url: data.user_profiles?.avatar_url,
          content: data.content,
          created_at: data.created_at,
          is_own: isOwn
        };
        
        // 如果不是自己發的訊息，發送通知
        if (!isOwn) {
          sendChatNotification(
            message.display_name + ' 在群聊中發言',
            message.content,
            { tag: 'group-chat', type: 'group' }
          );
        }
        
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
async function getPrivateMessages(partnerId, limit = 50, offset = 0) {
  const client = getSupabaseClient();
  if (!client) return { data: null, error: new Error('未連接') };
  
  try {
    const { data, error } = await client.rpc('get_private_messages', {
      p_other_user_id: partnerId,
      p_limit: limit,
      p_offset: offset
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

// 訂閱私訊 Realtime（用於接收通知）
function subscribeToPrivateMessages() {
  const client = getSupabaseClient();
  if (!client) return null;
  
  const currentUserId = window.SupabaseAuth?.getCurrentUser()?.id;
  if (!currentUserId) return null;
  
  // 取消現有訂閱
  if (privateSubscription) {
    privateSubscription.unsubscribe();
  }
  
  privateSubscription = client
    .channel('private_messages_notifications')
    .on('postgres_changes', {
      event: 'INSERT',
      schema: 'public',
      table: 'private_messages',
      filter: `recipient_id=eq.${currentUserId}`
    }, async (payload) => {
      // 收到發給自己的私訊
      const { data, error } = await client
        .from('private_messages')
        .select(`
          id,
          sender_id,
          content,
          created_at,
          sender:user_profiles!private_messages_sender_id_fkey(display_name, avatar_url)
        `)
        .eq('id', payload.new.id)
        .single();
      
      if (error) {
        console.error('[Chat] 取得私訊詳情失敗:', error);
        return;
      }
      
      if (data && data.sender_id !== currentUserId) {
        const senderName = data.sender?.display_name || '某人';
        
        // 發送通知
        sendChatNotification(
          senderName + ' 傳送了私訊',
          data.content,
          { 
            tag: `private-${data.sender_id}`, 
            type: 'private',
            partnerId: data.sender_id,
            partnerName: senderName
          }
        );
        
        // 更新未讀徽章
        updateUnreadBadge();
        
        // 如果當前正在查看這個對話，重新載入訊息
        if (currentChatPartner === data.sender_id) {
          loadDMMessages(data.sender_id);
        }
      }
    })
    .subscribe();
  
  return privateSubscription;
}

// 取消私訊訂閱
function unsubscribeFromPrivateMessages() {
  if (privateSubscription) {
    privateSubscription.unsubscribe();
    privateSubscription = null;
  }
}

// ============================================
// UI 功能
// ============================================

function getSupabaseClient() {
  // 優先使用傳入的 client，其次使用 SupabaseAuth 的 client
  return window._supabaseClient || window.SupabaseAuth?.getSupabaseClient?.();
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
  // 判斷是否為自己的訊息
  const currentUserId = window.SupabaseAuth?.getCurrentUser()?.id;
  const isOwn = msg.sender_id === currentUserId;
  
  const timeStr = formatMessageTime(msg.created_at);
  const senderName = msg.sender_name || '未知用戶';
  const senderAvatar = msg.sender_avatar;
  
  const avatarHtml = senderAvatar 
    ? `<img src="${senderAvatar}" class="chat-msg-avatar" alt="${escapeHtml(senderName)}">`
    : `<div class="chat-msg-avatar-placeholder">${senderName.charAt(0).toUpperCase()}</div>`;
  
  return `
    <div class="chat-message ${isOwn ? 'own' : ''}" data-msg-id="${msg.id}">
      ${!isOwn ? avatarHtml : ''}
      <div class="chat-msg-content">
        ${!isOwn ? `<div class="chat-msg-name">${escapeHtml(senderName)}</div>` : ''}
        <div class="chat-msg-bubble ${msg.is_deleted ? 'deleted' : ''}">
          <div class="chat-msg-text">${escapeHtml(msg.content)}</div>
          ${isAdmin && !isOwn && !msg.is_deleted ? `
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
      ${isOwn ? avatarHtml : ''}
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
  
  // 清空輸入框並重設高度
  resetTextareaHeight(input);
  
  const { data: messageId, error } = await sendChatMessage(content);
  
  btn.disabled = false;
  
  if (error) {
    showChatToast('發送失敗: ' + error.message, 'error');
    // 恢復輸入內容
    input.value = content;
    return;
  }
  
  // 立即在本地添加訊息（更好的 UX，不用等待重載）
  const currentUser = window.SupabaseAuth?.getCurrentUser();
  const profile = window.SupabaseAuth?.getUserProfile();
  
  const newMsg = {
    id: messageId || crypto.randomUUID(),
    sender_id: currentUser?.id,
    sender_name: profile?.display_name || '我',
    sender_avatar: profile?.avatar_url,
    content: content,
    is_deleted: false,
    created_at: new Date().toISOString()
  };
  
  appendChatMessage(newMsg);
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
  
  resetTextareaHeight(input);
  
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

// 發送瀏覽器通知（群聊或私訊）
function sendChatNotification(title, body, options = {}) {
  // 檢查通知權限
  if (!('Notification' in window)) return;
  if (Notification.permission !== 'granted') return;
  
  // 檢查用戶是否啟用了通知（如果權限已允許，預設啟用）
  const notifEnabled = localStorage.getItem('push_notifications_enabled');
  if (notifEnabled === 'false') return;
  
  // 如果頁面在焦點上且聊天面板已開啟，不發送通知
  const chatPanelOpen = document.getElementById('chat-panel');
  if (document.hasFocus() && chatPanelOpen) return;
  
  try {
    const notification = new Notification(title, {
      body: body.length > 100 ? body.substring(0, 100) + '...' : body,
      icon: '/static/assets/APEINTEL ATLAS_192x192.png',
      badge: '/static/assets/APEINTEL ATLAS_192x192.png',
      tag: options.tag || 'chat-message',
      renotify: true,
      requireInteraction: false,
      silent: false,
      ...options
    });
    
    // 點擊通知時開啟聊天面板
    notification.onclick = function() {
      window.focus();
      notification.close();
      
      if (options.type === 'private' && options.partnerId) {
        // 開啟私訊
        showChatPanel();
        setTimeout(() => {
          switchChatTab('private');
          if (options.partnerName) {
            startPrivateChat(options.partnerId, options.partnerName);
          }
        }, 300);
      } else {
        // 開啟群聊
        showChatPanel();
      }
    };
    
    // 5 秒後自動關閉
    setTimeout(() => notification.close(), 5000);
    
  } catch (error) {
    console.error('[Chat] 發送通知失敗:', error);
  }
}

// 自動調整輸入框高度（平滑無跳動）
function autoResizeTextarea(e) {
  const textarea = e.target;
  // 只在有內容時調整，避免跳動
  if (textarea.value.trim()) {
    textarea.style.height = 'auto';
    const newHeight = Math.min(textarea.scrollHeight, 100);
    textarea.style.height = newHeight + 'px';
  } else {
    // 無內容時重設為最小高度
    textarea.style.height = '';
  }
}

// 重設輸入框到初始狀態
function resetTextareaHeight(textarea) {
  textarea.style.height = '';
  textarea.value = '';
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
  
  // 如果已登入且已批准，啟動相關功能
  if (window.SupabaseAuth?.isApproved()) {
    await updateUnreadBadge();
    
    // 訂閱私訊通知（即使聊天面板未開啟也能收到通知）
    subscribeToPrivateMessages();
    
    // 檢查通知權限狀態
    if ('Notification' in window && Notification.permission === 'granted') {
      // 權限已允許，確保啟用
      const currentSetting = localStorage.getItem('push_notifications_enabled');
      if (currentSetting !== 'false') {
        localStorage.setItem('push_notifications_enabled', 'true');
      }
    }
  }
  
  // 如果是管理員，更新待審核徽章
  if (window.SupabaseAuth?.isAdmin()) {
    await updatePendingBadge();
  }
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

