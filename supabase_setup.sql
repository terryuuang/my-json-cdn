-- ============================================
-- APEINTEL ATLAS - Supabase 初始化 SQL 腳本
-- 
-- 請在 Supabase Dashboard > SQL Editor 中執行此腳本
-- 此腳本會：
-- 1. 建立使用者筆記的 Storage Bucket
-- 2. 建立用戶 Profile 表（含審核狀態）
-- 3. 設定 Row Level Security (RLS) 政策
-- 4. 建立管理員權限表格（不暴露管理員信箱）
-- 5. 建立群聊與私訊表格（為未來功能預留）
-- 6. 建立線上狀態相關功能
-- ============================================

-- ============================================
-- 1. 建立使用者筆記 Storage Bucket
-- ============================================
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'user-notes',
  'user-notes',
  false,  -- 非公開 bucket，需要認證才能存取
  15728640,  -- 15MB 檔案大小限制
  ARRAY['application/json']  -- 只允許 JSON 檔案
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- ============================================
-- 2. 管理員權限表格
-- 注意：管理員信箱只存在資料庫中，不會暴露給前端
-- ============================================

-- 建立管理員表格
CREATE TABLE IF NOT EXISTS public.admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL UNIQUE,
  storage_limit_bytes BIGINT DEFAULT 104857600, -- 管理員預設 100MB
  created_at TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT
);

-- 啟用 RLS
ALTER TABLE public.admins ENABLE ROW LEVEL SECURITY;

-- 只有管理員可以查看管理員清單（防止一般使用者知道誰是管理員）
DROP POLICY IF EXISTS "Only admins can view admin list" ON public.admins;
CREATE POLICY "Only admins can view admin list"
ON public.admins FOR SELECT
TO authenticated
USING (
  auth.uid() IN (SELECT user_id FROM public.admins WHERE user_id IS NOT NULL)
);

-- 沒有人可以直接新增/修改/刪除管理員（只能透過 Supabase Dashboard）
DROP POLICY IF EXISTS "No direct admin modifications" ON public.admins;
CREATE POLICY "No direct admin modifications"
ON public.admins FOR ALL
TO authenticated
USING (false)
WITH CHECK (false);

-- 新增指定的管理員帳號
INSERT INTO public.admins (email, notes)
VALUES 
  ('terrywang981231@gmail.com', '主要管理員'),
  ('bob805606569@gmail.com', '管理員')
ON CONFLICT (email) DO NOTHING;

-- ============================================
-- 3. 使用者 Profile 表格（含審核狀態）
-- ============================================

-- 使用者狀態類型
DO $$ BEGIN
  CREATE TYPE user_status AS ENUM ('pending', 'approved', 'rejected', 'banned');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- 建立 user_profiles 表格
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  status user_status DEFAULT 'pending',
  storage_limit_bytes BIGINT DEFAULT 15728640, -- 預設 15MB
  storage_used_bytes BIGINT DEFAULT 0,
  auto_sync_enabled BOOLEAN DEFAULT false,
  auto_sync_interval_minutes INTEGER DEFAULT 5,
  push_notifications_enabled BOOLEAN DEFAULT false,
  last_seen_at TIMESTAMPTZ,
  approved_by UUID REFERENCES auth.users(id),
  approved_at TIMESTAMPTZ,
  rejected_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 啟用 RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

-- 所有已認證用戶可以查看其他「已批准」用戶的基本資訊（用於線上狀態顯示）
DROP POLICY IF EXISTS "Users can view approved profiles" ON public.user_profiles;
CREATE POLICY "Users can view approved profiles"
ON public.user_profiles FOR SELECT
TO authenticated
USING (
  -- 可以查看自己的資料
  id = auth.uid()
  OR
  -- 可以查看已批准用戶的基本資訊
  status = 'approved'
  OR
  -- 管理員可以查看所有用戶
  auth.uid() IN (SELECT user_id FROM public.admins WHERE user_id IS NOT NULL)
);

-- 用戶可以更新自己的部分設定
DROP POLICY IF EXISTS "Users can update own profile settings" ON public.user_profiles;
CREATE POLICY "Users can update own profile settings"
ON public.user_profiles FOR UPDATE
TO authenticated
USING (id = auth.uid())
WITH CHECK (id = auth.uid());

-- 管理員可以更新任何用戶的資料（審核、禁用等）
DROP POLICY IF EXISTS "Admins can update any profile" ON public.user_profiles;
CREATE POLICY "Admins can update any profile"
ON public.user_profiles FOR UPDATE
TO authenticated
USING (
  auth.uid() IN (SELECT user_id FROM public.admins WHERE user_id IS NOT NULL)
);

-- 自動建立 profile 的觸發器
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  is_admin_user BOOLEAN;
BEGIN
  -- 檢查是否為管理員
  SELECT EXISTS (
    SELECT 1 FROM public.admins WHERE email = NEW.email
  ) INTO is_admin_user;
  
  -- 建立 profile，管理員自動批准
  INSERT INTO public.user_profiles (
    id,
    email,
    display_name,
    avatar_url,
    status,
    storage_limit_bytes
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url',
    CASE WHEN is_admin_user THEN 'approved'::user_status ELSE 'pending'::user_status END,
    CASE WHEN is_admin_user THEN 104857600 ELSE 15728640 END -- 管理員 100MB，一般用戶 15MB
  )
  ON CONFLICT (id) DO UPDATE SET
    email = EXCLUDED.email,
    display_name = COALESCE(EXCLUDED.display_name, public.user_profiles.display_name),
    avatar_url = COALESCE(EXCLUDED.avatar_url, public.user_profiles.avatar_url),
    updated_at = NOW();
  
  -- 如果是管理員，更新 admins 表的 user_id
  IF is_admin_user THEN
    UPDATE public.admins
    SET user_id = NEW.id
    WHERE email = NEW.email AND user_id IS NULL;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 移除可能存在的舊觸發器
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- 當新使用者建立時，自動建立 profile
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- ============================================
-- 4. Storage RLS 政策 - 只有「已批准」的使用者才能存取
-- ============================================

-- 刪除可能存在的舊政策
DROP POLICY IF EXISTS "Users can view own notes" ON storage.objects;
DROP POLICY IF EXISTS "Users can upload own notes" ON storage.objects;
DROP POLICY IF EXISTS "Users can update own notes" ON storage.objects;
DROP POLICY IF EXISTS "Users can delete own notes" ON storage.objects;

-- 輔助函數：檢查用戶是否已批准
CREATE OR REPLACE FUNCTION public.is_user_approved(check_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = check_user_id AND status = 'approved'
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 已批准的使用者可以讀取自己的筆記
CREATE POLICY "Users can view own notes"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'user-notes'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND public.is_user_approved()
);

-- 已批准的使用者可以上傳自己的筆記
CREATE POLICY "Users can upload own notes"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'user-notes'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND public.is_user_approved()
);

-- 已批准的使用者可以更新自己的筆記
CREATE POLICY "Users can update own notes"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'user-notes'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND public.is_user_approved()
);

-- 已批准的使用者可以刪除自己的筆記
CREATE POLICY "Users can delete own notes"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'user-notes'
  AND auth.uid()::text = (storage.foldername(name))[1]
  AND public.is_user_approved()
);

-- ============================================
-- 5. RPC 函數集合
-- ============================================

-- 檢查使用者是否為管理員
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM public.admins
    WHERE user_id = auth.uid()
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 取得使用者的儲存限制
CREATE OR REPLACE FUNCTION public.get_storage_limit()
RETURNS BIGINT AS $$
DECLARE
  limit_bytes BIGINT;
BEGIN
  SELECT storage_limit_bytes INTO limit_bytes
  FROM public.user_profiles
  WHERE id = auth.uid();
  
  RETURN COALESCE(limit_bytes, 15728640);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 取得當前用戶的完整 profile
CREATE OR REPLACE FUNCTION public.get_my_profile()
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  status user_status,
  storage_limit_bytes BIGINT,
  storage_used_bytes BIGINT,
  auto_sync_enabled BOOLEAN,
  auto_sync_interval_minutes INTEGER,
  push_notifications_enabled BOOLEAN,
  is_admin BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.id,
    p.email,
    p.display_name,
    p.avatar_url,
    p.status,
    p.storage_limit_bytes,
    p.storage_used_bytes,
    p.auto_sync_enabled,
    p.auto_sync_interval_minutes,
    p.push_notifications_enabled,
    EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = p.id) as is_admin,
    p.created_at
  FROM public.user_profiles p
  WHERE p.id = auth.uid();
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 管理員：取得所有待審核用戶
CREATE OR REPLACE FUNCTION public.admin_get_pending_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  status user_status,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  -- 檢查是否為管理員
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin only';
  END IF;
  
  RETURN QUERY
  SELECT 
    p.id,
    p.email,
    p.display_name,
    p.avatar_url,
    p.status,
    p.created_at
  FROM public.user_profiles p
  WHERE p.status = 'pending'
  ORDER BY p.created_at ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 管理員：取得所有用戶
CREATE OR REPLACE FUNCTION public.admin_get_all_users()
RETURNS TABLE (
  id UUID,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  status user_status,
  storage_limit_bytes BIGINT,
  storage_used_bytes BIGINT,
  last_seen_at TIMESTAMPTZ,
  is_admin BOOLEAN,
  created_at TIMESTAMPTZ
) AS $$
BEGIN
  -- 檢查是否為管理員
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin only';
  END IF;
  
  RETURN QUERY
  SELECT 
    p.id,
    p.email,
    p.display_name,
    p.avatar_url,
    p.status,
    p.storage_limit_bytes,
    p.storage_used_bytes,
    p.last_seen_at,
    EXISTS (SELECT 1 FROM public.admins a WHERE a.user_id = p.id) as is_admin,
    p.created_at
  FROM public.user_profiles p
  ORDER BY p.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 管理員：批准用戶
CREATE OR REPLACE FUNCTION public.admin_approve_user(target_user_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  -- 檢查是否為管理員
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin only';
  END IF;
  
  UPDATE public.user_profiles
  SET 
    status = 'approved',
    approved_by = auth.uid(),
    approved_at = NOW(),
    updated_at = NOW()
  WHERE id = target_user_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 管理員：拒絕用戶
CREATE OR REPLACE FUNCTION public.admin_reject_user(target_user_id UUID, reason TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
  -- 檢查是否為管理員
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin only';
  END IF;
  
  UPDATE public.user_profiles
  SET 
    status = 'rejected',
    rejected_reason = reason,
    updated_at = NOW()
  WHERE id = target_user_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 管理員：禁用用戶
CREATE OR REPLACE FUNCTION public.admin_ban_user(target_user_id UUID, reason TEXT DEFAULT NULL)
RETURNS BOOLEAN AS $$
BEGIN
  -- 檢查是否為管理員
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin only';
  END IF;
  
  -- 不能禁用管理員
  IF EXISTS (SELECT 1 FROM public.admins WHERE user_id = target_user_id) THEN
    RAISE EXCEPTION 'Cannot ban an admin';
  END IF;
  
  UPDATE public.user_profiles
  SET 
    status = 'banned',
    rejected_reason = reason,
    updated_at = NOW()
  WHERE id = target_user_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 管理員：修改用戶儲存限制
CREATE OR REPLACE FUNCTION public.admin_set_user_storage_limit(target_user_id UUID, new_limit_bytes BIGINT)
RETURNS BOOLEAN AS $$
BEGIN
  -- 檢查是否為管理員
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin only';
  END IF;
  
  UPDATE public.user_profiles
  SET 
    storage_limit_bytes = new_limit_bytes,
    updated_at = NOW()
  WHERE id = target_user_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 更新 last_seen_at（用於線上狀態）
CREATE OR REPLACE FUNCTION public.update_last_seen()
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.user_profiles
  SET last_seen_at = NOW()
  WHERE id = auth.uid();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 取得線上用戶（5 分鐘內有活動）
CREATE OR REPLACE FUNCTION public.get_online_users()
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  avatar_url TEXT,
  last_seen_at TIMESTAMPTZ
) AS $$
BEGIN
  -- 只有已批准的用戶才能查看線上狀態
  IF NOT public.is_user_approved() THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    p.id,
    p.display_name,
    p.avatar_url,
    p.last_seen_at
  FROM public.user_profiles p
  WHERE 
    p.status = 'approved'
    AND p.last_seen_at > NOW() - INTERVAL '5 minutes'
  ORDER BY p.last_seen_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 6. 群聊表格（為未來功能預留）
-- ============================================

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  edited_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  deleted_by UUID REFERENCES auth.users(id)
);

-- 啟用 RLS
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- 已批准用戶可以查看未刪除的訊息
DROP POLICY IF EXISTS "Approved users can view messages" ON public.chat_messages;
CREATE POLICY "Approved users can view messages"
ON public.chat_messages FOR SELECT
TO authenticated
USING (
  deleted_at IS NULL
  AND public.is_user_approved()
);

-- 已批准用戶可以發送訊息
DROP POLICY IF EXISTS "Approved users can send messages" ON public.chat_messages;
CREATE POLICY "Approved users can send messages"
ON public.chat_messages FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND public.is_user_approved()
);

-- 用戶可以編輯自己的訊息（5 分鐘內）
DROP POLICY IF EXISTS "Users can edit own recent messages" ON public.chat_messages;
CREATE POLICY "Users can edit own recent messages"
ON public.chat_messages FOR UPDATE
TO authenticated
USING (
  user_id = auth.uid()
  AND created_at > NOW() - INTERVAL '5 minutes'
)
WITH CHECK (
  user_id = auth.uid()
);

-- 管理員可以刪除任何訊息（軟刪除）
CREATE OR REPLACE FUNCTION public.admin_delete_message(message_id UUID)
RETURNS BOOLEAN AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'Permission denied: admin only';
  END IF;
  
  UPDATE public.chat_messages
  SET 
    deleted_at = NOW(),
    deleted_by = auth.uid()
  WHERE id = message_id;
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 7. 私訊表格（為未來功能預留，1天後懶刪除）
-- ============================================

CREATE TABLE IF NOT EXISTS public.private_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sender_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  recipient_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  content TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '1 day')
);

-- 啟用 RLS
ALTER TABLE public.private_messages ENABLE ROW LEVEL SECURITY;

-- 建立過期訊息索引
CREATE INDEX IF NOT EXISTS idx_private_messages_expires_at ON public.private_messages(expires_at);

-- 用戶可以查看自己發送或接收的未過期訊息
DROP POLICY IF EXISTS "Users can view own messages" ON public.private_messages;
CREATE POLICY "Users can view own messages"
ON public.private_messages FOR SELECT
TO authenticated
USING (
  (sender_id = auth.uid() OR recipient_id = auth.uid())
  AND expires_at > NOW()
  AND public.is_user_approved()
);

-- 已批准用戶可以發送私訊
DROP POLICY IF EXISTS "Approved users can send private messages" ON public.private_messages;
CREATE POLICY "Approved users can send private messages"
ON public.private_messages FOR INSERT
TO authenticated
WITH CHECK (
  sender_id = auth.uid()
  AND public.is_user_approved()
  -- 只能發送給已批准的用戶
  AND EXISTS (
    SELECT 1 FROM public.user_profiles 
    WHERE id = recipient_id AND status = 'approved'
  )
);

-- 懶刪除：當用戶查詢私訊時，順便清理過期訊息
CREATE OR REPLACE FUNCTION public.cleanup_expired_private_messages()
RETURNS INTEGER AS $$
DECLARE
  deleted_count INTEGER;
BEGIN
  DELETE FROM public.private_messages
  WHERE expires_at < NOW();
  
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 10. 群聊功能函數
-- ============================================

-- 取得群聊訊息（分頁）
CREATE OR REPLACE FUNCTION public.get_chat_messages(
  p_limit INTEGER DEFAULT 50,
  p_before_id UUID DEFAULT NULL
)
RETURNS TABLE (
  id UUID,
  user_id UUID,
  display_name TEXT,
  avatar_url TEXT,
  content TEXT,
  created_at TIMESTAMPTZ,
  is_own BOOLEAN
) AS $$
BEGIN
  -- 清理過期私訊（懶刪除）
  PERFORM public.cleanup_expired_private_messages();
  
  IF NOT public.is_user_approved() THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    m.id,
    m.user_id,
    COALESCE(p.display_name, 'Unknown') as display_name,
    p.avatar_url,
    m.content,
    m.created_at,
    (m.user_id = auth.uid()) as is_own
  FROM public.chat_messages m
  LEFT JOIN public.user_profiles p ON m.user_id = p.id
  WHERE m.deleted_at IS NULL
    AND (p_before_id IS NULL OR m.created_at < (SELECT created_at FROM public.chat_messages WHERE id = p_before_id))
  ORDER BY m.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 發送群聊訊息
CREATE OR REPLACE FUNCTION public.send_chat_message(p_content TEXT)
RETURNS UUID AS $$
DECLARE
  new_id UUID;
BEGIN
  IF NOT public.is_user_approved() THEN
    RAISE EXCEPTION 'User not approved';
  END IF;
  
  IF LENGTH(TRIM(p_content)) = 0 OR LENGTH(p_content) > 2000 THEN
    RAISE EXCEPTION 'Invalid message content';
  END IF;
  
  INSERT INTO public.chat_messages (user_id, content)
  VALUES (auth.uid(), TRIM(p_content))
  RETURNING id INTO new_id;
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 管理員：取得待審核用戶數量
CREATE OR REPLACE FUNCTION public.admin_get_pending_count()
RETURNS INTEGER AS $$
BEGIN
  IF NOT public.is_admin() THEN
    RETURN 0;
  END IF;
  
  RETURN (SELECT COUNT(*) FROM public.user_profiles WHERE status = 'pending')::INTEGER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 11. 私訊功能函數
-- ============================================

-- 取得可私訊的用戶列表（已批准的用戶，排除自己）
CREATE OR REPLACE FUNCTION public.get_messageable_users()
RETURNS TABLE (
  id UUID,
  display_name TEXT,
  avatar_url TEXT,
  last_seen_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT public.is_user_approved() THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  SELECT 
    p.id,
    p.display_name,
    p.avatar_url,
    p.last_seen_at
  FROM public.user_profiles p
  WHERE p.status = 'approved'
    AND p.id != auth.uid()
  ORDER BY p.last_seen_at DESC NULLS LAST;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 發送私訊
CREATE OR REPLACE FUNCTION public.send_private_message(
  p_recipient_id UUID,
  p_content TEXT
)
RETURNS UUID AS $$
DECLARE
  new_id UUID;
BEGIN
  IF NOT public.is_user_approved() THEN
    RAISE EXCEPTION 'User not approved';
  END IF;
  
  IF LENGTH(TRIM(p_content)) = 0 OR LENGTH(p_content) > 2000 THEN
    RAISE EXCEPTION 'Invalid message content';
  END IF;
  
  -- 確認收件人存在且已批准
  IF NOT EXISTS (SELECT 1 FROM public.user_profiles WHERE id = p_recipient_id AND status = 'approved') THEN
    RAISE EXCEPTION 'Recipient not found or not approved';
  END IF;
  
  INSERT INTO public.private_messages (sender_id, recipient_id, content)
  VALUES (auth.uid(), p_recipient_id, TRIM(p_content))
  RETURNING id INTO new_id;
  
  RETURN new_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 取得私訊對話列表（群組過的對話）
CREATE OR REPLACE FUNCTION public.get_private_conversations()
RETURNS TABLE (
  partner_id UUID,
  partner_name TEXT,
  partner_avatar TEXT,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count BIGINT
) AS $$
BEGIN
  -- 清理過期訊息
  PERFORM public.cleanup_expired_private_messages();
  
  IF NOT public.is_user_approved() THEN
    RETURN;
  END IF;
  
  RETURN QUERY
  WITH conversations AS (
    SELECT 
      CASE 
        WHEN sender_id = auth.uid() THEN recipient_id 
        ELSE sender_id 
      END as partner,
      content,
      created_at,
      read_at,
      sender_id
    FROM public.private_messages
    WHERE (sender_id = auth.uid() OR recipient_id = auth.uid())
      AND expires_at > NOW()
  ),
  ranked AS (
    SELECT 
      partner,
      content,
      created_at,
      read_at,
      sender_id,
      ROW_NUMBER() OVER (PARTITION BY partner ORDER BY created_at DESC) as rn
    FROM conversations
  )
  SELECT 
    r.partner as partner_id,
    p.display_name as partner_name,
    p.avatar_url as partner_avatar,
    r.content as last_message,
    r.created_at as last_message_at,
    (SELECT COUNT(*) FROM public.private_messages pm 
     WHERE pm.sender_id = r.partner 
       AND pm.recipient_id = auth.uid() 
       AND pm.read_at IS NULL 
       AND pm.expires_at > NOW()) as unread_count
  FROM ranked r
  JOIN public.user_profiles p ON r.partner = p.id
  WHERE r.rn = 1
  ORDER BY r.created_at DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 取得與特定用戶的私訊
CREATE OR REPLACE FUNCTION public.get_private_messages(
  p_partner_id UUID,
  p_limit INTEGER DEFAULT 50
)
RETURNS TABLE (
  id UUID,
  sender_id UUID,
  content TEXT,
  created_at TIMESTAMPTZ,
  is_own BOOLEAN,
  read_at TIMESTAMPTZ
) AS $$
BEGIN
  IF NOT public.is_user_approved() THEN
    RETURN;
  END IF;
  
  -- 標記收到的訊息為已讀
  UPDATE public.private_messages
  SET read_at = NOW()
  WHERE sender_id = p_partner_id
    AND recipient_id = auth.uid()
    AND read_at IS NULL
    AND expires_at > NOW();
  
  RETURN QUERY
  SELECT 
    m.id,
    m.sender_id,
    m.content,
    m.created_at,
    (m.sender_id = auth.uid()) as is_own,
    m.read_at
  FROM public.private_messages m
  WHERE ((m.sender_id = auth.uid() AND m.recipient_id = p_partner_id)
      OR (m.sender_id = p_partner_id AND m.recipient_id = auth.uid()))
    AND m.expires_at > NOW()
  ORDER BY m.created_at DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 取得未讀私訊總數
CREATE OR REPLACE FUNCTION public.get_unread_message_count()
RETURNS INTEGER AS $$
BEGIN
  IF NOT public.is_user_approved() THEN
    RETURN 0;
  END IF;
  
  RETURN (
    SELECT COUNT(*)
    FROM public.private_messages
    WHERE recipient_id = auth.uid()
      AND read_at IS NULL
      AND expires_at > NOW()
  )::INTEGER;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 啟用 private_messages 的 Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.private_messages;

-- ============================================
-- 8. 用戶設定更新函數（自動同步設定等）
-- ============================================

CREATE OR REPLACE FUNCTION public.update_my_settings(
  p_auto_sync_enabled BOOLEAN DEFAULT NULL,
  p_auto_sync_interval_minutes INTEGER DEFAULT NULL,
  p_push_notifications_enabled BOOLEAN DEFAULT NULL
)
RETURNS BOOLEAN AS $$
BEGIN
  UPDATE public.user_profiles
  SET
    auto_sync_enabled = COALESCE(p_auto_sync_enabled, auto_sync_enabled),
    auto_sync_interval_minutes = COALESCE(p_auto_sync_interval_minutes, auto_sync_interval_minutes),
    push_notifications_enabled = COALESCE(p_push_notifications_enabled, push_notifications_enabled),
    updated_at = NOW()
  WHERE id = auth.uid();
  
  RETURN FOUND;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================
-- 9. 啟用 Realtime（用於群聊和線上狀態）
-- ============================================

-- 啟用 chat_messages 的 Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;

-- 啟用 user_profiles 的 Realtime（用於線上狀態）
ALTER PUBLICATION supabase_realtime ADD TABLE public.user_profiles;

-- ============================================
-- 完成訊息
-- ============================================
DO $$
BEGIN
  RAISE NOTICE '✅ APEINTEL ATLAS Supabase 初始化完成！';
  RAISE NOTICE '';
  RAISE NOTICE '📋 已建立：';
  RAISE NOTICE '   - Storage Bucket: user-notes (15MB限制，只有已批准用戶可用)';
  RAISE NOTICE '   - 表格: admins (管理員)';
  RAISE NOTICE '   - 表格: user_profiles (用戶資料，含審核狀態)';
  RAISE NOTICE '   - 表格: chat_messages (群聊，預留)';
  RAISE NOTICE '   - 表格: private_messages (私訊，1天過期)';
  RAISE NOTICE '   - RLS 政策已啟用';
  RAISE NOTICE '   - Realtime 已啟用';
  RAISE NOTICE '';
  RAISE NOTICE '👤 用戶狀態流程：';
  RAISE NOTICE '   1. 新用戶註冊 → pending (等待審核)';
  RAISE NOTICE '   2. 管理員批准 → approved (可使用所有功能)';
  RAISE NOTICE '   3. 管理員拒絕 → rejected (無法使用)';
  RAISE NOTICE '   4. 管理員禁用 → banned (已批准但被禁)';
  RAISE NOTICE '';
  RAISE NOTICE '🔑 管理員帳號（自動批准）：';
  RAISE NOTICE '   - terrywang981231@gmail.com';
  RAISE NOTICE '   - bob805606569@gmail.com';
  RAISE NOTICE '';
  RAISE NOTICE '⚠️ 請記得在 Supabase Dashboard 中設定 Google OAuth！';
END $$;
