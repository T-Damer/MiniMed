# Следующее детерминированное правило по числовым данным ЭКГ

Дата проверки: 31 августа 2026 г.

## Решение

Следующий безопасный кандидат — **буквальная классификация фронтальной оси QRS у взрослых**:
`в референсном диапазоне / отклонена влево / отклонена вправо / крайне верхняя
(right-superior)`. Это измеримый **ECG finding**, а не диагноз и не основание автоматически называть
фасцикулярный блок, гипертрофию, инфаркт или перегрузку правых отделов.

Выбор почти не расширяет контракт: в текущем дереве уже есть ручное поле `qrsAxisDegrees`, взрослый
gate и unit-тесты границ в
[`ecg-numeric-rules.ts`](../../apps/app/src/features/calculators/ecg-numeric-rules.ts) и
[`ecg-numeric-rules.test.ts`](../../apps/app/src/features/calculators/ecg-numeric-rules.test.ts).
Sokolow–Lyon также уже реализован как отдельное совпадение вольтажного критерия. Поэтому этот
документ подтверждает узкий смысл текущего axis-rule и **не рекомендует сейчас** расширять его до
LAFB/LPFB, ишемии или эктопии.

Основание: AHA/ACCF/HRS Part III считает взрослый QRS-axis нормальным в пределах `−30…+90°` и
отдельно предупреждает, что при отсутствии доминирующей QRS-дефлексии ось неопределима. Короткая
цитата: “In adults, the normal QRS axis is considered to be within −30° and 90°.”
[AHA/ACCF/HRS Part III](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.013).

## Что реально есть на входе

Текущий numeric contract содержит:

- возраст, пол и вручную подтверждаемую `qrsAxisDegrees`;
- глобальные P/PR/QRS/QT/QTc/RR;
- выбранные Q/R/S/T amplitudes, в том числе `S_V1`, `R_V5`, `R_V6`, `R_aVL`, но не полный набор
  QRS-амплитуд/длительностей и не J/ST measurements во всех отведениях;
- трёхсостояниевые ручные признаки для 1:1 AV-проведения, delta-wave, AF и BBB-morphology;
- средний RR и черновая последовательность RR из ритм-строки II; beat-wise PR и признаки
  conducted/non-conducted P пока отсутствуют.

Значит, введённую/напечатанную аппаратом ось можно классифицировать без фото. Рассчитывать ось из
текущего неполного набора R/S нельзя: для независимого расчёта нужны проверенные signed net-QRS
amplitude/area как минимум в I и aVF (предпочтительно все конечностные отведения), одинаковая
полярность, проверенный порядок электродов и репрезентативный наджелудочковый комплекс.

## Сравнение кандидатов

| Кандидат | Точные необходимые входы и пороги | Suppressions / ограничения | Короткая запись и фото | Безопасный статус | Сейчас |
|---|---|---|---|---|---|
| **Отклонение оси QRS** | Взрослый `18+`; определимая фронтальная ось. Норма `−30…+90°` включительно; LAD `<−30°`; RAD `>+90°`; участок `<−90°` — right-superior/extreme, без вывода о причине. [Part III](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.013) | Не принимать число при equiphasic/indeterminate QRS. При pacing, желудочковом комплексе или pre-excitation разрешено показать сам угол, но нужно подавить вывод о «базовой» оси и любую этиологию. Проверять lead reversal/order. | Один чистый репрезентативный комплекс достаточен для описания оси; при 3×4 sequential layout, меняющейся морфологии или эктопии ось по несинхронным сегментам ненадёжна. Напечатанное аппаратом число лучше повторного измерения с фото. | `finding`, не diagnosis | **Да — выбран** |
| **LAFB / LPFB** | LAFB: QRS `<120 ms`, axis `−45…−90°`, qR в aVL, R-peak time aVL `≥45 ms`, rS в II/III/aVF. LPFB: QRS `<120 ms`, axis `+90…+180°`, rS в I/aVL, qR в III/aVF. [2018 ACC/AHA/HRS definitions](https://www.ahajournals.org/doi/10.1161/CIR.0000000000000628) | Одна ось недостаточна. Не классифицировать paced/ventricular/pre-excited QRS; LAFB-критерий из Part III не применим к врождённым порокам с LAD с младенчества. Для LPFB особенно нужно исключать другие причины RAD клинически. | `45 ms` при 50 мм/с — 2,25 мм: умеренное размытие/перспектива легко меняют границу. Нужны согласованные доминирующие комплексы и новые manual morphology fields. | `pattern compatible with…`, review required | LAFB добавлен только для подтверждённых данных; LPFB отклонён после preflight |
| **LVH voltage** | Sokolow–Lyon: `|S_V1| + max(R_V5,R_V6)`; литература использует порог `>3.5 mV` или `≥3.5 mV`, поэтому реализация обязана закрепить выбранный источник и поведение ровно на 3,5. Cornell: `S_V3 + R_aVL >2.8 mV` у мужчин и `>2.0 mV` у женщин. [Part V](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.015), [Casale validation](https://pubmed.ncbi.nlm.nih.gov/2949887/) | Требуются подтверждённые `10 mm/mV`, правильные V1/V3/V5/V6 и signed amplitude convention. Complete LBBB, pacing, conduction defects и неправильная постановка электродов ограничивают критерии. Возраст, пол, раса и habitus меняют точность. | Формально достаточно representative beat, но 3,5 mV = 35 мм: обрезка, наклон, gain и placement критичны. Отрицательный результат особенно слаб. | Только `voltage criterion matched/not matched`; не «ГЛЖ» | Уже есть Sokolow; не следующий |
| **Степени AV-блока** | First degree: P→QRS `1:1` и PR `>200 ms`. Mobitz I: периодический non-conducted P и меняющиеся PR; Mobitz II: periodic non-conducted P при постоянных PR, кроме 2:1; 2:1 — каждый второй P проводится; high-grade — `≥2` последовательных P не проводятся при наличии некоторого AV-проведения; third degree — нет AV-проведения. [2018 guideline definitions](https://www.ahajournals.org/doi/10.1161/CIR.0000000000000628) | 2:1 нельзя честно переименовать в Mobitz I/II по этому паттерну. Нужны P-sequence, atrial rate, conducted flags и beat-wise PR; исключать blocked PAC, AF/flutter, pacing и артефакт. | Положительный эпизод можно увидеть в коротком strip; отсутствие эпизода ничего не исключает. | `AV-conduction pattern`, review required | First degree, Mobitz I/II, 2:1, high-grade и complete доступны только по подтверждённым ручным наблюдениям |
| **Патологический Q / ST–T** | Q: Q в V2–V3 `≥20 ms` или QS V2–V3; либо Q `≥30 ms` и `≥0.1 mV` deep/QS в любых двух отведениях одной contiguous group (`I/aVL/V6`, `V4–V6`, `II/III/aVF`) с оговорками Universal Definition. ST: J-point в двух contiguous leads; `≥0.1 mV`, кроме V2–V3 (`≥0.2 mV` мужчины ≥40, `≥0.25 mV` мужчины <40, `≥0.15 mV` женщины); horizontal/downsloping depression `≥0.05 mV`; T inversion `≥0.1 mV` требует контекста. [Universal Definition](https://www.jacc.org/doi/10.1016/j.jacc.2018.08.1038), [Part IV](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.014) | Для ишемических порогов нужны отсутствие LVH/LBBB, клиника, contiguous leads и «new»/serial context; pacing, pre-excitation и conduction changes искажают Q/ST–T. Изолированные ST/T изменения неспецифичны; MI требует клиники и biomarker/imaging evidence, а не одного правила. | Порог 0,05 mV равен 0,5 мм при 10 mm/mV — ниже надёжности фото среднего качества. Текущий контракт не имеет Q duration, QS, J-point/ST и полного contiguous-lead набора. | Только `Q-wave/ST/T finding`; никогда не acute/prior MI | Нет |
| **Эктопия (PAC/PVC)** | Beat-wise onset/RR/coupling, предшествующая P и её morphology, per-beat QRS duration/morphology, post-ectopic pause, simultaneous 12-lead morphology и длительность записи/count. AHA statement list различает atrial и ventricular premature complexes. [Part II](https://www.jacc.org/doi/10.1016/j.jacc.2007.01.025) | Wide premature QRS сам по себе не отличает PVC от aberrantly conducted PAC; исключать artifact, pacing и fusion. Частоту/burden нельзя выводить из случайного короткого фрагмента. | Один захваченный комплекс может дать лишь `premature complex observed`. Официальное руководство показывает резкую зависимость обнаружения от длительности: PVC на короткой 12-lead ECG встречались гораздо реже, чем при длительном мониторировании; `>30 PVC/h` — уже временная частота, которой один фрагмент не содержит. [2017 AHA/ACC/HRS guideline](https://www.jacc.org/doi/10.1016/j.jacc.2017.10.054) | `observed premature-complex pattern`, не burden/etiology | Нет |

## Выбранное axis-rule: точный контракт

Минимальный безопасный вход:

```ts
type AdultQrsAxisInput = {
  ageYears: number; // 18..120
  qrsAxisDegrees: number; // finite, normalized once
  axisDeterminate: boolean;
  source: 'machine-reported' | 'manual-calculated' | 'photo-derived';
  leadOrderVerified: boolean;
  dominantBeatOrigin: 'supraventricular' | 'ventricular' | 'paced' | 'unknown';
  preExcitation: boolean | 'unknown';
};
```

Поле `axisDeterminate` нельзя выводить из наличия числа: AHA отдельно допускает indeterminate axis
при отсутствии доминирующей QRS-дефлексии. Для существующего минимального UI допустим более узкий
вариант: пользователь вводит ось только когда аппарат/врач уже дал определимое значение; пустое поле
означает abstention.

Правила результата:

1. `−30° ≤ axis ≤ +90°` → `qrs-axis-normal`.
2. `−90° ≤ axis < −30°` → `qrs-axis-left`.
3. `+90° < axis < +180°` → `qrs-axis-right`.
4. `−180° < axis < −90°` → `qrs-axis-extreme/right-superior`.
5. `+180°` и `−180°` — одно направление. Нельзя позволять им попадать в разные клинические
   категории только из-за записи числа: нормализовать один раз либо дать общей boundary-категории.
6. При ventricular/paced QRS, confirmed pre-excitation, неизвестном lead order или неопределимой оси
   — не выдавать норму/этиологию; допустимо показать только введённый угол с `context-limited`.

Категории AHA у границ текстово частично перекрываются (`−30` одновременно край normal и начало
описания LAD). Для кода следует придерживаться таблицы Part III: `−30` и `+90` входят в normal,
отклонение начинается строго за границей. Это должно быть явно зафиксировано тестами, а не зависеть
от округления UI.

### Минимальная проверка

Synthetic/unit cases должны покрыть:

- `−30` и `+90` → normal;
- число непосредственно меньше `−30` → left, непосредственно больше `+90` → right;
- `−90` → left, число меньше `−90` → extreme/right-superior;
- эквивалентность `−180/+180` после нормализации;
- `NaN`, infinity и значения вне диапазона → validation error;
- пустое/indeterminate → abstain, не normal;
- paced/ventricular/pre-excited context → literal angle only, no etiologic label.

Эти тесты доказывают только корректность ветвлений и boundary semantics. Они не доказывают, что
ось правильно извлечена из изображения и не измеряют клиническую чувствительность/специфичность.

## Почему остальные кандидаты пока проигрывают

### Fascicular block

Axis deviation — лишь один из четырёх/пяти признаков. LAFB требует morphology в aVL и inferior
leads плюс R-peak time; LPFB требует противоположные morphology groups. Автоматическое
`LAD → LAFB` или `RAD → LPFB` было бы ложным диагнозом. Минимальное расширение возможно позднее
через ручные трёхсостояниевые поля, но только вместе с подавлением pacing/pre-excitation/ventricular
beats и отдельной размеченной проверкой.

Строгий LPFB-кандидат отдельно проверен на adult human-validated `strat_fold=10` PTB-XL с
опубликованными 12SL measurements PTB-XL+. Одновременные QRS `<120 ms`, axis `90…180°`, `rS` в
I/aVL и `qR` в III/aVF дали `4/15` true positives, `8` false positives и `2166` true negatives:
sensitivity `26,7%`, specificity `99,63%`, PPV `33,3%`. Ложные срабатывания включали normal/RAD,
IRBBB и инфарктные/ST–T записи. Поэтому LPFB не добавлен: без клинического исключения других причин
правой оси даже строгая morphology недостаточна.

### LVH voltage

Sokolow–Lyon уже вычислим, но безопасен только как название совпавшего критерия. В autopsy-validation
Casale et al. его sensitivity была `22%`, specificity `100%`; Cornell дал `42%` и `96%`
соответственно. Это характеристики 135 пациентов того исследования, не ожидаемые метрики MiniMed и
не photo-validation. AHA Part V не рекомендует один критерий вместо остальных и требует называть,
какой именно критерий применён. Для Cornell текущему контракту не хватает `S_V3`.

### AV grades, Q/ST–T и ectopy

Все три направления требуют нового измерительного слоя, а не ещё одного `if`:

- AV grades — последовательность P/QRS и PR по ударам;
- Q/ST–T — fiducials, baseline/J-point и полный contiguous-lead contract;
- ectopy — beat sequence/classification и длительность наблюдения.

Без этого отрицательный результат будет означать «поле отсутствовало», а не «признак отсутствует».

Для положительного ручного workflow добавлен ограниченный beat-sequence contract: различимые P,
не-1:1 проведение, периодический непроведённый P, прогрессивный либо постоянный PR вокруг выпадения,
отдельные флаги 2:1, двух и более последовательных непроведённых P, наличия хотя бы частичного
AV-проведения и AV-диссоциации, плюс явное исключение blocked PAC/стимуляции. Он выдаёт ровно один
совместимый паттерн: Mobitz I, Mobitz II, AV-блокада 2:1, high-grade или complete AV block.

High-grade требует `≥2` последовательных непроведённых P при сохранённом частичном проведении и
отсутствии AV-диссоциации. Complete требует тех же наблюдаемых последовательных P, отсутствия
любого подтверждённого P→QRS проведения и наличия AV-диссоциации. Оба результата имеют статус
`urgent-review`. Неизвестные состояния, 2:1, конфликт `progressive + constant PR`, одновременно
подтверждённые проведение и AV-диссоциация, не исключённый blocked PAC или стимуляция дают
`abstain`; отсутствие паттерна ничего не исключает.

## Валидация на 15 фотографиях

**Нельзя честно валидировать новое правило на существующих 15 фото без соответствующей разметки.**
Если для каждого снимка нет независимого reference `qrsAxisDegrees`/axis class, качества конечностных
отведений, типа доминирующего комплекса, pacing/pre-excitation и протокола разрешения разногласий,
нельзя считать sensitivity, specificity, accuracy или заявлять `15/15`.

Даже 15 корректно размеченных фото были бы только smoke/interop test, а не клиническая validation.
Нужны раздельные проверки:

1. unit/synthetic boundaries rule engine;
2. comparison введённой оси с reference axis исходной цифровой ЭКГ;
3. photo/digitizer error на тех же записях с сохранённым transform manifest;
4. внешняя patient-disjoint выборка с достаточным числом normal/LAD/RAD/extreme и confounders.

Аналогично BBB/NORM labels не могут задним числом служить разметкой axis, LVH, Q/ST–T или ectopy.

Отдельно выполнен локальный rhythm-smoke на 15 изображениях LearnECG: по три `NORM`, `AFIB/AFL`,
`PAC`, `PVC` и `TACHY`. Оцифровщик выдал `usable` только для 6, `review` для 8 и `failed` для 1.
Консервативный short-window RR-кандидат сработал на двух строках с ФП (одна `usable`, одна
`review`), не сработал на примере трепетания и не дал положительного результата в остальных
12 случаях. Это полезный wiring-smoke, но не валидация: общая метка `AFIB/AFL` не является
beat-wise RR-разметкой, фото короче ожидаемой записи, а большинство не прошло quality gate.
Поэтому приложение сохраняет и показывает последовательность RR только как автоматический
черновик; она не переводится в диагноз или подтверждённый признак нерегулярности.

## Лицензирование и допустимое использование

- AHA/ACC/HRS statements и guidelines, JACC articles и Universal Definition — публикации под
  copyright, а не открытая лицензия на копирование таблиц, рисунков или формулировок. AHA требует
  permission для воспроизведения защищённого материала; JACC также направляет повторное
  использование через RightsLink. [AHA policy](https://www.heart.org/en/about-us/statements-and-policies/copyright-permission-guidelines),
  [JACC policy](https://www.jacc.org/policies/reprints-permissions).
- По кандидатам это означает: axis/fascicular и AV grades опираются на copyrighted AHA/ACC/HRS
  statements/guideline; LVH — на copyrighted Part V и original journal papers; Q/ST–T — на
  copyrighted joint Universal Definition и Parts IV/VI; ectopy — на copyrighted Part II и 2017
  ventricular-arrhythmia guideline. Открытой лицензии на воспроизведение их таблиц/текста не найдено.
- Для MiniMed допустимая инженерная стратегия: независимо реализовать числовые сравнения,
  переформулировать результат своими словами и дать точную DOI-ссылку. Не копировать source tables,
  figures, statement wording или vendor algorithms в приложение. Перед коммерческим распространением
  всё равно нужна юридическая проверка; этот документ не является юридическим заключением.
- Original validation papers можно цитировать как результаты конкретных populations. Их пороги и
  метрики не превращаются в лицензию на текст статьи и не являются локальной validation MiniMed.
- Ни один из выбранных unit tests не требует стороннего кода, весов или данных; это независимые
  синтетические числа с source attribution.

## Первичные источники

1. [AHA/ACCF/HRS Part II — diagnostic statement list](https://www.jacc.org/doi/10.1016/j.jacc.2007.01.025).
2. [AHA/ACCF/HRS Part III — axis and intraventricular conduction](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.013).
3. [AHA/ACCF/HRS Part IV — ST, T, U and QT](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.014).
4. [AHA/ACCF/HRS Part V — chamber hypertrophy](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.015).
5. [AHA/ACCF/HRS Part VI — acute ischemia/infarction](https://www.jacc.org/doi/10.1016/j.jacc.2008.12.016).
6. [2018 ACC/AHA/HRS Bradycardia and Conduction Delay Guideline](https://www.ahajournals.org/doi/10.1161/CIR.0000000000000628).
7. [Fourth Universal Definition of Myocardial Infarction (2018)](https://www.jacc.org/doi/10.1016/j.jacc.2018.08.1038).
8. [Casale et al. — prospective/autopsy validation of sex-specific LVH criteria](https://pubmed.ncbi.nlm.nih.gov/2949887/).
9. [Peguero et al. — original LVH criterion and validation](https://www.jacc.org/doi/10.1016/j.jacc.2017.01.037).
10. [2017 AHA/ACC/HRS Ventricular Arrhythmias Guideline](https://www.jacc.org/doi/10.1016/j.jacc.2017.10.054).
