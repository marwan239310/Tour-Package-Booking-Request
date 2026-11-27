# Booking Request Service - Design

## Entity

| بالعربي | اسم الحقل | النوع | مين بيحدده |
|---|---|---|---|
| رقم الطلب | bookingID | نص | السيرفر |
| اسم العميل | customerName | نص | العميل |
| رقم التليفون | phone | نص | العميل |
| الرحلة | packageID | نص | العميل |
| عدد الأفراد | travelers | رقم | العميل |
| حالة الطلب | status | نص | السيرفر |

## Endpoints

| الوظيفة | Method | Path | بيبعت إيه | رد النجاح | رد الخطأ |
|---|---|---|---|---|---|
| إرسال طلب حجز | POST | /bookings | customerName, phone, packageID, travelers | 201 + الطلب | 400, 404 |
| عرض طلباتي | | | | | |
| إلغاء طلب | | | | | |