// Admin screen texts. (Customer-site texts are edited from the "Texts" section of the dashboard.)
export const S = {
  ar: {
    title: 'لوحة تحكم مون كافيه', login: 'تسجيل الدخول', logout: 'خروج', email: 'البريد الإلكتروني', password: 'كلمة المرور', setup: 'إنشاء حساب المدير', setup_token: 'رمز الإعداد (SETUP_TOKEN)',
    setup_help: 'هذا أول تشغيل: أنشئ حساب المدير باستخدام رمز SETUP_TOKEN المحفوظ في إعدادات Render.', setup_missing: 'لا يوجد حساب مدير بعد. أضف متغير SETUP_TOKEN في Render (Environment) ثم أعد تشغيل الخدمة وافتح هذه الصفحة مجدداً.',
    not_ready: 'قاعدة البيانات تحتاج تحديثاً', not_ready_help: 'لم تُطبَّق تحديثات قاعدة البيانات بعد (migrations). اتبع خطوات الاختبار ثم ضع MIGRATION_MODE=apply في Render وأعد النشر.',
    err_credentials: 'البريد أو كلمة المرور غير صحيحة', err_locked: 'تم قفل الحساب مؤقتاً بعد محاولات كثيرة. حاول بعد 15 دقيقة.', err_setup_token: 'رمز الإعداد غير صحيح', err_already: 'تم إنشاء المدير مسبقاً', err_generic: 'حدث خطأ. حاول مرة أخرى.', err_validation: 'راجع الحقول المعلّمة', err_network: 'لا يوجد اتصال', err_pw_short: 'كلمة المرور 10 أحرف على الأقل', err_pw_match: 'كلمتا المرور غير متطابقتين',
    saved: 'تم الحفظ', deleted: 'تم الحذف', save: 'حفظ', cancel: 'إلغاء', delete: 'حذف', edit: 'تعديل', add: 'إضافة', close: 'إغلاق', up: 'أعلى', down: 'أسفل', yes_delete: 'هل أنت متأكد من الحذف؟', loading: 'جاري التحميل…', empty: 'لا يوجد شيء بعد',
    tab_orders: 'الطلبات', tab_menu: 'القائمة', tab_store: 'الحالة والمواعيد', tab_brand: 'الهوية', tab_content: 'المحتوى', tab_whatsapp: 'واتساب والتوصيل', tab_texts: 'النصوص', tab_account: 'الحساب',
    // orders
    all: 'الكل', status: 'الحالة', order_status: { whatsapp_prepared: 'بانتظار واتساب', confirmed: 'مؤكد', preparing: 'قيد التحضير', completed: 'مكتمل', cancelled: 'ملغي' },
    pickup: 'استلام', delivery: 'توصيل', customer: 'الزبون', phone: 'الهاتف', address: 'العنوان', map: 'الخريطة', notes: 'ملاحظات', items: 'الأصناف', history: 'السجل', note: 'ملاحظة', set_status: 'تغيير الحالة', more: 'المزيد', total: 'الإجمالي', subtotal: 'المجموع', delivery_fee: 'رسوم التوصيل', copy_msg: 'رسالة واتساب',
    // menu
    categories: 'الأقسام', products: 'المنتجات', add_category: 'قسم جديد', add_product: 'منتج جديد', name_ar: 'الاسم بالعربي', name_en: 'الاسم بالإنجليزي', desc_ar: 'الوصف بالعربي', desc_en: 'الوصف بالإنجليزي',
    category: 'القسم', visible: 'ظاهر في الموقع', sold_out: 'غير متوفر (نفد)', image: 'الصورة', upload: 'رفع صورة', remove_image: 'إزالة الصورة', sizes: 'الأحجام والأسعار', size_name_ar: 'الحجم (عربي)', size_name_en: 'الحجم (إنجليزي)', price: 'السعر (ل.ل.)', price_unset: 'بدون سعر', available: 'متاح',
    groups: 'خيارات وإضافات', group_name_ar: 'اسم المجموعة (عربي)', group_name_en: 'اسم المجموعة (إنجليزي)', selection: 'نوع الاختيار', single: 'اختيار واحد', multiple: 'عدة اختيارات', required: 'إلزامي', max_choices: 'الحد الأقصى', choice_ar: 'الخيار (عربي)', choice_en: 'الخيار (إنجليزي)', extra_price: 'سعر إضافي', add_size: 'حجم', add_group: 'مجموعة خيارات', add_choice: 'خيار',
    delete_category_force: 'القسم يحتوي {n} منتج. سيُحذف القسم مع كل منتجاته. متابعة؟', price_soon_note: 'المنتجات بدون سعر تظهر «السعر قريباً» ولا يمكن طلبها.', no_price: 'بدون سعر',
    // store
    store_mode: 'وضع المقهى', mode_auto: 'تلقائي حسب المواعيد', mode_force_open: 'مفتوح دائماً (تجاوز يدوي)', mode_force_closed: 'مغلق الآن (تجاوز يدوي)', timezone: 'المنطقة الزمنية', closed_msg_ar: 'رسالة الإغلاق (عربي)', closed_msg_en: 'رسالة الإغلاق (إنجليزي)', hours: 'مواعيد العمل', hours_help: 'يمكنك إضافة أكثر من فترة في اليوم. إذا كان وقت الإغلاق أصغر من الفتح (مثل 18:00 إلى 02:00) تمتد الفترة بعد منتصف الليل. اترك اليوم فارغاً ليكون مغلقاً.',
    open_from: 'من', open_to: 'إلى', add_interval: 'فترة', live_status: 'الحالة الآن', open_now: 'مفتوح', closed_now: 'مغلق', next_open: 'الافتتاح التالي',
    days: { sun: 'الأحد', mon: 'الاثنين', tue: 'الثلاثاء', wed: 'الأربعاء', thu: 'الخميس', fri: 'الجمعة', sat: 'السبت' },
    // brand
    colors: 'الألوان', primary_color: 'اللون الرئيسي', secondary_color: 'اللون الثانوي', surface_color: 'لون البطاقات', page_background: 'خلفية الصفحة', text_on_dark: 'لون النص على الداكن', text_on_primary: 'لون النص على الرئيسي', fonts: 'الخطوط', font_ar: 'خط العربية', font_en: 'خط الإنجليزية',
    logo: 'الشعار', logo_help: 'الشعار الأصلي مدمج في الموقع. ارفع PNG شفاف (أسود) فقط إذا أردت استبداله.', use_default_logo: 'استخدم الشعار الأصلي', hero_image: 'صورة خلفية الواجهة (اختيارية)',
    // content
    store_info: 'معلومات المقهى', name_en_store: 'اسم المقهى (إنجليزي)', name_ar_store: 'اسم المقهى (عربي)', tagline_ar: 'الشعار النصي (عربي)', tagline_en: 'الشعار النصي (إنجليزي)', address_en: 'العنوان (إنجليزي)', address_ar: 'العنوان (عربي)', phone_store: 'هاتف المقهى',
    social: 'التواصل الاجتماعي', instagram: 'Instagram (اسم الحساب أو الرابط)', facebook: 'Facebook', tiktok: 'TikTok',
    home_content: 'نصوص الصفحة الرئيسية', hero_title_ar: 'عنوان الواجهة (عربي)', hero_title_en: 'عنوان الواجهة (إنجليزي)', hero_text_ar: 'نص الواجهة (عربي)', hero_text_en: 'نص الواجهة (إنجليزي)', banner_enabled: 'إظهار شريط إعلان', banner_ar: 'نص الشريط (عربي)', banner_en: 'نص الشريط (إنجليزي)', footer_ar: 'نص أسفل الصفحة (عربي)', footer_en: 'نص أسفل الصفحة (إنجليزي)', currency_ar: 'العملة (عربي)', currency_en: 'العملة (إنجليزي)',
    promotions: 'العروض', promo_title_ar: 'عنوان العرض (عربي)', promo_title_en: 'عنوان العرض (إنجليزي)', promo_text_ar: 'وصف العرض (عربي)', promo_text_en: 'وصف العرض (إنجليزي)', promo_active: 'فعّال',
    texts_help: 'عدّل أي نص يظهر في الموقع. اترك الحقل فارغاً لاستخدام النص الافتراضي (يظهر كتلميح).',
    // whatsapp / delivery
    wa_number: 'رقم واتساب (مع رمز الدولة أو محلي)', wa_enabled: 'تفعيل الطلب عبر واتساب', wa_template: 'قالب رسالة الطلب', wa_template_help: 'اتركه فارغاً لاستخدام الرسالة الافتراضية. المتغيرات المتاحة:', delivery_enabled: 'تفعيل التوصيل', pickup_enabled: 'تفعيل الاستلام', delivery_fee_lbp: 'رسوم التوصيل (ل.ل.)', min_order_lbp: 'الحد الأدنى للطلب (ل.ل.)', note_ar: 'ملاحظة التوصيل (عربي)', note_en: 'ملاحظة التوصيل (إنجليزي)', whatsapp: 'واتساب', delivery_settings: 'التوصيل والاستلام',
    // account
    change_password: 'تغيير كلمة المرور', current_password: 'كلمة المرور الحالية', new_password: 'كلمة المرور الجديدة', repeat_password: 'أعد كتابة كلمة المرور',
    err_wrong_password: 'كلمة المرور الحالية غير صحيحة', lang_toggle: 'English',
  },
  en: {
    title: 'Moon Cafe dashboard', login: 'Sign in', logout: 'Sign out', email: 'Email', password: 'Password', setup: 'Create the admin account', setup_token: 'Setup token (SETUP_TOKEN)',
    setup_help: 'First run: create the admin account with the SETUP_TOKEN saved in Render settings.', setup_missing: 'There is no admin account yet. Add a SETUP_TOKEN variable in Render (Environment), restart the service, and open this page again.',
    not_ready: 'The database needs an update', not_ready_help: 'The database updates (migrations) have not been applied yet. Follow the test steps, then set MIGRATION_MODE=apply in Render and redeploy.',
    err_credentials: 'Wrong email or password', err_locked: 'The account is locked for a while after too many attempts. Try again in 15 minutes.', err_setup_token: 'The setup token is wrong', err_already: 'The admin account already exists', err_generic: 'Something went wrong. Try again.', err_validation: 'Check the highlighted fields', err_network: 'No connection', err_pw_short: 'Password must be at least 10 characters', err_pw_match: 'Passwords do not match',
    saved: 'Saved', deleted: 'Deleted', save: 'Save', cancel: 'Cancel', delete: 'Delete', edit: 'Edit', add: 'Add', close: 'Close', up: 'Up', down: 'Down', yes_delete: 'Delete this item?', loading: 'Loading…', empty: 'Nothing here yet',
    tab_orders: 'Orders', tab_menu: 'Menu', tab_store: 'Status & hours', tab_brand: 'Brand', tab_content: 'Content', tab_whatsapp: 'WhatsApp & delivery', tab_texts: 'Texts', tab_account: 'Account',
    all: 'All', status: 'Status', order_status: { whatsapp_prepared: 'Awaiting WhatsApp', confirmed: 'Confirmed', preparing: 'Preparing', completed: 'Completed', cancelled: 'Cancelled' },
    pickup: 'Pickup', delivery: 'Delivery', customer: 'Customer', phone: 'Phone', address: 'Address', map: 'Map', notes: 'Notes', items: 'Items', history: 'History', note: 'Note', set_status: 'Change status', more: 'Load more', total: 'Total', subtotal: 'Subtotal', delivery_fee: 'Delivery fee', copy_msg: 'WhatsApp message',
    categories: 'Categories', products: 'Products', add_category: 'New category', add_product: 'New product', name_ar: 'Arabic name', name_en: 'English name', desc_ar: 'Arabic description', desc_en: 'English description',
    category: 'Category', visible: 'Visible on the site', sold_out: 'Sold out', image: 'Image', upload: 'Upload image', remove_image: 'Remove image', sizes: 'Sizes and prices', size_name_ar: 'Size (Arabic)', size_name_en: 'Size (English)', price: 'Price (LBP)', price_unset: 'No price', available: 'Available',
    groups: 'Choices and extras', group_name_ar: 'Group name (Arabic)', group_name_en: 'Group name (English)', selection: 'Selection type', single: 'Pick one', multiple: 'Pick several', required: 'Required', max_choices: 'Maximum', choice_ar: 'Choice (Arabic)', choice_en: 'Choice (English)', extra_price: 'Extra price', add_size: 'Size', add_group: 'Option group', add_choice: 'Choice',
    delete_category_force: 'This category has {n} products. It will be deleted together with them. Continue?', price_soon_note: 'Products without a price show "Price coming soon" and cannot be ordered.', no_price: 'No price',
    store_mode: 'Cafe mode', mode_auto: 'Automatic, follow the schedule', mode_force_open: 'Always open (manual override)', mode_force_closed: 'Closed now (manual override)', timezone: 'Time zone', closed_msg_ar: 'Closed message (Arabic)', closed_msg_en: 'Closed message (English)', hours: 'Opening hours', hours_help: 'Add more than one period per day if needed. If closing is earlier than opening (for example 18:00 to 02:00) the period runs past midnight. Leave a day empty to keep it closed.',
    open_from: 'From', open_to: 'To', add_interval: 'Period', live_status: 'Status right now', open_now: 'Open', closed_now: 'Closed', next_open: 'Next opening',
    days: { sun: 'Sunday', mon: 'Monday', tue: 'Tuesday', wed: 'Wednesday', thu: 'Thursday', fri: 'Friday', sat: 'Saturday' },
    colors: 'Colors', primary_color: 'Primary color', secondary_color: 'Secondary color', surface_color: 'Card color', page_background: 'Page background', text_on_dark: 'Text on dark', text_on_primary: 'Text on primary', fonts: 'Fonts', font_ar: 'Arabic font', font_en: 'English font',
    logo: 'Logo', logo_help: 'The original logo is built into the site. Upload a transparent black PNG only if you want to replace it.', use_default_logo: 'Use the original logo', hero_image: 'Home background image (optional)',
    store_info: 'Cafe information', name_en_store: 'Cafe name (English)', name_ar_store: 'Cafe name (Arabic)', tagline_ar: 'Tagline (Arabic)', tagline_en: 'Tagline (English)', address_en: 'Address (English)', address_ar: 'Address (Arabic)', phone_store: 'Cafe phone',
    social: 'Social media', instagram: 'Instagram (handle or link)', facebook: 'Facebook', tiktok: 'TikTok',
    home_content: 'Home page texts', hero_title_ar: 'Hero title (Arabic)', hero_title_en: 'Hero title (English)', hero_text_ar: 'Hero text (Arabic)', hero_text_en: 'Hero text (English)', banner_enabled: 'Show an announcement bar', banner_ar: 'Bar text (Arabic)', banner_en: 'Bar text (English)', footer_ar: 'Footer text (Arabic)', footer_en: 'Footer text (English)', currency_ar: 'Currency (Arabic)', currency_en: 'Currency (English)',
    promotions: 'Promotions', promo_title_ar: 'Title (Arabic)', promo_title_en: 'Title (English)', promo_text_ar: 'Text (Arabic)', promo_text_en: 'Text (English)', promo_active: 'Active',
    texts_help: 'Edit any text shown on the site. Leave a field empty to use the default (shown as a hint).',
    wa_number: 'WhatsApp number (with country code or local)', wa_enabled: 'Enable ordering on WhatsApp', wa_template: 'Order message template', wa_template_help: 'Leave empty for the default message. Available variables:', delivery_enabled: 'Enable delivery', pickup_enabled: 'Enable pickup', delivery_fee_lbp: 'Delivery fee (LBP)', min_order_lbp: 'Minimum order (LBP)', note_ar: 'Delivery note (Arabic)', note_en: 'Delivery note (English)', whatsapp: 'WhatsApp', delivery_settings: 'Delivery and pickup',
    change_password: 'Change password', current_password: 'Current password', new_password: 'New password', repeat_password: 'Repeat the password',
    err_wrong_password: 'The current password is wrong', lang_toggle: 'العربية',
  },
};
