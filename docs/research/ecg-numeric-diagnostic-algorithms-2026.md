# Открытые алгоритмы интерпретации ЭКГ по числовым данным (2026)

## Вывод

Для приложения не найден готовый permissive rule-engine уровня «12 отведений → широкий диагноз», который можно безопасно встроить в TypeScript. Зато найден практически проверяемый путь без diagnostic CNN: прозрачные клинические правила плюс небольшой табличный классификатор по подтверждённым ECG features. Внешний код нужен как измеритель и эталон для тестов. Полный диагноз следует называть предположением/поддержкой решения, а не медицинским заключением.

## Кандидаты

| Проект | Вход и вывод | Лицензия/зрелость | Решение |
|---|---|---|---|
| **PTB-XL+ feature benchmark** | Таблица длительностей, амплитуд, осей и морфологии; официальный код обучает Random Forest на диагнозах PTB-XL. На полных feature sets авторы получили mean macro-AUC 0,889 для Uni-G, 0,871 для 12SL и 0,879 для открытого ECGDeli. | Данные PTB-XL+ — CC BY 4.0; benchmark-код — MIT, commit [`e79c58e`](https://github.com/tmehari/ptbxl_feature_benchmark/tree/e79c58e4fe962bb0e67be8ef878aa629a3177e56). Готовых весов нет. [Статья и результаты](https://www.nature.com/articles/s41597-023-02153-8#Sec13) · [код RF](https://github.com/tmehari/ptbxl_feature_benchmark/blob/e79c58e4fe962bb0e67be8ef878aa629a3177e56/code/run_feature_benchmark.py) · [LICENSE](https://github.com/tmehari/ptbxl_feature_benchmark/blob/e79c58e4fe962bb0e67be8ef878aa629a3177e56/LICENSE.txt) | Лучший кандидат для **вероятностного слоя только по цифрам**. Нельзя переносить опубликованный AUC на наш короткий набор полей: надо переобучить RF/логистическую регрессию только на признаках, которые MiniMed действительно умеет подтвердить. |
| **MEANS Physicians' Manual** | Публичный 63-страничный manual закрытой системы содержит словарь lead-independent/lead-dependent измерений, формальные `if/and/or` критерии, приоритеты и suppression rules для проводимости, гипертрофии, инфаркта, ST-T и ритма. | Сам движок закрыт; manual опубликован производителем и описывает проверку на CSE, но не даёт лицензию на исходный код или свободное воспроизведение всей базы правил. [Manual](https://www.hillrom.com/content/dam/hillrom-aem/us/en/sap-documents/LIT/80011/80011564LITPDF.pdf) | Лучший найденный документ о том, **как устроен аппаратный интерпретатор** и какие числа ему нужны. Использовать как источник требований и comparator; клинические правила реализовывать независимо по действующим стандартам, не копировать базу MEANS целиком. |
| **Minnesota Code / NOVACODE** | Формальные числовые коды Q/QS, оси, высоких зубцов, ST-T, AV- и внутрижелудочковой проводимости, аритмий; NOVACODE добавляет MI/LVH и serial-change классификацию. | Публичные документы CDC/NIH содержат определения, логические операторы, пороги и часть уравнений, но это не репозиторий с современной лицензией на исходный код. Система создана прежде всего для эпидемиологических исследований. [CDC NOVACODE section](https://wwwn.cdc.gov/nchs/data/hhanes/6540.pdf#page=70) · [CARDIA Minnesota criteria](https://www.ncbi.nlm.nih.gov/projects/gap/cgi-bin/document.cgi?phd=3282&study_id=phs000309.v3.p2) | Лучший открытый источник формализованных правил, но не готовый клинический диагнозатор. Переносить только независимо проверенные критерии с явным названием кода и provenance. |
| **Construe** | WFDB/оцифрованный сигнал; knowledge-based abductive interpretation от P/QRS/T до AF, bigeminy, trigeminy, VF/flutter и других ритмов. Исходники и knowledge base включены. | AGPL-3.0 в репозитории; Python, исследовательский проект, не TypeScript. Использует QTDB-аннотации и MIT-BIH beat-классификацию в примерах. [README](https://github.com/citiususc/construe/blob/8370cd52e8da1873790cb2c522d89d1d2dbfb00a/README.md) · [LICENSE](https://github.com/citiususc/construe/blob/8370cd52e8da1873790cb2c522d89d1d2dbfb00a/LICENSE) | Лучший настоящий открытый интерпретатор, но AGPL и Python делают его кандидатом для отдельного исследовательского адаптера, не для встроенного пакета. |
| **ECG-kit** | WFDB/сигнал; задачи QRS/P/T detection, delineation, beat classification и HRV. Это инфраструктура измерений, а не клинический диагноз. | GPL-2.0; Matlab, крупный зрелый toolbox, но тяжёл для локального web/TS. [репозиторий](https://github.com/marianux/ecg-kit/tree/c8e3de47c54a9214138143676d2aa546b0540dd2) · [LICENSE](https://github.com/marianux/ecg-kit/blob/c8e3de47c54a9214138143676d2aa546b0540dd2/LICENSE.txt) | Использовать только как офлайн-эталон измерений при разработке, не копировать в приложение без GPL-решения. |
| **BioSigKit** | Matlab-массив + частота дискретизации; Pan–Tompkins и ещё несколько QRS-детекторов, выдающих индексы P/Q/R/S/T. Диагнозов нет. | MIT; небольшой учебно-исследовательский toolbox, есть два sample ECG. [README](https://github.com/hooman650/BioSigKit/blob/6a6c18ff1f0dcdc79a5cf7be8b6df707eaef3a6e/README.md) · [LICENSE](https://github.com/hooman650/BioSigKit/blob/6a6c18ff1f0dcdc79a5cf7be8b6df707eaef3a6e/LICENSE) | Можно воспроизвести алгоритмы в TS, но готового диагностического слоя нет; ценность — контрольный QRS detector. |
| **OSET** | Matlab/C++/Python функции фильтрации, QRS, delineation, HRV и моделирования; не единый диагностический engine. | BSD-3-Clause; активный toolbox, но главным образом Matlab. [README](https://github.com/alphanumericslab/OSET/blob/3af05382c4cd0a99082dcb120e621f0c99d4f60e/README.md) · [LICENSE](https://github.com/alphanumericslab/OSET/blob/3af05382c4cd0a99082dcb120e621f0c99d4f60e/LICENSE) | Подходит как источник permissive измерительных алгоритмов/идей, не как готовый диагноз. |
| **OpenECG** | Числовой одноканальный сигнал; ONNX codec и NumPy rules дают HR и ограниченную проверку AF. Это не 12-отведённый broad diagnostic engine. | Apache-2.0; локальный Python/ONNX, commit [`60ac888`](https://github.com/vitaldb/openecg/tree/60ac8887ab0d640fbab6ef094d023b72a9f630c5). [LICENSE](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/LICENSE) | Уже проверенный проект полезен для измерительного smoke-test, но не заменяет правила по интервалам, осям и амплитудам. |
| **PTE-ECG** | Цифровая 12-отведённая запись; NeuroKit2-based delineation и 1930 морфологических/частотных признаков. Диагнозов не выдаёт. | MIT, `1.0.0-alpha.1`, commit [`8cedf60`](https://github.com/Sandrock-Partner/pte-ecg/tree/8cedf6020e8d657b20fa0e9e1dc329d9f88e8cae); pre-alpha, собственная клиническая валидация ещё запланирована. | **Отклонён после 15-case benchmark:** QRS/PR систематически занижены, ни один широкий QRS не обнаружен. |
| **ecg-interpreter 0.1.0** | Новый MIT Python-пакет обещает rate/rhythm/blocks/ischemia из одного отведения. Реально использует фиксированные окна P/Q/S/T и простые прокси: например, полный AV block по низкой ЧСС и широкому QRS, AF по RR-CV, STEMI по среднему ST одного отведения. | Первый релиз от 27 мая 2026, один maintainer, 19,7 КБ исходников, тесты только на собственном синтетическом генераторе; 12-lead заявлен лишь в roadmap. [PyPI и ограничения](https://pypi.org/project/ecg-interpreter/) | **Отклонён.** Лицензия удобная, но критерии слишком грубые и местами клинически небезопасные; это не альтернатива MEANS/AHA или проверенному feature benchmark. |

### Исторические PhysioNet/PhysioToolkit алгоритмы

PhysioNet публикует `wqrs`, `sqrs`, `ecgpuwave`, `gqrs`, `bxb`, `ann2rr` и родственные WFDB utilities. Они решают обнаружение QRS, fiducial points, beat annotations и сравнение аннотаций; это не лицензированный комплекс диагнозов. Данные и исходники полезны для regression benchmark, но диагнозы нужно строить отдельно. Каталог и документация: [WFDB Software](https://physionet.org/content/wfdb/).

### OSET/ECG-kit/BioSigKit: важное различие

Наличие P/Q/R/S/T индексов или HRV не означает наличие диагностических правил. Ни один из трёх toolbox’ов не выдаёт проверяемый набор диагнозов вроде STEMI/LBBB/AF из одной стандартной структуры numeric features. Construe — исключение: у него есть knowledge base и композиция гипотез, но цена — AGPL и перенос Python-архитектуры. Его правила нельзя «переписать без AGPL»; независимую реализацию следует строить по клиническим стандартам и публичным критериям, а Construe использовать только в совместимом исследовательском контуре или как внешний comparator.

## Локальная проверка PTE-ECG на 15 записях

Новый MIT-кандидат PTE-ECG `1.0.0-alpha.1` был зафиксирован на commit
[`8cedf602`](https://github.com/Sandrock-Partner/pte-ecg/tree/8cedf6020e8d657b20fa0e9e1dc329d9f88e8cae)
и запущен локально на тех же 15 PTB-XL записях: по пять `CRBBB`, `CLBBB` и `NORM`.
Входом были исходные 12 отведений по 10 секунд при 500 Гц; сравнение выполнялось с
опубликованными глобальными измерениями Uni-G из PTB-XL+ 1.0.1. Для per-lead результатов PTE
бралось медианное значение по 12 отведениям.

| Признак | Coverage | MAE | Попало в допуск | Наблюдение |
|---|---:|---:|---:|---|
| QRS | 15/15 | 52,8 мс | 1/15 в ±20 мс | PTE не выдал ни одного QRS ≥120 мс; согласие wide-QRS с Uni-G только 6/15 |
| PR | 15/15 | 48,6 мс | 2/15 в ±20 мс | систематическое смещение −48,3 мс |
| QT | 15/15 | 28,8 мс | 12/15 в ±30 мс | один большой промах −161,9 мс |
| RR | 15/15 | 16,4 мс | 14/15 в ±50 мс | обычно точен, но один промах −194,7 мс |
| Ось QRS | 15/15 | 26,6° | 10/15 в ±30° | используется только `atan2(R aVF, R I)` |

Причина расхождения следует из самого кода: `qrs_duration` считается от пика Q до пика S, а не
между глобальными onset/offset QRS; `qt_interval` начинается с пика Q; ось строится только по
амплитудам R в I и aVF вместо суммарного QRS/площади. Эти величины нельзя считать взаимозаменяемыми
с аппаратными PR/QRS/QT и подавать в существующие правила или HGB-pack.

**Решение:** не интегрировать PTE-ECG и не создавать для него загружаемый пакет. Его RR-оценка не
даёт нового преимущества перед уже встроенным digitizer, а исправление определений интервалов
означало бы создание и отдельную валидацию собственного delineator.

## Почему PTB-XL+ меняет практический выбор

PTB-XL+ содержит 21 799 записей, feature tables от Uni-G, 12SL и ECGDeli и диагностические метки врача/12SL. Авторы уже показали, что обычный Random Forest по числовым признакам достаточно силён для широкого multi-label benchmark; для rhythm-задачи ECGDeli features даже превысили указанный в статье raw-waveform CNN baseline. Это не доказывает клиническую безопасность, но отвечает на главный технический вопрос: диагнозоподобные вероятности из цифр без CNN получить можно.

Для MiniMed нужен более строгий опыт: взять только общий поднабор признаков, который можно одинаково получить автоматически или вручную. Актуальный [`feature_description.csv`](https://physionet.org/files/ptb-xl-plus/1.0.1/features/feature_description.csv) содержит полностью сопоставленные строки для P/Q/R/S/T amplitudes, lead/global durations, PR, QT, QRS, mean RR, P morphology и Framingham QTc. В тексте статьи указано 13 общих feature families, а CSV v1.0.1 даёт 15 непустых трёхсторонних mappings; benchmark должен зафиксировать конкретный список колонок и не полагаться на число из prose.

Преимущество простого RF или логистической регрессии здесь не в «магии AI», а в компактном локальном inference: после обучения модель можно представить небольшим версионированным numeric pack. Каждое предсказание всё равно должно сопровождаться исходными измерениями, quality gate и независимыми правилами с порогами.

## Локальный benchmark на точном numeric contract

Воспроизведён официальный split PTB-XL: folds 1–8 train, 9 validation, 10 test; классы `NORM`, `MI`, `STTC`, `CD`, `HYP`. Первая версия на ECGDeli была отклонена после проверки единиц: на одних и тех же записях медианы P/PR/QRS/QT у ECGDeli составили 198/272/160/504 мс, тогда как два независимых аппаратных алгоритма практически совпали — 12SL 114/162/94/394 и Uni-G 112/160/96/396 мс. Поэтому модель для ручного/аппаратного ввода обучена на стандартных Uni-G features, а ECGDeli оставлен только измерительным исследовательским источником. Возраст и пол не подавались в модель; строки младше 18 лет исключены, на test осталось 2 185 записей. Порог каждой независимой гипотезы и Platt-калибровка выбирались только на validation fold.

| Вход | Модель | Test macro-AUC | macro-F1 | Brier | Вывод |
|---|---:|---:|---:|---:|---|
| 12 признаков | 5 × Histogram Gradient Boosting | 0,859 | 0,653 | 0,111 | Слишком большая потеря качества. |
| 18 признаков | 5 × Histogram Gradient Boosting | 0,894 | 0,692 | 0,098 | Компактно, но заметно слабее полного кандидата. |
| 24 признака | 5 × Histogram Gradient Boosting | 0,900 | 0,703 | 0,095 | Приемлемо, но последние 6 амплитуд дают измеримый прирост. |
| 30 признаков, взрослые 18+ | 5 × Histogram Gradient Boosting, 200 деревьев × 15 листьев | **0,913** | **0,720** | **0,090** | Выбранный Uni-G кандидат; ZIP 261 070 байт. |
| Uni-G train → независимые 12SL test measurements | та же 30-полевая модель без переобучения | **0,908** | **0,719** | **0,092** | Небольшое падение подтверждает переносимость стандартных мс/мВ между измерителями. |

Для Uni-G HGB проверены контракты 12/18/24/30 полей. Переход 24→30 дал +0,013 macro-AUC и около +0,016 F1, поэтому 30 — текущий баланс точности и редактируемости. При abstention-зоне ±0,10 взрослый 30-полевый кандидат выдаёт отдельную гипотезу в 93,6% class-record пар; macro-F1 среди выданных гипотез 0,755. Обратная проверка 12SL train → Uni-G test дала macro-AUC 0,910/F1 0,717. Это исследовательские selective/cross-source metrics, не клиническая чувствительность/специфичность на независимой популяции.

Релизный `hgb-model.json` затем прогнан тем же чистым TypeScript-inference, который вызывает
приложение, без Python-модели и без переобучения. После runtime-ограничения возраста 18–120 лет и
отказа от строк с пропусками/выходом за допустимый диапазон в независимом fold 10 осталось 2130 из
2151 записей. Test fold не использовался для выбора порогов.

| Класс | AUC | F1 по порогу | Sensitivity | Specificity | Coverage после abstention | F1 среди ответов | Уверенные FN / все positive |
|---|---:|---:|---:|---:|---:|---:|---:|
| NORM | 0,936 | 0,852 | 0,889 | 0,838 | 94,0% | 0,876 | 76/956 (7,9%) |
| MI | 0,926 | 0,737 | 0,751 | 0,905 | 93,5% | 0,774 | 111/530 (20,9%) |
| STTC | 0,920 | 0,719 | 0,760 | 0,896 | 94,6% | 0,753 | 96/484 (19,8%) |
| CD | 0,877 | 0,662 | 0,670 | 0,900 | 92,2% | 0,701 | 122/470 (26,0%) |
| HYP | 0,906 | 0,627 | 0,633 | 0,947 | 94,2% | 0,667 | 74/256 (28,9%) |

Итог совпал с исходным отчётом: macro-AUC 0,913, macro-F1 по порогу 0,719, Brier 0,090;
10-bin ECE составил 0,025. Но selective F1 0,754 нельзя читать отдельно от ошибок: при coverage
93,7% текущая зона ±0,10 оставила 403 уверенных false-negative среди 1740 положительных
патологических меток (`MI/STTC/CD/HYP`), то есть 23,2%. Поэтому pack пригоден только как отдельная
вероятностная гипотеза с показом измерений, правил и отказа, а не как автономный диагноз или
отрицательное заключение. Воспроизводимый внешний отчёт:
`/tmp/minimed-ecg-numeric-release-eval-20260901/report-v2.json`, SHA-256
`a729197c9aaadb1631852ac052de82fec198bb06799287c1d0f5bed5647ab854`.

### Асимметричная safety-зона 2026.3

Для патологических классов отрицательный порог нельзя выбирать как зеркальное расстояние от
положительного: именно это создавало большую долю уверенных false-negative в `2026.2`. Новый
evaluator выбирает отдельный отрицательный cutoff только на `strat_fold=9`, ограничивая долю
уверенных false-negative каждого класса величиной 5%; положительные пороги и сама HGB-модель не
меняются. `NORM` сохраняет прежнюю симметричную зону.

| Класс | Отрицательный cutoff | Положительный cutoff | Test coverage | Test F1 среди ответов | Уверенные FN / все positive |
|---|---:|---:|---:|---:|---:|
| MI | 0,0544 | 0,480 | 69,6% | 0,854 | 21/530 (4,0%) |
| STTC | 0,0610 | 0,560 | 77,7% | 0,810 | 32/484 (6,6%) |
| CD | 0,0486 | 0,470 | 56,8% | 0,792 | 28/470 (6,0%) |
| HYP | 0,0261 | 0,480 | 58,1% | 0,783 | 11/256 (4,3%) |

На validation fold 9 объединённая доля уверенных пропусков составила 84/1734 (4,84%), macro
pathology coverage — 65,6%. На нетронутом test fold 10 получилось 92/1740 (5,29%) и 65,6%
соответственно. С учётом неизменённого `NORM` общий coverage равен 71,2%, а macro-F1 среди
выданных ответов — 0,823. Это selective engineering policy, а не клинически доказанная
чувствительность: приложение обязано показывать неопределённость, а отрицательный ответ всё равно не
исключает заболевание.

Кандидат `2026.3` использует JSON format version 2 с явными `negativeThreshold` и
`positiveThreshold`; runtime остаётся совместим с опубликованным format version 1. Точный ZIP:
`/tmp/minimed-ecg-numeric-adult-2026.3-safety-candidate-v2.zip`, 263 321 байт, SHA-256
`814f7ed2ff6acb1af3c44edbca11b8f29cd8b358bcb72d6c7c14a5acd8429010`. Он повторно прогнан тем же
TypeScript-inference на fold 10; отчёт
`/tmp/minimed-ecg-numeric-release-eval-20260901/report-v7-safety-candidate-boundary-safe.json`,
SHA-256 `8171f9909c955ca1098c9967f95ad06725d21d3f3370f5bb5031f4b883674a67`. Selection и runtime
используют одно граничное условие `probability <= negativeThreshold`; тест отдельно фиксирует этот
off-by-one contract. Кандидат пока не
опубликован и не заменяет `2026.2`: перед переключением каталога нужны доступ к release channel и
независимая внешняя/телефонная проверка всего photo-to-measurement пути.

Фиксированный 30-полевый контракт: `P duration`, `PR`, `QRS`, `QT`, `QTc Framingham`, mean `RR`; затем `T-aVR`, `R-V6`, `T-V6`, `R-V5`, `R-II`, `T-V5`, `R-V1`, `T-I`, `R-aVR`, `Q-V2`, `Q-II`, `S-V1`, `Q-V1`, `T-II`, `R-aVF`, `R-III`, `T-V1`, `R-V4`, `R-V2`, `R-I`, `R-V3`, `R-aVL`, `T-aVL`, `S-V2`. Feature ranking вычислялся только на train folds, поэтому test не участвовал в выборе полей.

### Сверка release-pack с независимыми правилами

Опубликованный ZIP `2026.2` был повторно проверен по SHA-256
`f51d88ced3687fe0840eff51d8187ea59a6ba401b5c364368cf0b6140e09832d`. Браузерный JSON-inference
воспроизведён без переобучения на adult `strat_fold=10`: из 2151 записи 2130 имели все 30
значений в runtime-диапазонах, 16 строк имели пропуски и 5 — недопустимое значение.

| Сверка среди ответов вне abstention-зоны | Модель + / правило + | Модель + / правило − | Модель − / правило + | Вывод |
|---|---:|---:|---:|---|
| `CD` против QRS ≥120 мс | 164 | 246 | 4 | HGB нашёл 97,6% широких QRS, но CD шире одного duration-критерия |
| `HYP` против Sokolow–Lyon >3,5 мВ | 94 | 114 | 32 | Sokolow подтвердил только 45,2% положительных HYP и не может быть veto |
| `NORM` против полного набора текущих правил | 809 | 154 | 439 | NORM иногда сосуществует с буквальным отклонением частоты/PR/QRS/QTc/оси/вольтажа |

Это не confusion matrix клинического диагноза: `CD` включает нарушения проводимости без широкого
QRS, `HYP` включает признаки вне Sokolow–Lyon, а super-class `NORM` не является обещанием идеальных
границ каждого отдельного числа. Поэтому rule mismatch не подавляет вероятность. В UI после расчёта
показывается отдельная сверка: независимая опора, если широкий QRS/Sokolow совпали, либо явное
ограничение; положительный NORM никогда не скрывает буквальные findings.

## Проверка доступности чисел из фото

Текущий release-оцифровщик прогнан через реальный browser/WASM path на 15 разных изображениях: 10 LearnECG и 5 ECG Image Kit (clean, perspective distortion, augmentation, handwriting, wrinkle). Падений не было; только 4/15 прошли собственный `usable` gate, 10/15 потребовали ручной проверки, 1/15 был отклонён. Результаты нельзя считать проверкой точности RR: большинство внешних примеров имеют иной профиль скорости, а MiniMed намеренно допускает интерпретацию только после подтверждения `50 мм/с` и `10 мм/мВ`.

Отдельный чистый baseline на 30 неизменяемых synthetic-test листах поддерживаемого профиля 12×1,
50 мм/с, 10 мм/мВ выявил одну общую ошибку масштаба: 6/30 листов давали ложную длительность
17,8–18,1 с из-за влияния кривой на оценку периода сетки. После добавления независимой оценки
pixels/mm по повторяющимся калибровочным импульсам и узкого fallback только при невозможной
длительности 4–12 с production browser/WASM path принял 30/30 листов, извлёк 12/12 отведений,
получил среднее rhythm coverage 99,3%, RR MAE 15,73 мс и ЧСС MAE 1,37/мин; 24/30 RR попали в
20 мс, максимальная ошибка составила 44 мс. Manifest имеет SHA-256
`2119b60dc9b5c8894cfe33c7828bea80221eeac992a553c144c23f4a00972240`, итоговый JSON —
`77720cc77fff3c21564aae2e5f57dd07a051fde1fd97c55a99f78c27e12b5b54`. Это подтверждает только
чистый цифровой baseline. До физической печати и съёмки он не является real-phone holdout и не
доказывает качество перспективного выравнивания, бликов, теней или размытия.

Дополнительно проверен публичный CC BY 4.0 [Real world ECG image dataset](https://figshare.com/articles/figure/Real_world_ECG_image_dataset/25264786),
archive v3 SHA-256 `34b02f3d29ec8182c599e15e24d868382f43f97d33ae65a49a240890ef2da0ba`.
В опубликованной папке `2_photo` действительно находятся полные 12×1 фотографии бумаги, однако
заголовки явно указывают 25,0 мм/с, gain скрыт как `XX mm/mV`, а устройство съёмки не приведено.
Шесть разных по морфологии случаев дали `0 usable / 6 review`, в среднем 5,67/12 отведений и 74,9%
rhythm coverage. Первый прогон ошибочно принимал раздельные белые блоки шапки и полей за один
блик; после требования связной внутренней области, со всех сторон окружённой цветной сеткой или
плотной структурой, синтетический блик по-прежнему обнаруживается, а все шесть фотографий дают
`0 glare`. Они всё равно безопасно остаются в `review` из-за неполных отведений или слабой
ритм-строки. Это полезный реальный negative control, но не positive 50 мм/с / 10 мм/мВ holdout.
Manifest/result SHA-256:
`adbf80385af009767981d25156012bc7edff8f56a7c762527ee16d46864379c2` и
`882ce62cecc774a787f1f40b67820e820abbeceebc85dfa519abceb68ded6811`.

Главный integration gap оказался структурным: оцифровщик возвращает 12 массивов напряжения, coverage, RR и ЧСС, но не даёт валидированных P/Q/R/S/T fiducials или аппаратных амплитуд. В приложении теперь видны все извлечённые кривые и эвристические Q/R/S/T точки одного комплекса; только результат `usable` может по отдельной кнопке скопировать 24 черновые амплитуды в редактируемую форму. Это не считается подтверждением: `review`/`failed` ничего не переносят, новое фото очищает старые значения, P/PR/QT/QTc остаются ручными, QRS переносится лишь как редактируемый черновик после строгого gate, а прогноз заблокирован до заполнения всех 30 полей и отдельного подтверждения. До benchmark против аппаратных Uni-G/12SL measurements эти точки следует считать визуальной подсказкой, а не автоматической delineation.

Этот gap теперь измерен на отдельных 100-record adult validation fold 9 и test fold 10 PTB-XL
cohorts с полными PTB-XL+ 12SL global measurements. Исходные таблицы зафиксированы SHA-256
`cd805ec672c305d0d5079bb87c83d629b91cf3534ce18d3717a960998d5e8b29` (`12sl_features.csv`) и
`7600de9c1b27d181d850b3c6038a35d7c3ddb6bb33b702e3a20252a6859d216b`
(`ptbxl_database.csv`). На validation медиана локальных QRS давала MAE 13,25 мс, верхний квартиль
11,79 мс, максимум 30,50 мс; поэтому без просмотра test был выбран верхний квартиль. На fold 10 он
подтвердил улучшение 16,50→11,96 мс при прежнем coverage 48%: 87,5% выданных значений попали в
20 мс и 97,9% — в 40 мс. Аналогичный QT улучшился 35,89→27,33 мс, но coverage 36% и только 33,3%
результатов в пределах 20 мс не позволяют экспортировать его автоматически. P/PR не выдержали даже
ослабленную поддержку четырёх отведений: test coverage 25%/20% и MAE 48,16/35,15 мс.

На тех же идеальных цифровых fold-10 сигналах 24 используемые моделью амплитуды имели macro MAE
0,123 мВ, median absolute error 0,055 мВ, macro Pearson r 0,713 и 73,4% значений в пределах
0,1 мВ. Разброс по признакам велик: `R_I` дал MAE 0,042 мВ и r=0,994, а `Q_V1` — 0,338 мВ и
r=0,257. Поэтому одна кнопка может переносить только редактируемый черновик; все 24 значения и
интервалы должны быть сверены, а отдельное подтверждение остаётся обязательным до вызова Solver.
Fold-9/fold-10 production reports имеют SHA-256
`0a4ad4a7f7675cf80b3ee97ee2dcb0df5051baa4a2bb6c7fc3ce81c6e8d04eae` и
`57134dcef0362df06b507f539e1bd3891e1bfe42ae42f9f2eeedd351ef8c1584`.

## Какие numeric features нужны собственному rule layer

Минимальный контракт: длительность записи и sampling rate; RR sequence и regularity; P/QRS/T onset/offset/peak; PR, QRS, QT и QTc; P/Q/R/S/T amplitudes и morphology по отведениям; ST J-point и ST-смещение в mV; frontal P/QRS/T axes; качество/полнота каждого отведения; возраст и пол как контекст. Каждое правило должно возвращать `finding`, числовые значения, пороги, confidence/quality и список недостающих измерений.

Практическое покрытие первой версии: heart-rate/rhythm regularity, sinus-like rhythm, AF-подозрение (только при наличии beat-level P evidence или явной нерегулярности), AV block/PR, wide QRS, RBBB/LBBB-подозрение, axis deviation, QTc warning, ST elevation/depression screening. Не обещать по одной фотографии инфаркт, электролитное нарушение или ишемию без lead-quality gate и клинического контекста.

## Возраст и короткие записи

Возрастные gates обязательны: педиатрические нормы PR/QRS/QTc, оси и частоты зависят от возраста; взрослые пороги нельзя автоматически применять к младенцам. Публичный [PEDMEANS Physician's Manual](https://www.hillrom.com/content/dam/hillrom-aem/us/en/sap-documents/LIT/80015/80015051LITPDF.pdf) описывает возраст-зависимые нормальные границы и критерии, но исходный engine закрыт; это источник спецификации, а не кода. Для проверки ритмов доступна лицензированная [Leipzig pediatric/CHD ECG database](https://physionet.org/content/leipzig-heart-center-ecg/1.0.0/), однако она состоит из длинных 12-lead и intracardiac записей после electrophysiology studies и не является готовым benchmark нормальной детской 10-секундной ЭКГ.

Для короткой записи корректно считать HR и отдельные интервалы, но нельзя уверенно утверждать rhythm/AF при малом числе RR или диагностировать патологию, требующую полного 12-lead контекста. При недостатке lead/beat данных правило должно возвращать `insufficient-data`, а не отрицательный диагноз.

## Shortlist и следующий benchmark

1. **Взять кодом:** официальный MIT-код PTB-XL+ feature benchmark как воспроизводимую исследовательскую основу; для downloadable numeric pack использовать компактный adult-only HGB по фиксированным 30 подтверждённым полям. Permissive измерительные части OSET/BioSigKit — только там, где они сокращают и улучшают существующее ядро.
2. **Использовать как измеритель/эталон:** WFDB tools, ECG-kit, BRAVEHEART, OpenECG. Не переносить GPL/AGPL код в offline pack без отдельного лицензионного решения.
3. **Использовать как спецификацию:** Minnesota/NOVACODE, PEDMEANS manual и опубликованные AHA/ACCF/HRS критерии; каждое правило независимо реализовать и покрыть тестом. Construe не использовать как источник для обходного переписывания AGPL rules.

Runtime gate выполнен: HGB экспортирован в независимо читаемый JSON, Python-export inference совпал со sklearn на всех 2 185 взрослых test rows с максимальной разницей 0, браузер установил проверенный release ZIP и воспроизвёл контрольный результат. В интерфейсе есть редактируемая форма 30 чисел; неполный ввод блокирует прогноз, возраст младше 18 лет отклоняется. Следующий gate — сравнить HGB с правилами Minnesota/AHA/MEANS-derived test specifications, измерить расхождения и проверить ручной ввод на независимо размеченной внешней популяции. Leipzig подходит только для ограниченного rhythm-smoke, не для общей детской нормы.

## Ограничения доказательности

Репозитории выше — исследовательское ПО, не доказательство клинической безопасности. Лицензия на код не означает разрешение на медицинское применение или на перераспределение датасетов. В приложении результат должен быть явно маркирован как автоматическая оценка качества/измерений и вероятностные признаки для проверки врачом.

## Дополнительная проверка кандидатов (31 августа 2026)

**BRAVEHEART (актуальный upstream snapshot).** Это действительно числовой 12-lead pipeline: принимает цифровые ECG/VCG форматы, выполняет denoising, удаление недоминантных beats, QRST fiducial annotation, median-beat construction и выдаёт измерения в numeric/graphical форматах. Однако авторы позиционируют его для research, а код распространяется под GPL-3.0; это измеритель/эталон, не permissive diagnostic engine. Проверенный HEAD: [`9b2e03b`](https://github.com/BIVectors/BRAVEHEART/tree/9b2e03be0ef403bf1701fae2c20e9f7b867425b3). [README и лицензия](https://github.com/BIVectors/BRAVEHEART/blob/9b2e03be0ef403bf1701fae2c20e9f7b867425b3/README.md) · [первичная статья](https://doi.org/10.1016/j.cmpb.2023.107798). В MiniMed не переносить код без отдельного GPL-решения.

**Construe — зрелее, чем обычный feature extractor, но не permissive.** Репозиторий содержит не только beat/wave detection, но и knowledge base с композицией гипотез от P/QRS/T до AF, bigeminy, trigeminy и ventricular flutter/fibrillation. HEAD [`8370cd5`](https://github.com/citiususc/construe/tree/8370cd52e8da1873790cb2c522d89d1d2dbfb00a); лицензия — AGPL-3.0. [README](https://github.com/citiususc/construe/blob/8370cd52e8da1873790cb2c522d89d1d2dbfb00a/README.md) · [LICENSE](https://github.com/citiususc/construe/blob/8370cd52e8da1873790cb2c522d89d1d2dbfb00a/LICENSE). Это пригодный внешний comparator для rhythm hypotheses, но не источник для механического переписывания правил в закрытый/offline pack.

**Отклонённые новые deep-learning проекты.** XAND-ECG (Apache-2.0) и AIMedLab/ecg-diagnosis публикуют 12-lead classifiers, но работают с raw waveform и CNN/SHAP, а не с независимым numeric contract; поэтому они не отвечают текущему запросу. ECG-R1 также protocol-guided MLLM, а не rule engine. Их не следует добавлять в shortlist только из-за permissive code license: лицензия не превращает diagnostic CNN в проверяемый набор числовых критериев. [XAND-ECG](https://github.com/XOREngine/xand-ecg) · [AIMedLab/ecg-diagnosis](https://github.com/AIMedLab/ecg-diagnosis) · [ECG-R1](https://github.com/PKUDigitalHealth/ECG-R1).

## Дополнительный поиск: числовой диагнозатор и стандарты (31 августа 2026)

| Кандидат | Что реально принимает/выдаёт | Лицензия и воспроизводимость | Решение для MiniMed |
|---|---|---|---|
| **RECGDT / ECG Diagnosis Tool** | R/Shiny-пайплайн принимает оцифрованную многоканальную запись, сам строит basal beat и P/QRS/T fiducials, затем формирует по каждому отведению числовые признаки `RR`, `PR`, `QRS`, длительность/высоту Q/R/S, `QTc`, ST depression/elevation и подаёт их в шесть отдельных моделей: bradycardia, ischemia, MI, tachycardia, ventricular hypertrophy, WPW. Результат — score вероятности по каждой болезни. | GPL-3.0; релиз 1.1.1. В репозитории лежат шесть бинарных `.rds` моделей, но их происхождение/обучающая выборка и клиническая внешняя валидация не описаны достаточно для переноса. [README, pinned HEAD](https://github.com/milegroup/RECGDT/blob/7fd5700a92051d954c3bef7eacef635a018d6864/README.md#L1-L35) · [диагностический код](https://github.com/milegroup/RECGDT/blob/7fd5700a92051d954c3bef7eacef635a018d6864/R/DiagnoseDiseases.r#L1-L45) · [модельные вызовы и признаки](https://github.com/milegroup/RECGDT/blob/7fd5700a92051d954c3bef7eacef635a018d6864/R/DiagnoseDiseases.r#L260-L311) · [лицензия](https://github.com/milegroup/RECGDT/blob/7fd5700a92051d954c3bef7eacef635a018d6864/DESCRIPTION#L1-L8) | **Новый наиболее близкий кандидат**, но не для встраивания: GPL, R/mgcv/pROC/caTools, waveform-dependent delineation и неизвестная переносимость `.rds`. Полезен как внешний comparator при исследовании; его six-score output нельзя считать совместимым с 30-полевым HGB без повторного обучения/калибровки. Для браузера/локального TypeScript — отклонить. |
| **SCP-ECG v3.0 statement vocabulary** | Стандарт задаёт кодируемые диагностические statements, certainty (`definite/probable/possible/...`), модификаторы и логические выражения; это семантический слой для результатов аппаратного интерпретатора, а не формулы, вычисляющие диагноз из PR/QRS/QT. | Международная спецификация; сама по себе не OSS engine и не лицензия на реализацию чужих диагностических правил. [Описание v3.0 и universal codes](https://devel.support.cardio.ai/api/formats/scp/) · [первичная публикация v3.0](https://iris.unica.it/handle/11584/198819) | **Добавить как внутренний label/provenance слой**, когда правила начнут возвращать statements с вероятностью/уверенностью. Не использовать как готовый numeric classifier. |
| **DICOM Waveform / TID 3717 ECG Qualitative Analysis** | DICOM стандартизует хранение waveform, каналов, sample scaling, beat/time source и coded/free-text qualitative analysis; TID 3717 хранит интерпретацию, но не определяет медицинские пороги. | Официальный стандарт NEMA; это формат/контейнер, не диагностический алгоритм и не модель. [DICOM Supplement 66](https://dicom.nema.org/medical/dicom/final/sup66_ft.pdf#page=17) | **Полезен для импорта/экспорта и provenance**, но не добавляет диагноза по 30 числам. Приоритет ниже собственного JSON numeric contract. |
| **ecg-contec SCP parser** | Python-парсер читает/пишет ограниченное подмножество SCP-ECG, включая числовые waveform sections; не вычисляет fiducials и не интерпретирует диагнозы. | GPLv3-or-later; 554 строки, версия 0.1.0. [Исходник, pinned HEAD](https://github.com/RigacciOrg/ecg-contec/blob/b4af68c7c869225d3805b191bb223847ac24b64c/ecg_scp.py#L1-L35) | **Отклонить для приложения** из-за GPL и отсутствия diagnostic layer; учитывать только как справочник SCP parsing при отдельной интеграции. |
| **ECG-QA (PTB-XL/MIMIC-IV-ECG)** | Набор содержит machine-generated statements, нормализованные к SCP-ECG v3.0; расширенная версия сохраняет 155 SCP codes. Это dataset для supervised evaluation/training, не inference engine и не набор клинических формул. | Репозиторий с dataset/code; условия исходных PTB-XL/MIMIC-данных нужно соблюдать отдельно. [README, pinned repository history](https://github.com/Jwoo5/ecg-qa) | **Кандидат для будущей разметки/оценки**, если numeric model будет переобучаться на statements. Не добавлять данные в release pack и не выдавать его labels как ground truth для ручных измерений. |

### Вывод поиска

RECGDT — единственный новый найденный проект, который действительно соединяет измеренные ECG-признаки с несколькими disease scores и публикует готовые модели. Но он требует исходного сигнала для собственного delineation, распространяется под GPL-3.0 и не раскрывает достаточную provenance моделей. Поэтому текущий выбор не меняется: MiniMed использует собственные прозрачные правила и adult-only 30-feature HGB, а RECGDT остаётся внешним comparator для offline-исследования. SCP-ECG и DICOM следует рассматривать как стандарты представления statements/измерений; они не заменяют clinical rule specification. ECG-QA может помочь получить словарь labels и benchmark, но не превращает числовые измерения в проверенный диагноз.

## Проверка новых проектов 2026 года

| Проект | Что найдено | Решение |
|---|---|---|
| **ECG-R1** | Apache-2.0, но опубликованный `Standardized Clinical Protocol` — prompt для генеративной модели, а не исполняемый rule engine. Он содержит упрощённые пороги, требует подгонять рассуждение под переданный machine report и предлагает исключать дифференциальные диагнозы по одному нормальному признаку. [Prompt, pinned HEAD](https://github.com/PKUDigitalHealth/ECG-R1/blob/5008b8f9cc2c78599d284a8a92387438257fcc41/scripts/corpus_generation/sft_corpus_generation_prompt.txt) | Не переносить как клиническую базу правил. Датасет можно использовать только для исследования формата объяснений после отдельной проверки каждого критерия по первичному источнику. |
| **ECGomics** | На HEAD [`0f37205`](https://github.com/PKUDigitalHealth/ECGomics/tree/0f37205405a3dc446b3d5d11223587e76976c0bc) публичный репозиторий содержит только короткий README и ссылку на внешний сервис; исходного pipeline и файла лицензии нет. | Не является воспроизводимым open-source кандидатом. |
| **FeatureDB** | Вычисляет average-beat morphology, HRV, QRS axis, QT dispersion и другие числовые признаки. Диагностического слоя нет; на HEAD [`6b95c50`](https://github.com/PKUDigitalHealth/FeatureDB/tree/6b95c50cd759e7430c808b8dba54852178afb937) не найден файл лицензии. | Полезен как исследовательский comparator измерений, но код нельзя включать в MiniMed до явной лицензии и собственной проверки интервалов. |
| **OpenECG v6** | Актуальный report объединяет обученный ONNX/TFLite codec для P/QRS/T, beat и rhythm с NumPy QRS detector и отдельной AF rule. Чистый `rules` mode даёт только ЧСС и ограниченную AF-проверку; широкие rhythm labels приходят из learned single-lead model. [README, pinned HEAD](https://github.com/vitaldb/openecg/blob/60ac8887ab0d640fbab6ef094d023b72a9f630c5/README.md#structured-report--one-call-agent-ready-json) | Хороший внешний delineation/rhythm benchmark, но не numeric-only broad diagnostic engine и не замена 12-lead правилам. |

Итог повторного поиска не меняет реализацию: готового permissive движка «подтверждённые числа → широкий диагноз» по-прежнему нет. Самый короткий надёжный путь — добавлять только высокоспецифичные, объяснимые паттерны с abstention и использовать 30-полевый HGB как отдельный вероятностный второй слой, а не как источник измерений или окончательного заключения.

Первый такой следующий кандидат — LAFB — прошёл только numeric preflight, но не photo gate. Строгий
пятикомпонентный критерий на adult `strat_fold=10` PTB-XL/12SL дал `16/158` срабатываний среди
LAFB-positive и `0/1998` среди остальных complete rows. Это подтверждает пригодность только
положительной формулировки `pattern compatible with LAFB`; отсутствие срабатывания не исключает
LAFB. Зафиксирован отдельный [15-case render/photo smoke manifest](ecg-lafb-photo-benchmark-sources.md),
и image gate не пройден: после исправления X/Y-калибровки clean-рендеры дали медианную lead
correlation 0,981, amplitude gain 0,945 и 1,73 bpm MAE ЧСС. На phone-like вариантах ЧСС также
стала устойчивой (0,87 bpm MAE), но waveform correlation осталась 0,410; 11/15 изображений теперь
корректно требуют review по несовпадению двух копий lead II. Поэтому runtime LAFB по фото не
добавляется. Ручной numeric-rule доступен только после явного подтверждения всех чисел и morphology;
любая правка или новый черновик оцифровщика снова переводит данные в неподтверждённое состояние.

## Повторный поиск: дополнительные numeric/feature-based кандидаты (31 августа 2026)

**IPI/DDA (Cairns et al.).** Первичная публикация описывает web rule-engine, где ECG-критерии
хранятся в JSON и reasoning-алгоритм предлагает несколько дифференциальных диагнозов по
аннотациям интерпретатора. Это близкая архитектура будущего MiniMed rule-pack, но публикация не
содержит исполняемого репозитория, JSON-базы критериев или лицензии на перенос правил; это
спецификация workflow, а не source для интеграции. [PubMed, abstract и методы](https://pubmed.ncbi.nlm.nih.gov/28903861/)

**ECG_DSS_CAE (MIT, проверенный HEAD `6248305`).** Репозиторий содержит 12-lead decision-support
приложение и pretrained convolutional autoencoder, который ищет аномальные окна для ускорения
разметки; README описывает обучение на synthetic/PTB/PTB-XL и запуск Python GUI, но не формирует
statements из PR/QRS/QT/axis/amplitude features. Это anomaly-localizer на raw waveform, а не
numeric diagnostic engine, поэтому не подходит для текущего контракта даже при MIT-лицензии.
[README, pinned HEAD](https://github.com/UgoLomoio/ECG_DSS_CAE/blob/6248305dcdb6ce077fb9b3b0d4ccabcd1d597d13/README.md#L188-L220) · [MIT license](https://github.com/UgoLomoio/ECG_DSS_CAE/blob/6248305dcdb6ce077fb9b3b0d4ccabcd1d597d13/LICENSE#L230-L260)

**Отрицательный результат.** Поиск актуальных открытых репозиториев и первичных публикаций не
выявил нового permissive исполнителя, который принимает уже измеренные PR/QRS/QT/QTc, axis,
per-lead amplitudes/morphology и возвращает широкий набор диагнозов или калиброванные вероятности.
Практический shortlist не меняется: собственные прозрачные rules + 30-feature HGB; RECGDT — GPL
comparator, Construe — AGPL rhythm comparator, IPI/DDA — архитектурный образец JSON-критериев без
доступной codebase.

## Аппаратные feature contracts и открытые банки измерений (31 августа 2026)

### Что на самом деле получает аппаратный интерпретатор

Официальные руководства Philips, GE и Mortara показывают один и тот же общий pipeline: сначала
строятся representative/median beats и группы похожих сокращений, затем считаются глобальные и
per-lead измерения, после чего последовательно применяются диагностические критерии и правила
подавления конфликтующих statements.

- **Philips DXL** прямо говорит, что interpretive statements генерируются из Extended Measurements.
  Контракт включает глобальные rate/RR/PR/QRS/QT/QTc и оси, а для каждого отведения — амплитуды,
  длительности и площади P/P'/Q/R/S/R'/S'/T, notch/slur/delta, ST в J-point/mid/80 ms/end;
  rhythm-группы несут число и долю beats, runs, RR/PR progression, Wenckebach, bigeminy/trigeminy.
  [Официальный DXL Physician's Guide, measurement tables](https://www.documents.philips.com/doclib/enc/fetch/2000/4504/577242/577243/577246/581601/711562/DXL_ECG_Algorithm_Physician_s_Guide_(ENG)_Ed.2.pdf#page=115)
- **GE Marquette 12SL v23** строит measurement matrix по median complex: отдельные волны
  определяются по baseline crossings и площади, а matrix хранит их амплитуды и длительности.
  Руководство также раскрывает порядок/suppression: например, LBBB прекращает дальнейший contour
  analysis, а RBBB подавляет right-axis statements. Это спецификация поведения закрытого medical
  device, не лицензия на его rule base.
  [Официальный 12SL Physician's Guide](https://landing1.gehealthcare.com/rs/005-SHS-767/images/45351-MUSE-17Nov2022-6-1-Quick-Reference-Guide-LP-Diagnostic-Cardiology.pdf#page=27)
- **Mortara VERITAS** публикует ещё более явные `IF/AND/OR → PRINT` criteria, включая per-lead
  QRS area, R/S duration/amplitude, axis и ST/T measurements, причём более поздний statement внутри
  раздела обычно заменяет ранний. Но алгоритм закрыт, а руководство защищено авторским правом:
  использовать как comparator/requirements, не копировать целиком в runtime.
  [Официальный VERITAS Physician's Guide](https://www.hillrom.lat/content/dam/hillrom-aem/us/en/sap-documents/LIT/9515-/9515-001-51-ENGLITPDF.pdf#page=6)
- Официальная страница **Glasgow ECG Program** подтверждает adult/pediatric interpretation,
  Minnesota coding и широкое применение age/sex criteria, однако не предоставляет исходники или
  открытую лицензию на criteria engine.
  [University of Glasgow](https://www.gla.ac.uk/schools/healthwellbeing/research/robertsoncentreforbiostatistics/electrocardiology/glasgowecgprogram/)

Следствие для MiniMed: `HR + PR + QRS + QTc + axis` достаточно для буквальных interval/axis
findings, но недостаточно для надёжного MI/LVH/BBB/ST-T conclusion. Следующий полезный numeric
contract — не ещё один глобальный score, а проверенные per-lead onset/offset, amplitude, area,
morphology и beat-sequence observations с явным `missing-data`.

### MIMIC-IV-ECG как reverse-engineering bank

В открытом `machine_measurements.csv` MIMIC-IV-ECG находятся 800 035 строк от нескольких типов
аппаратов (Burdick/Spacelabs, Philips и GE): `report_0..17`, `cart_id`, RR, P/QRS/T fiducials и
оси P/QRS/T. PhysioNet подчёркивает, что это **глобальные машинные** измерения по 12 отведениям;
per-lead measurements в v1.0 отсутствуют. Файлы доступны по ODbL-1.0.
[Описание набора и лицензия](https://physionet.org/content/mimic-iv-ecg/1.0/) ·
[словарь полей](https://physionet.org/content/mimic-iv-ecg/1.0/machine_measurements_data_dictionary.csv)

Локальная сверка фиксированных порогов с машинными statements дала для rate ≥100 bpm
чувствительность/специфичность `0,990/0,997`, для PR >200 ms — `0,953/0,987`, для QRS ≥120 ms —
`0,927/0,903` (PPV `0,451`), для Framingham QTc >470 ms — `0,678/0,936` (PPV `0,343`). Для
бинарного отклонения QRS-axis на 747 252 сопоставимых строк: `0,970/0,915`, PPV `0,608`.
Это проверка сходства с outputs разных аппаратов, **не клиническая accuracy**: report может
подавлять буквальный statement из-за ритма/пейсмейкера/другого более приоритетного вывода, а
отсутствие machine statement не является отрицательной врачебной разметкой. Поэтому MIMIC годится
для regression tests, поиска suppression и стратификации по `cart_id`, но не как единственный target
для нового диагнозатора.

Отдельная сверка 675 873 записей без pacemaker/no-further-analysis показала, почему формулировка
для PR должна оставаться осторожной: порог `PR >200 ms` распознал объединённые statements
`borderline/first degree A-V block` с чувствительностью `0,960`, специфичностью `0,974` и PPV
`0,778`, но медиана PR была `208 ms` для borderline и `236 ms` для полного statement. То есть даже
аппараты разделяют один непрерывный числовой признак на severity-уровни; MiniMed правильно оставляет
`PR >200 ms` буквальным отклонением и повышает его до совместимого паттерна только при подтверждённом
проведении P→QRS 1:1.

### KURIAS и ECGTwinMentor

**KURIAS-ECG** концептуально ближе всего к желаемому банку: 20 000 записей, машинные analyzed
parameters и 147 statements, проверенно сопоставленных с SNOMED-CT/OMOP и 10 категориями Minnesota.
Но PhysioNet сейчас одновременно показывает restricted license и статус «files no longer
available», поэтому воспроизводимый benchmark на нём запустить нельзя.
[Первичная карточка набора и текущий статус файлов](https://physionet.org/content/kurias-ecg/1.0/)

**ECGTwinMentor** (HEAD [`dd3e06e`](https://github.com/ElsevierSoftwareX/SOFTX-D-25-00517/tree/dd3e06e07a189298123a501087fbafeca39e1917))
отклонён. Он обучает dense network на восьми полях, включая уже категориальный `Rhythm`, и имеет
CC BY-NC 4.0 вместо permissive code license.
[Входы и модель](https://github.com/ElsevierSoftwareX/SOFTX-D-25-00517/blob/dd3e06e07a189298123a501087fbafeca39e1917/README.md#L97-L139) ·
[training code](https://github.com/ElsevierSoftwareX/SOFTX-D-25-00517/blob/dd3e06e07a189298123a501087fbafeca39e1917/model/ecgtwinmentor_colab.py#L76-L99) ·
[лицензия](https://github.com/ElsevierSoftwareX/SOFTX-D-25-00517/blob/dd3e06e07a189298123a501087fbafeca39e1917/README.md#L473-L485)
Локальный аудит включённого 3000-row CSV обнаружил прямую label leakage: во всех 500 строках с
`Rhythm=Bradycardia`, всех 500 с `Tachycardia` и всех 500 с `Atrial Fibrillation` поле `Diagnosis`
дословно равно `Rhythm`; остальные три класса всегда имеют `Rhythm=Sinus`. Репозиторий не даёт
clinical acquisition provenance для CSV. Такая модель учит встроенную метку, а не выводит диагноз
из независимых измерений, поэтому её offline/TFLite deployability не имеет диагностической ценности.

Из новых tabular работ [ECGcardiomyopathy](https://github.com/againh3x/ECGcardiomyopathy)
воспроизводимо сочетает per-lead amplitudes/durations, 30 global features и VCG с
Logistic Regression/XGBoost, но решает только три узких binary cardiomyopathy tasks на 599 пациентах;
часть labels извлекается GPT-4.1 из discharge notes, а явного `LICENSE` в репозитории нет. Это пример
исследовательского feature engineering, не broad numeric interpreter и не код для включения в
TypeScript runtime.

### Новые открытые реализации вокруг числового контракта

**ECGDataKit** (Apache-2.0, HEAD [`8e3e538`](https://github.com/UMMISCO/ECGDataKit/tree/8e3e53895b2fa098188a7a8731ea1b0aaedeb5f0))
полезен не как диагнозатор, а как готовая спецификация импорта: Python-библиотека приводит 13
форматов, включая Philips Sierra XML, GE MUSE XML, SCP-ECG, DICOM и WFDB, к одной структуре с
raw leads, global HR/RR/PR/QRS/QT/QTc/axes и уже записанными аппаратом statements. Собственных
диагностических правил в проекте нет. Для MiniMed это хороший comparator будущего импорта цифровых
файлов, но не причина добавлять Python runtime или заменять текущие правила.
[README и data model](https://github.com/UMMISCO/ECGDataKit/blob/8e3e53895b2fa098188a7a8731ea1b0aaedeb5f0/README.md#data-model) ·
[лицензия](https://github.com/UMMISCO/ECGDataKit/blob/8e3e53895b2fa098188a7a8731ea1b0aaedeb5f0/LICENSE)

**CardioDiag** — наиболее близкая новая публикация к модели только по глобальным числам: отдельные
XGBoost-классификаторы используют возраст, пол, RR/PR/QRS/QT/QTc и оси P/QRS/T, обучаются на
MIMIC-IV-ECG-ICD и внешне проверяются на ECG-VIEW II. Для выбранных cardiac ICD-10 diagnoses
публикация сообщает external AUROC примерно `0,720–0,874`. Это, однако, prediction связанных с
пациентом ICD-кодов (включая сердечную недостаточность, клапанные болезни и кардиомиопатию), а не
формальная интерпретация конкретной ЭКГ. Репозиторий не содержит готовых checkpoints и явной
лицензии, поэтому воспроизвести метод можно только как отдельное исследование на разрешённых
датасетах; в runtime или release pack его включать нельзя.
[Первичная статья](https://cinc.org/archives/2024/pdf/CinC2024-049.pdf) ·
[код, HEAD `8c722ce`](https://github.com/AI4HealthUOL/CardioDiag/tree/8c722ce5809db64248ed49bacfd1ebcc375e552f)
