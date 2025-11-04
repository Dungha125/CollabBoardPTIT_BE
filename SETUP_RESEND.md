# 🚀 Hướng Dẫn Setup Email với Resend API

## ❌ Vấn Đề: Railway Chặn SMTP

Railway (và hầu hết hosting providers) **chặn SMTP ports 587/465** để chống spam, gây lỗi:
```
Error: Connection timeout (ETIMEDOUT)
command: 'CONN'
```

**Giải pháp:** Dùng **Resend API** (HTTP-based) thay vì SMTP!

---

## ✅ Tại Sao Chọn Resend?

| Tiêu chí | Resend | Gmail SMTP | SendGrid |
|----------|--------|------------|----------|
| **Hoạt động trên Railway** | ✅ Hoàn hảo | ❌ Timeout | ✅ OK |
| **Miễn phí** | 100 emails/day | Unlimited | 100 emails/day |
| **Setup time** | ⚡ 2 phút | 🐌 10 phút | 🐌 15 phút |
| **Cần verify sender** | ❌ Không (dùng onboarding@resend.dev) | ✅ Cần | ✅ Cần |
| **Tốc độ** | ⚡ Instant | 🐌 Chậm (nếu không bị block) | ⚡ Nhanh |

---

## 📋 Các Bước Setup (2 phút)

### 1️⃣ Tạo Tài Khoản Resend

1. Vào **https://resend.com/signup**
2. Đăng ký bằng email hoặc GitHub
3. Xác thực email (check inbox)

### 2️⃣ Lấy API Key

1. Sau khi login, vào **https://resend.com/api-keys**
2. Click **"Create API Key"**
3. Đặt tên: `CollabBoard Production`
4. Chọn quyền: **"Sending access"** (hoặc "Full access")
5. Click **Create**
6. **Copy API key** (bắt đầu với `re_...`)
   
   ⚠️ **Chú ý:** API key chỉ hiển thị 1 lần duy nhất!

### 3️⃣ Thêm Vào Railway

1. Vào Railway Dashboard
2. Chọn project **CollabBoard Backend**
3. Tab **"Variables"**
4. Click **"New Variable"** và thêm:

```bash
RESEND_API_KEY=re_xxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

5. Thêm biến thứ 2 (optional):

```bash
EMAIL_FROM=CollabBoard <onboarding@resend.dev>
```

6. Click **"Deploy"** (hoặc tự động deploy)

### 4️⃣ Verify Hoạt Động

Deploy xong, test gửi invite từ app:

1. Tạo room mới
2. Click "Share Room"
3. Nhập email và gửi
4. Check **Railway logs** để xem:

```bash
✅ Sent 1 email(s) for room xxx via Resend API
Email IDs: 550e8400-e29b-41d4-a716-446655440000
```

5. **Check email inbox** → Email sẽ đến trong **5-10 giây**!

---

## 🔥 Troubleshooting

### ❌ "RESEND_API_KEY not configured"

→ Kiểm tra Railway Variables có `RESEND_API_KEY` chưa  
→ Restart app sau khi thêm env var

### ❌ "Resend API error: Invalid API key"

→ API key sai hoặc đã bị xóa  
→ Tạo API key mới tại https://resend.com/api-keys

### ❌ Email không đến inbox

**Nếu dùng `onboarding@resend.dev` (sender mặc định):**
- ✅ Chỉ gửi được đến email bạn đã đăng ký Resend
- ❌ Không gửi được đến email bất kỳ

**Giải pháp:** Verify domain của bạn (xem phần dưới)

### ✅ Email vào Spam

→ Normal cho sender domain mới  
→ Sau vài email, mailbox sẽ học và bỏ vào inbox

---

## 🎯 (Optional) Verify Domain Riêng

Để gửi email từ domain của bạn (vd: `noreply@yourdomain.com`) và gửi đến **BẤT KỲ email nào**:

### 1. Thêm Domain vào Resend

1. Vào https://resend.com/domains
2. Click **"Add Domain"**
3. Nhập domain của bạn (vd: `yourdomain.com`)
4. Resend sẽ cho bạn các DNS records

### 2. Thêm DNS Records

Copy các records này vào DNS provider (Vercel, Cloudflare, GoDaddy...):

```
Type: TXT
Name: @ hoặc yourdomain.com
Value: resend-verification=xxxxx

Type: TXT  
Name: _dmarc
Value: v=DMARC1; p=none

Type: TXT
Name: resend._domainkey  
Value: (DKIM key từ Resend)

Type: MX
Name: @
Value: feedback-smtp.resend.com
Priority: 10
```

### 3. Verify Domain

1. Sau khi add DNS (đợi ~5-15 phút)
2. Quay lại Resend → Click **"Verify"**
3. Nếu xanh ✅ → Domain đã verify!

### 4. Update Railway Env

```bash
EMAIL_FROM=CollabBoard <noreply@yourdomain.com>
```

Redeploy và test → Email sẽ gửi từ domain của bạn! 🎉

---

## 💰 Pricing

### Free Tier (100 emails/day)
- ✅ Đủ cho hầu hết project cá nhân
- ✅ Không cần thẻ tín dụng
- ✅ Không giới hạn domain

### Paid ($20/tháng)
- 50,000 emails/tháng
- Chỉ cần upgrade nếu app có nhiều users

---

## 🔗 Tài Nguyên

- **Resend Docs:** https://resend.com/docs
- **API Reference:** https://resend.com/docs/api-reference/emails/send-email
- **Status Page:** https://resend.com/status

---

## ✅ Checklist

- [ ] Tạo tài khoản Resend
- [ ] Lấy API key
- [ ] Add `RESEND_API_KEY` vào Railway Variables
- [ ] Deploy Railway
- [ ] Test gửi email
- [ ] Check Railway logs: "✅ Sent ... via Resend API"
- [ ] Verify email đến inbox
- [ ] (Optional) Setup custom domain

---

**🎉 Done! Email giờ sẽ gửi instant và không bị Railway block!**

P/S: Nếu muốn dùng SendGrid thay vì Resend, setup tương tự nhưng phức tạp hơn (cần verify sender identity).

