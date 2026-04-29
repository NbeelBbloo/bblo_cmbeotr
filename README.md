# Telegram Browser Bot - Railway Ready

بوت تيليجرام للتحكم بمتصفح Playwright من داخل تيليجرام. يرسل صورة Screenshot بعد كل خطوة، ويعرض مربعات مرقمة فوق العناصر القابلة للنقر، ويمكنك الضغط عليها من أزرار البوت أو بالأوامر.

## المميزات

- جاهز للنشر على Railway باستخدام Dockerfile.
- يعمل بـ Telegram long polling، ولا يحتاج Webhook.
- خادم Health صغير على `PORT` حتى تظهر الخدمة سليمة في Railway.
- صورة بعد كل خطوة.
- مربعات مرقمة فوق الروابط، الأزرار، الحقول، وعناصر النقر.
- أزرار Inline داخل تيليجرام للضغط على العناصر والتنقل والتمرير.
- أوامر للكتابة، البحث عن نص، الضغط على نص، حذف/ملء الحقول.
- يدعم Chromium الافتراضي أو متصفح مخصص مثل Chromax إذا كان لديك ملف Linux executable.
- يدعم البروكسي HTTP/SOCKS5.
- حماية عبر `ALLOWED_USER_IDS` حتى لا يتحكم بالبروزر إلا حسابك.

## النشر على Railway

1. ارفع هذا المشروع إلى GitHub.
2. افتح Railway وأنشئ Project جديد من GitHub repo.
3. Railway سيكتشف `Dockerfile` تلقائيا.
4. افتح Service ثم Variables.
5. ضع المتغيرات الموجودة في قسم المتغيرات أدناه.
6. Deploy.

## المتغيرات الأساسية لنسخها في Railway

```env
TELEGRAM_BOT_TOKEN=PUT_YOUR_BOT_TOKEN_HERE
ALLOWED_USER_IDS=PUT_YOUR_TELEGRAM_USER_ID_HERE
PORT=3000
HEADLESS=true
DEFAULT_START_URL=https://www.google.com
VIEWPORT_WIDTH=1365
VIEWPORT_HEIGHT=768
DEVICE_SCALE_FACTOR=1
MAX_TARGETS=30
SHOW_BOXES_AFTER_EACH_ACTION=true
NAVIGATION_TIMEOUT_MS=60000
ACTION_DELAY_MS=400
SLOW_MO=0
TIMEZONE_ID=Asia/Baghdad
LOCALE=ar-IQ
BROWSER_EXECUTABLE_PATH=
BROWSER_ARGS=
PROXY_SERVER=
PROXY_USERNAME=
PROXY_PASSWORD=
```

## كيف تحصل على Telegram User ID؟

أرسل رسالة إلى بوت مثل `@userinfobot` وسيعطيك رقم ID. ضع الرقم في:

```env
ALLOWED_USER_IDS=123456789
```

إذا أردت السماح لأكثر من حساب:

```env
ALLOWED_USER_IDS=123456789,987654321
```

ترك `ALLOWED_USER_IDS` فارغا يسمح لأي شخص يجد البوت باستخدامه، وهذا غير مفضل.

## أوامر البوت

- `/start` أو `/help` عرض المساعدة.
- `/open example.com` فتح رابط.
- `/google كلمة البحث` البحث في جوجل.
- `/shot` إرسال صورة فقط.
- `/boxes` تحديث المربعات المرقمة.
- `/tap 5` الضغط على العنصر رقم 5.
- `/fill 8 hello` مسح الحقل رقم 8 وكتابة النص.
- `/type hello` كتابة النص في العنصر الحالي Focused.
- `/clear 8` مسح الحقل رقم 8.
- `/find text` البحث عن نص داخل الصفحة وتمييزه.
- `/clicktext text` البحث عن نص والضغط عليه.
- `/press Enter` ضغط زر من لوحة المفاتيح.
- `/scroll down` أو `/scroll up` تمرير الصفحة.
- `/back` رجوع.
- `/forward` تقدم.
- `/reload` تحديث.
- `/url` عرض الرابط الحالي.
- `/close` إغلاق جلسة المتصفح.

## تشغيل محلي

```bash
npm install
npx playwright install chromium
cp .env.example .env
npm start
```

## استخدام Chromax

Railway يعمل على Linux، لذلك يجب أن يكون ملف Chromax نسخة Linux executable. ضع الملف داخل المشروع مثلا:

```text
chromax/chromax
```

ثم اجعل المتغير:

```env
BROWSER_EXECUTABLE_PATH=/app/chromax/chromax
```

ويمكنك إضافة flags:

```env
BROWSER_ARGS=--fingerprint-platform=Win32 --fingerprint-screen-resolution=1920x1080
```

ملاحظة: ملف Windows `.exe` لن يعمل على Railway.

## البروكسي

```env
PROXY_SERVER=http://host:port
PROXY_USERNAME=username
PROXY_PASSWORD=password
```

أو:

```env
PROXY_SERVER=socks5://host:port
```

## ملاحظات مهمة

- البوت يتحكم بمتصفح حقيقي، لذلك لا تشارك التوكن مع أحد.
- استخدم `ALLOWED_USER_IDS` دائما.
- لا تستخدمه لتجاوز شروط المواقع أو تنفيذ نشاط غير قانوني.
- Railway filesystem قد يكون مؤقتا، لذلك الجلسات لا تضمن البقاء بعد إعادة النشر إلا إذا أضفت Volume.
