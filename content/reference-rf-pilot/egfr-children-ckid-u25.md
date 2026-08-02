---
id: reference.niddk.egfr-children-ckid-u25
title: Расчетная СКФ у детей и молодых взрослых — CKiD U25
short_title: рСКФ детей — CKiD U25
version_label: niddk-ckid-u25-reviewed-2026-08-01
source_type: medical_reference
status: active
specialties:
  - pediatric-nephrology
  - pediatrics
  - nephrology
  - clinical-laboratory-diagnostics
age_groups:
  - children
  - adolescents
  - adults
source_file: https://www.niddk.nih.gov/research-funding/research-programs/kidney-clinical-research-epidemiology/laboratory/glomerular-filtration-rate-equations/children-adolescents-young-adults
synthetic_fixture: false
metadata:
  authorityTier: government-clinical-reference
  publisher: National Institute of Diabetes and Digestive and Kidney Diseases
  jurisdiction: US
  officialSourceUrl: https://www.niddk.nih.gov/research-funding/research-programs/kidney-clinical-research-epidemiology/laboratory/glomerular-filtration-rate-equations/children-adolescents-young-adults
  sourceReviewedAt: "2026-08-01"
  editionVerified: true
  audienceLabel: Для детей, подростков и молодых взрослых
  contentMode: source_linked_paraphrase
  calculationRequired: true
  clinicalContextRequired: true
---

# Область применения CKiD U25

<!-- localmed:source {"officialUrl":"https://www.niddk.nih.gov/research-funding/research-programs/kidney-clinical-research-epidemiology/laboratory/glomerular-filtration-rate-equations/children-adolescents-young-adults","sourceSection":"CKiD U25 Equations","contentMode":"paraphrase"} -->
Формулы CKiD U25 разработаны для детей, подростков и молодых взрослых 1–25 лет с хронической болезнью почек легкой или умеренной степени. Они позволяют отслеживать функцию почек без искусственного скачка результата при переходе через 18-летний возраст и не используют расовый коэффициент. Для скрининга здоровых бессимптомных людей область применимости отдельных вариантов формулы может отличаться.

# Формула по креатинину

<!-- localmed:source {"officialUrl":"https://www.niddk.nih.gov/research-funding/research-programs/kidney-clinical-research-epidemiology/laboratory/glomerular-filtration-rate-equations/children-adolescents-young-adults","sourceSection":"CKiD U25 Creatinine Equation","contentMode":"paraphrase"} -->
Креатининовый вариант:

`eGFR = κ × рост (м) / SCr (мг/дл)`

Результат выражается в мл/мин/1,73 м². Коэффициент κ зависит от пола и возраста:

| Возраст | Девочки и женщины | Мальчики и мужчины |
|---|---:|---:|
| 1 до <12 лет | `36,1 × 1,008^(возраст−12)` | `39,0 × 1,008^(возраст−12)` |
| 12 до <18 лет | `36,1 × 1,023^(возраст−12)` | `39,0 × 1,045^(возраст−12)` |
| 18–25 лет | `41,4` | `50,8` |

Креатинин должен быть указан в мг/дл и предпочтительно измерен ферментативным методом со стандартизацией IDMS. Для перевода из мкмоль/л значение делят на 88,4.

# Вариант по цистатину C

<!-- localmed:source {"officialUrl":"https://www.niddk.nih.gov/research-funding/research-programs/kidney-clinical-research-epidemiology/laboratory/glomerular-filtration-rate-equations/children-adolescents-young-adults","sourceSection":"CKiD U25 Cystatin C Equation","contentMode":"paraphrase"} -->
Цистатиновый вариант имеет форму `eGFR = κ × (1 / cysC)`, где cysC — стандартизованный по IFCC цистатин C в мг/л, а κ выбирают по отдельной возрастно-половой таблице NIDDK. Этот вариант может недооценивать измеренную СКФ при скрининге здоровых детей и молодых взрослых, поэтому его нельзя механически применять вне предусмотренного контекста.

# Если доступны оба маркера

<!-- localmed:source {"officialUrl":"https://www.niddk.nih.gov/research-funding/research-programs/kidney-clinical-research-epidemiology/laboratory/glomerular-filtration-rate-equations/children-adolescents-young-adults","sourceSection":"CKiD U25 Creatinine-cystatin C Equation","contentMode":"paraphrase"} -->
Когда доступны и креатинин, и цистатин C, NIDDK предпочитает среднее двух оценок: `eGFR = (U25 eGFRcr + U25 eGFRcys) / 2`. В исследуемой популяции хронической болезни почек этот вариант точнее и прецизионнее одиночных маркеров.

# Ограничения

рСКФ остается оценкой, а не прямым измерением. Тренд, рассчитанный одной формулой, обычно полезнее единичного значения. Для пациентов 18–25 лет разумно сопоставлять CKiD U25 и взрослую CKD-EPI 2021; выраженное расхождение, острое повреждение почек, нестабильный креатинин или решение с узким порогом требуют дополнительной клинической оценки.
