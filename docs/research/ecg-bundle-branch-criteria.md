# Числовые критерии блокады ножек пучка Гиса

Дата проверки: 31 августа 2026 г.

Статус: спецификация для взрослого объяснимого rule engine. Это не медицинское заключение и не клиническая валидация.

## Короткий вывод

Для RBBB/LBBB не нужна диагностическая CNN: после получения числовых измерений и морфологических аннотаций достаточно воспроизводимых правил. Но **одной длительности QRS недостаточно**. QRS ≥120 мс означает широкий комплекс; тип блока определяется формой QRS в конкретных отведениях. Если морфология или точность длительности неизвестны, безопасный результат — «широкий QRS, тип нарушения внутрижелудочковой проводимости не определён».

Правило MiniMed должно работать одинаково для признаков, извлечённых из цифрового сигнала, из фотографии и введённых врачом вручную. Фото — только источник измерений с большей погрешностью. До отдельной клинической калибровки результат не должен содержать псевдоточный процент вероятности: показываем гипотезу, сработавшие критерии, отсутствующие данные и обязательность проверки специалистом.

## Первичные источники и их роль

1. [AHA/ACCF/HRS Part III, DOI 10.1016/j.jacc.2008.12.013](https://doi.org/10.1016/j.jacc.2008.12.013), pp. e236–e237 — основные определения complete/incomplete RBBB и LBBB у взрослых.
2. [AHA/ACCF/HRS Part I, DOI 10.1016/j.jacc.2007.01.024](https://doi.org/10.1016/j.jacc.2007.01.024) — representative beat, global intervals, обработка сигнала и обязательный physician overread. Global QRS должен измеряться от самого раннего onset до самого позднего offset по синхронным отведениям.
3. [Glasgow 12-lead ECG Analysis Program Physician's Guide, P/N 04145.02, Version 1.0](https://8331374.fs1.hubspotusercontent-na1.net/hubfs/8331374/Knowledge%20Base/corpuls3/20210525_glasgow_GAN_v1.0_ENG_Druck.pdf), pp. 21–24, 72–73 — первичное описание работающего коммерческого алгоритма и его measurement matrix. Оно подтверждает, что прибор использует не только QRS duration, но и длительности/амплитуды отдельных Q/R/S/R′, пространственную скорость QRS, ось, ST/T и комбинированные правила.
4. [2023 ESC Guidelines for acute coronary syndromes, DOI 10.1093/eurheartj/ehad191](https://doi.org/10.1093/eurheartj/ehad191) — RBBB/LBBB затрудняют оценку ST elevation при подозрении на ишемию; критерий блокады нельзя превращать в заключение об инфаркте.
5. [2021 ESC pacing/CRT guideline, DOI 10.1093/eurheartj/ehab364](https://doi.org/10.1093/eurheartj/ehab364) — пороги 130/150 мс относятся к отбору пациентов для CRT, а не заменяют диагностические определения BBB. В MiniMed их нельзя использовать как классификатор LBBB.

При расхождении алгоритмов базовой спецификацией здесь остаётся AHA/ACCF/HRS Part III. Glasgow полезен как доказательство состава признаков и как будущий black-box benchmark, но его proprietary decision tree не следует копировать.

## Точные критерии AHA/ACCF/HRS для взрослых

### Complete RBBB

AHA явно требует первые три пункта:

1. Global QRS duration ≥120 мс.
2. `rsr′`, `rsR′` или `rSR′` в V1 либо V2; терминальный `R′/r′` обычно шире начального R. У меньшинства встречается широкий, часто зазубренный доминирующий R в V1/V2.
3. В I **и** V6 длительность S больше длительности R либо S >40 мс.
4. Поддерживающий признак: нормальный R-peak time в V5/V6 и >50 мс в V1. Если в V1 вместо `rSR′` имеется чистый доминирующий R с зазубриной или без неё, пункт 4 становится обязательным.

ST/T-дискордантность может поддерживать паттерн, но не заменяет пункты 1–3. Ось QRS не является обязательным условием RBBB.

### Incomplete RBBB

- 110 мс ≤ global QRS duration <120 мс;
- остальные морфологические критерии те же, что для complete RBBB.

Следовательно, `QRS=114 ms` без V1/V2 и I/V6 — не IRBBB. Высокое или смещённое вправо V1 способно создать ложный `r′`; качество наложения/позиции электродов должно быть отдельным предупреждением.

### Complete LBBB

AHA перечисляет следующий core pattern:

1. Global QRS duration ≥120 мс.
2. Широкий зазубренный или сглаженно-расширенный R в I, aVL, V5 и V6; в V5/V6 допустим редкий RS из-за смещённой переходной зоны.
3. Нет начального q в I, V5 и V6. Узкий q в aVL допустим при отсутствии другой патологии.
4. R-peak time >60 мс в V5 и V6, но нормальный в V1–V3, если там различим малый начальный r.

В отличие от раздела RBBB, документ не задаёт формулу `N из M` для пунктов LBBB. Поэтому безопасная независимая реализация требует duration и все доступные core morphology checks; если нужное отведение не читается, результат должен быть `insufficient-data`, а не положительным.

Вторичные признаки: ST и T обычно направлены противоположно QRS; положительная T при положительном QRS может быть нормальной, а ST depression/negative T при отрицательном QRS считается нетипичной и требует отдельной оценки. Ось при LBBB может быть левой, правой или верхней и не является обязательным условием.

### Incomplete LBBB

AHA задаёт не просто «тот же LBBB с более коротким QRS», а отдельный набор:

1. 110 мс ≤ global QRS duration <120 мс;
2. имеется паттерн LVH;
3. R-peak time >60 мс в V4, V5 и V6;
4. нет q в I, V5 и V6.

Без подтверждённого LVH-pattern правило не должно выдавать ILBBB. Этот термин менее устойчив между алгоритмами: например, Glasgow использует иной многопризнаковый диапазон 100–130 мс. В UI нужен особенно осторожный текст «измерения совместимы с неполной LBBB по критериям AHA; требуется проверка».

## Что показывает алгоритм Glasgow

Взрослые пределы Glasgow получаются из `LIM1=32 ms`, `LIM2=35 ms`, `LIM3=45 ms`, но реальные дискретные пороги в программе заменены непрерывными функциями для повторяемости. Для LBBB алгоритм комбинирует QRS duration в нескольких отведениях, длительности R/R′/Q/S, амплитуды, отношение R/S и пространственную скорость частей QRS. Для RBBB он дополнительно проверяет терминальную S в I/V5/V6, R/R′ в V1/V2, T в V1, ось, RVH и WPW. Incomplete RBBB требует измеряемого R′ и исключения Brugada-pattern.

Практический вывод для MiniMed: высоты зубцов сами по себе недостаточны. Нужны onset/offset и типы отдельных волн, длительности терминальных компонентов, notch/slur, lead identity и условия-исключения. Переносить сложную формулу Glasgow сейчас не нужно: сначала следует валидировать прозрачные AHA-правила.

## Что нельзя вывести из одного QRS duration

- правую или левую локализацию блока;
- complete BBB против неспецифической задержки внутрижелудочковой проводимости;
- BBB против ventricular pacing, ventricular beat/rhythm или pre-excitation;
- стабильность паттерна между доминирующими комплексами;
- корректность V1/V2 и отсутствие перестановки отведений;
- сопутствующий fascicular block, ишемию, инфаркт, гипертрофию или причину блока;
- «новый» или «старый» блок без предыдущей ЭКГ;
- клиническую значимость без симптомов, анамнеза и других исследований.

Если QRS >110 мс, но RBBB/LBBB morphology не выполнена, AHA допускает формулировку nonspecific/unspecified intraventricular conduction disturbance. Для продукта безопаснее сначала показывать буквальный факт `wide-qrs-type-undetermined`, пока это правило отдельно не валидировано.

## Ограничения фото и короткой записи

- Нужны известные скорость и gain. При 50 мм/с один миллиметр равен 20 мс; при стандартном 10 мм/мВ один миллиметр равен 0,1 мВ. Граница 110↔120 мс занимает только 0,5 мм бумаги, поэтому перспектива, толщина линии и ручной маркер легко меняют complete на incomplete.
- Измеритель обязан возвращать `uncertaintyMs`. Если интервал `value ± uncertainty` пересекает 120 мс, complete/incomplete не различаются; результат `bbb-completeness-indeterminate`.
- На бумажном 3×4 layout отведения разных колонок записаны в разные моменты. Из такого фото нельзя честно получить AHA global QRS по синхронным 12 leads; это нужно хранить как `sequential-paper-estimate` и понижать уверенность.
- Один чистый representative beat может позволить врачу отметить морфологию, но автоматический вывод должен проверить повторяемость на нескольких доминирующих комплексах. Минимум три комплекса — продуктовый safety gate MiniMed, а не опубликованный порог AHA.
- Короткий фрагмент особенно слаб для определения ритма, редкой эктопии и rate-dependent BBB. Он не мешает измерить один QRS, но не доказывает, что этот QRS репрезентативен.
- Перекрытие линий, обрезанный onset/offset, неизвестная сетка, paced spike, шум либо нечитаемое ключевое отведение должны давать `insufficient-data`, а не отрицательный результат.

## Безопасные формулировки результата

| Internal code | Текст пользователю |
|---|---|
| `compatible-with-crbbb` | «Измерения и морфология совместимы с полной блокадой правой ножки пучка Гиса. Это автоматическая гипотеза; требуется проверка врачом.» |
| `compatible-with-irbbb` | «Измерения совместимы с неполной блокадой правой ножки; возможен вариант нормы или влияние положения V1/V2. Требуется проверка.» |
| `compatible-with-clbbb` | «Измерения и морфология совместимы с полной блокадой левой ножки. Требуется проверка врачом; оценка ишемии по фото ограничена.» |
| `compatible-with-ilbbb` | «Измерения совместимы с неполной блокадой левой ножки по критериям AHA. Требуется подтверждение.» |
| `wide-qrs-type-undetermined` | «QRS расширен, но данных недостаточно для определения типа нарушения проводимости.» |
| `bbb-completeness-indeterminate` | «Морфология блокады присутствует, но точности измерения недостаточно, чтобы различить полную и неполную форму.» |
| `insufficient-data` | «Ключевые отведения или разметка недостаточно надёжны для гипотезы.» |

`confidence` здесь означает только полноту/качество evidence (`low | medium | high`), а не клиническую вероятность. Процент допустим лишь после внешней patient-level калибровки на независимой выборке.

## Typed input contract

```ts
type EcgLead =
  | 'I' | 'II' | 'III' | 'aVR' | 'aVL' | 'aVF'
  | 'V1' | 'V2' | 'V3' | 'V4' | 'V5' | 'V6';

type Provenance = 'digital-signal' | 'photo-auto' | 'manual';
type Quality = 'good' | 'review' | 'unusable';

type MeasuredNumber = {
  value: number;
  uncertainty?: number; // same unit as value; required for photo-auto
  source: Provenance;
  reviewed: boolean;
};

type LeadQrsFeatures = {
  quality: Quality;
  representativeBeatCount: number;
  consistentBeatFraction?: number;
  qrsDurationMs?: MeasuredNumber;
  pattern?: {
    value: 'rsr-prime' | 'rsR-prime' | 'rSR-prime' | 'dominant-R' |
      'broad-R' | 'RS' | 'rS' | 'QS' | 'other';
    source: Provenance;
    reviewed: boolean;
  };
  qPresent?: boolean;
  rDurationMs?: MeasuredNumber;
  rPrimeDurationMs?: MeasuredNumber;
  sDurationMs?: MeasuredNumber;
  rPeakTimeMs?: MeasuredNumber;
  rAmplitudeMv?: MeasuredNumber;
  rPrimeAmplitudeMv?: MeasuredNumber;
  sAmplitudeMv?: MeasuredNumber; // signed or paired with an explicit polarity convention
  rNotchedOrSlurred?: boolean;
};

type BundleBranchInput = {
  schemaVersion: 1;
  ageYears: number;
  sex?: 'female' | 'male' | 'unknown';
  acquisition: {
    durationSec: number;
    speedMmPerSec: 50; // current MiniMed scope
    gainMmPerMv: 10;
    timing: 'simultaneous-digital' | 'sequential-paper-estimate';
    leadOrderVerified: boolean;
  };
  globalQrsDurationMs?: MeasuredNumber;
  leads: Partial<Record<EcgLead, LeadQrsFeatures>>;
  context: {
    dominantBeatOrigin: 'supraventricular' | 'ventricular' | 'unknown';
    ventricularPacing: boolean | 'unknown';
    preExcitation: boolean | 'unknown';
    lvHypertrophyPattern: boolean | 'unknown';
    v1V2PlacementVerified: boolean | 'unknown';
  };
};

type BundleBranchResult = {
  code:
    | 'compatible-with-crbbb' | 'compatible-with-irbbb'
    | 'compatible-with-clbbb' | 'compatible-with-ilbbb'
    | 'wide-qrs-type-undetermined'
    | 'bbb-completeness-indeterminate'
    | 'no-bbb-pattern' | 'insufficient-data';
  confidence: 'low' | 'medium' | 'high';
  evidence: Array<{ criterionId: string; observed: string; source: Provenance }>;
  missing: string[];
  warnings: string[];
  reviewRequired: true;
};
```

Trust-boundary checks: reject non-finite/negative durations, impossible calibration, unknown lead names and morphology asserted on `unusable` data. Adult rules run only for `ageYears >= 18` in the first release. `photo-auto` duration without uncertainty is invalid. `ventricularPacing=true`, `dominantBeatOrigin='ventricular'` or `preExcitation=true` blocks BBB classification and returns `insufficient-data` with a specific warning.

## Шесть синтетических test cases

Все неупомянутые key leads имеют `quality=good`, три одинаковых representative beats, verified lead order, supraventricular origin, no pacing/pre-excitation и QRS uncertainty 2 мс.

| # | Вход | Ожидаемый code | Проверяемая граница |
|---|---|---|---|
| 1 | QRS 128 мс; V1=`rSR-prime`, R′ шире R, R-peak 58 мс; S в I=48 мс и V6=46 мс, каждая длиннее R | `compatible-with-crbbb` | Все явные обязательные AHA RBBB criteria |
| 2 | QRS 114 мс; V2=`rsR-prime`; S в I=44 мс и V6=45 мс | `compatible-with-irbbb` | Та же morphology, но 110–119 мс |
| 3 | QRS 136 мс; broad/notched R в I/aVL/V5/V6; q отсутствует в I/V5/V6; R-peak V5=67 и V6=69 мс | `compatible-with-clbbb` | Complete LBBB core pattern |
| 4 | QRS 114 мс; `lvHypertrophyPattern=true`; R-peak V4/V5/V6=64/66/68 мс; q отсутствует в I/V5/V6 | `compatible-with-ilbbb` | Отдельные AHA incomplete LBBB criteria |
| 5 | QRS 132 мс; V1=`other`; S I=28 мс, S V6=30 мс; нет broad R/absent-q LBBB pattern | `wide-qrs-type-undetermined` | Широкий QRS не равен BBB |
| 6 | Photo-auto QRS 118±8 мс; полная RBBB morphology присутствует | `bbb-completeness-indeterminate` | Интервал 110–126 мс пересекает 120 мс |

Каждый test также проверяет `reviewRequired=true`, непустой `evidence`, отсутствие числовой «вероятности» и provenance каждого измерения. Отдельный trivial guard: QRS <110 мс никогда не даёт BBB code, даже при одиночном `rSr′` в V1.

## Открытые цифровые fixtures

### LUDB 1.0.0 — основной morphology benchmark

[Lobachevsky University Electrocardiography Database 1.0.0](https://physionet.org/content/ludb/1.0.0/) содержит 200 десятисекундных 12-lead ECG, 500 Hz; границы P/QRS/T вручную размечены кардиологами отдельно в каждом отведении. Лицензия файлов — [ODC Attribution 1.0](https://physionet.org/content/ludb/1.0.0/LICENSE.txt). Диагнозы находятся непосредственно в versioned `.hea` files.

- complete RBBB: `10`, `23`, `108`, `116`;
- complete LBBB: `24`, `44`, `51`, `83`;
- incomplete RBBB: `4`, `22`, `25`, `31`, `32`, `36`, `41`, `43`, `48`, `60`, `66`, `70`, `72`, `77`, `78`, `81`, `82`, `85`, `97`, `99`, `102`, `107`, `117`, `125`, `126`, `141`, `156`, `176`, `185`;
- incomplete LBBB: `13`, `19`, `54`, `112`, `120`, `122`.

Пример immutable metadata: [LUDB record 10 header](https://physionet.org/files/ludb/1.0.0/10.hea). LUDB особенно ценен для проверки onset/offset и ручного редактора, но его labels нельзя считать независимым доказательством клинической точности самих AHA-правил.

### PTB-XL 1.0.3 — широкий внешний benchmark

[PTB-XL 1.0.3](https://physionet.org/content/ptb-xl/1.0.3/) содержит 21 799 12-lead ECG по 10 секунд, 500 и 100 Hz, с human-reviewed SCP-ECG statements; лицензия [CC BY 4.0](https://physionet.org/content/ptb-xl/1.0.3/LICENSE.txt). Для первого benchmark брать только patient-disjoint `strat_fold=10`, `validated_by_human=true` и проверять `scp_codes` в исходном [ptbxl_database.csv](https://physionet.org/files/ptb-xl/1.0.3/ptbxl_database.csv).

Проверенные примеры fold 10 с likelihood 100:

- CRBBB: ECG IDs `172`, `512`, `1093`, `1157`;
- IRBBB: `65`, `478`, `569`, `726`;
- CLBBB: `180`, `598`, `618`, `1056`;
- NORM controls: `9`, `38`, `57`, `59`.

Labels `CRBBB`, `IRBBB`, `CLBBB` следует сохранять буквально. Обобщённые `RBBB/LBBB` или класс `CD` нельзя автоматически переименовывать в complete block.

### Фиксированный набор из 15 записей для следующего шага

Для smoke benchmark rule engine и будущего photo-render pipeline: LUDB `10, 23, 108, 116` (CRBBB), `24, 44, 51, 83` (CLBBB), `4, 22, 25` (IRBBB), `13, 19` (ILBBB) плюс PTB-XL `9, 38` (NORM). Это 13 положительных и 2 отрицательных записи; все исходные IDs и лицензии сохраняются в manifest.

Цифровой benchmark нужно запускать первым. Затем те же waveforms можно воспроизводимо отрендерить на сетке 50 мм/с, 10 мм/мВ и создать производные изображения с перспективой/экспозицией/blur, сохранив attribution и transform manifest. Такой synthetic photo test проверяет digitizer, но не заменяет отдельный набор реальных телефонных фотографий распечаток.

## Дополнительный поиск числовых алгоритмов

### PTB-XL+ и feature-based Random Forest — лучший путь к широкому числовому классификатору

[PTB-XL+ 1.0.1](https://physionet.org/content/ptb-xl-plus/1.0.1/) публикует таблицы признаков 12SL, Uni-G и открытого ECGDeli: интервалы, амплитуды, площади, оси, morphology и fiducial points. Там же доступны машинные statements 12SL и их SNOMED mapping. Официальный [feature benchmark](https://github.com/tmehari/ptbxl_feature_benchmark) обучает Random Forest непосредственно на этих таблицах. В исходной [технической валидации PTB-XL+](https://pmc.ncbi.nlm.nih.gov/articles/PMC10183020/) mean macro AUC полных feature sets составил 0,889 для Uni-G, 0,871 для 12SL и 0,879 для ECGDeli.

Это наиболее сильное подтверждение идеи «сначала получить цифры, потом классифицировать»: shallow model на качественных признаках способен покрыть гораздо больше классов, чем несколько вручную написанных порогов. Но готовый RF нельзя честно перенести в MiniMed сейчас: commercial feature extractors закрыты, ECGDeli требует MATLAB, а браузерный digitizer пока не выдаёт совместимые 529 признаков. Следующий эксперимент должен сначала воспроизвести общий поднабор признаков и только затем обучать/экспортировать небольшой классификатор; отсутствие входного признака нельзя маскировать медианой в клиническом UI.

### OpenECG — кандидат для измерений, не готовый широкий диагнозатор

[vitaldb/openecg](https://github.com/vitaldb/openecg) — Apache-2.0 alpha-проект с локальными QRS/rhythm rules и компактными ONNX/TFLite моделями для P/QRS/T delineation, beat type и ритма. Он может вернуть R-peaks, HR, PR/QRS/QT и rule-based AFib check, но основной codec остаётся обученной моделью и работает по одному отведению; заявленные метрики пока принадлежат самому репозиторию. Поэтому его стоит benchmark-ить как альтернативный измеритель на LUDB/QTDB, а не принимать как источник 12-lead диагноза или замену ручной морфологии.

[Construe](https://github.com/citiususc/construe) остаётся интересным открытым абдуктивным rule engine для коротких single-lead ритмов и AF, но его scope не покрывает 12-lead BBB/ischemia, а AGPL-3.0 делает прямое встраивание отдельным лицензионным решением. BRAVEHEART, WFDB/ecgpuwave, NeuroKit2 и ECGDeli также являются прежде всего измерителями/delineators, а не широкими диагностическими engines.

## Локальный 15-case numeric smoke benchmark

31 августа 2026 г. правила были отдельно проверены на опубликованных `12sl_features.csv` из PTB-XL+ и human-validated `strat_fold=10` labels PTB-XL. Взяты по пять записей с likelihood 100: CRBBB `172, 512, 1093, 1157, 1424`; CLBBB `180, 598, 618, 1056, 1564`; NORM `9, 38, 57, 59, 75`.

| Группа | Наблюдение |
|---|---|
| CRBBB, 5 записей | Global QRS был ≥120 мс во всех 5. Строгое сочетание опубликованных `R′ duration V1/V2` и terminal-S duration в I/V6 выполнилось только в 2/5. В остальных строках 12SL не выделил R′ либо не дал требуемую terminal S в обоих латеральных отведениях. |
| CLBBB, 5 записей | QRS был ≥120 мс во всех 5 и q отсутствовал в I/V5/V6 во всех 5, но R-peak time >60 мс одновременно в V5/V6 выполнился в 2/5. Обязательный broad/notched/slurred-R flag в опубликованной 12SL feature table отсутствует, поэтому полное AHA-правило нельзя было оценить ни в одной записи. |
| NORM, 5 записей | Ни одна запись не выполнила complete-RBBB/LBBB rule; один control имел QRS 114 мс и корректно остался ниже complete threshold. |

Это малый interoperability smoke test, а не sensitivity/specificity study. Он показывает, что одинаково названные морфологические признаки разных delineators не взаимозаменяемы: нельзя превращать пропущенный R′/S/notch в «признака нет» и нельзя обучить downstream-классификатор на 12SL features, а затем подать ему приблизительные признаки другого extractor. Поэтому текущий UI оставляет морфологию ручным трёхсостоянием; автоматизация требует extractor parity benchmark на общей разметке.

## Решение для MiniMed

Первый загружаемый ECG rules pack должен содержать независимые AHA-правила и metadata источников, но не веса CNN и не код Glasgow. Вход пакета — типизированные measurements/annotations выше; image digitizer и ручной редактор лишь заполняют этот контракт. Release gate: шесть synthetic tests, 15 фиксированных цифровых fixtures, затем те же 15 render/photo variants; отдельно сообщаются ошибки digitizer и ошибки rule engine.
