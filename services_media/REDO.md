# تصاویری که باید بازسازی شوند

برش شبکه‌ای روی این‌ها شیء را از لبه بریده است. باید دوباره تولید شوند.

| # | slug |
|---|------|
| 89 | housing-purchase-loan |
| 90 | rent-deposit-loan |
| 92 | amlak-eskan-registration |
| 93 | rent-contract-tracking-code |
| 86 | national-housing-registration |
| 87 | youth-population-housing |
| 74 | kardani-to-karshenasi |
| 77 | phd-exam-registration |
| 80 | engineering-council-exam |
| 21 | subsidy-adult-separation |
| 28 | subsidy-establishment-request |

## علت
پس از برش ۳×۲، شش خانه دقیقاً هم‌اندازه نیستند و مدل شیء را کمی جابه‌جا
می‌کشد. اگر در شیء به لبهٔ خانه برسد، مربع برش لبه‌اش را می‌برد.

## راه‌حل برای دسته‌های بعد
در پرامپت **هر خانه حاشیهٔ خالی زیاد داشته باشد** و شیء کوچک‌تر از خانه باشد:
> Each object must be comfortably smaller than its cell, with a wide empty
> margin of background on all four sides — at least 15% of the cell width.

و در گزینهٔ دوم، آیکون‌ها را **تک‌تک** (بدون شبکه) بساز — کندتر است ولی
برشی در کار نیست و لبه هیچ‌وقت بریده نمی‌شود.
