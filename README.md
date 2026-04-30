# بوت تيليجرام عربي للتحكم بمتصفح - جاهز لـ Railway

هذا المشروع يشغّل متصفح Chromium داخل Railway ويتحكم به من خلال بوت تيليجرام باللغة العربية بالكامل.

كل إجراء تقوم به من أزرار البوت يرسل لقطة شاشة تلقائيا، مثل:

- فتح رابط.
- بحث Google.
- الضغط على مربعات مرقمة داخل الصفحة.
- تعبئة الحقول.
- الكتابة في الحقل المحدد.
- مسح الحقل المحدد.
- البحث عن نص داخل الصفحة.
- الضغط على نص داخل الصفحة.
- رجوع، تحديث، سكرول، Enter.

## حل خطأ Playwright الذي ظهر عندك

الخطأ:

```text
Looks like Playwright was just updated to 1.59.1.
Please update docker image as well.
current: mcr.microsoft.com/playwright:v1.49.1-jammy
required: mcr.microsoft.com/playwright:v1.59.1-jammy
```

سببه أن صورة Docker قديمة، بينما مكتبة Playwright داخل المشروع إصدارها أحدث.

تم إصلاح ذلك في هذا المشروع عبر توحيد الإصدارين:

```dockerfile
FROM mcr.microsoft.com/playwright:v1.59.1-jammy
```

وفي `package.json`:

```json
"playwright": "1.59.1"
```

لا تغيّر إصدار Playwright أو صورة Docker إلا إذا جعلتهما نفس الإصدار.

## النشر على Railway

1. فك الضغط عن الملف.
2. ارفع المشروع إلى GitHub.
3. من Railway اختر:

```text
New Project -> Deploy from GitHub Repo
```

4. اختر المستودع.
5. Railway سيستخدم `Dockerfile` تلقائيا.
6. ضع المتغيرات من قسم المتغيرات بالأسفل.
7. افتح بوت تيليجرام وأرسل:

```text
/start
```

## المتغيرات في Railway

افتح:

```text
Railway -> Service -> Variables -> RAW Editor
```

ثم ضع:

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

### TELEGRAM_BOT_TOKEN

ضع توكن البوت الذي تحصل عليه من BotFather.

### ALLOWED_USER_IDS

ضع آيدي حسابك في تيليجرام حتى لا يستخدم البوت أي شخص غيرك.

يمكنك معرفة الآيدي عبر إرسال رسالة إلى بوت مثل:

```text
@userinfobot
```

مثال:

```env
ALLOWED_USER_IDS=123456789
```

لأكثر من مستخدم:

```env
ALLOWED_USER_IDS=123456789,987654321
```

## طريقة الاستخدام من تيليجرام

بعد تشغيل البوت أرسل:

```text
/start
```

ستظهر لك صورة للموقع ومعها أزرار عربية.

### الأزرار الرئيسية

- `فتح رابط`: يطلب منك الرابط، ثم يفتحه ويرسل Screenshot.
- `بحث Google`: يطلب منك النص، ثم يبحث ويرسل Screenshot.
- `إظهار المربعات`: يضع أرقام على العناصر داخل الصفحة ويرسل Screenshot.
- `لقطة شاشة`: يرسل لقطة جديدة.
- `تعبئة مربع`: اختر بعدها رقم الحقل من الأزرار، ثم أرسل النص.
- `كتابة هنا`: يكتب النص في الحقل المحدد حاليا.
- `مسح الحقل`: يمسح الحقل المحدد حاليا.
- `اضغط على نص`: أرسل نصا موجودا في الصفحة، وسيبحث عنه ويضغط عليه.
- `ابحث عن نص`: أرسل نصا موجودا في الصفحة، وسيعلّمه باللون الأخضر.
- `Enter`: يضغط Enter.
- `رجوع`: يرجع للصفحة السابقة.
- `تحديث`: يعيد تحميل الصفحة.
- `سكرول أعلى / أسفل`: يحرك الصفحة.

### معنى ألوان المربعات

- المربعات الحمراء: عناصر ضغط مثل روابط وأزرار.
- المربعات الزرقاء: حقول كتابة أو عناصر قابلة للتعبئة.

اضغط على رقم المربع من أزرار تيليجرام، وسيتم تنفيذ الضغط ثم إرسال Screenshot تلقائيا.

## دعم اللغة العربية

المشروع مضبوط افتراضيا على:

```env
LOCALE=ar-IQ
TIMEZONE_ID=Asia/Baghdad
```

ويدعم إدخال النص العربي في البحث والحقول.

## تشغيل محلي اختياري

```bash
npm install
cp .env.example .env
npm start
```

إذا أردت تشغيله محليا بدون Docker، قد تحتاج إلى تثبيت متصفح Playwright:

```bash
npx playwright install chromium
```

## استخدام Chromax بدلا من Chromium

على Railway يجب أن يكون ملف Chromax نسخة Linux وليس Windows.

إذا وضعت Chromax داخل المشروع مثلا في:

```text
/app/chromax/chromax
```

ضع:

```env
BROWSER_EXECUTABLE_PATH=/app/chromax/chromax
BROWSER_ARGS=--fingerprint-platform=Win32 --fingerprint-screen-resolution=1920x1080
```

إذا تركت `BROWSER_EXECUTABLE_PATH` فارغا، سيستخدم Chromium الموجود في Docker image.

## ملاحظات مهمة

- لا تستخدم البوت بدون ضبط `ALLOWED_USER_IDS`.
- Railway يستخدم نظام Linux، لذلك ملفات `.exe` الخاصة بويندوز لن تعمل.
- إذا غيّرت إصدار Playwright في `package.json`، يجب أن تغيّر صورة Docker إلى نفس الإصدار.
