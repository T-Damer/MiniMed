"""Common reading of the sanatorium cards 072/у and 076/у (order 274н, appendices 7 and 9).

Both blanks have the same skeleton: a certificate with the patient, insurance and social-service
lines, a tear-off return coupon («обратный талон»), the clinical reverse side and the conclusion.
The child card adds the educational organisation, the accessible-environment line, the vaccination,
tuberculosis, infection-contact and parasite lines. A `Variant` carries what differs: printed
captions and the paragraph of the «Порядок заполнения» that governs each group of lines. Every
caption is still located in the OCR text of the blank by the preparer, so a wrong reading fails
the build.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Final

from localmed_ingest.medical_form_kit import (
    ICD10_MESSAGE,
    ICD10_PATTERN,
    SNILS_PATTERN,
    address_fields,
    blank,
    check,
    code_field,
    date_blanks,
    field_def,
    field_rule,
    options,
    row,
    text,
)

_ = check  # kept for blueprints that print a check box


@dataclass(frozen=True)
class Variant:
    """What differs between the adult and the child sanatorium card."""

    child: bool
    title: str
    form_label: str
    person_caption: str
    # paragraphs of «Порядок заполнения» (see each blueprint)
    p_identity: str
    p_residence: str
    p_stay: str
    p_education: str | None
    p_oms: str
    p_social_group: str
    p_region: str
    p_climate: str
    p_factors: str
    p_support: str
    p_escort: str
    p_document: str
    p_snils: str
    p_accessible: str | None
    p_clinical: str
    p_infection: str | None
    p_parasites: str | None
    p_voucher: str
    p_paper_sign: str
    p_talon: str
    head_label: str


SNILS_LABEL: Final = "Страховой номер индивидуального лицевого счета"
FAMILY_CAPTION: Final = "(фамилия, имя, отчество (при наличии)"


def talon_rule(variant: Variant, note: str | None = None) -> dict[str, Any]:
    return field_rule(
        "by-line",
        variant.p_talon,
        note=note
        or (
            f"Пункт {variant.p_talon} относит все строки обратного талона к заполнению лечащим "
            "врачом санаторно-курортной организации; содержание отдельной строки порядок не "
            "описывает."
        ),
    )


def _pair(
    field_id: str,
    label: str,
    rule: dict[str, Any],
    icd_label: str,
    *,
    required: bool = False,
    prefill: tuple[str, str] | None = None,
    anchor: str | None = None,
    icd_anchor: str = "код по МКБ",
) -> list[dict[str, Any]]:
    """A diagnosis line and its ICD-10 code blank."""
    text_extra: dict[str, Any] = {"multiline": True, "maxLength": 300}
    icd_extra: dict[str, Any] = {"pattern": ICD10_PATTERN, "patternMessage": ICD10_MESSAGE}
    text_prefill = {"sources": [prefill[0]]} if prefill else None
    icd_prefill = {"sources": [prefill[1]]} if prefill else None
    return [
        field_def(
            field_id,
            label,
            "text",
            rule,
            required=required,
            basis="source" if required else None,
            anchor=anchor or label,
            prefill=text_prefill,
            **text_extra,
        ),
        field_def(
            f"{field_id}Icd",
            icd_label,
            "icd10",
            rule,
            required=required,
            basis="source" if required else None,
            anchor=icd_anchor,
            prefill=icd_prefill,
            **icd_extra,
        ),
    ]


def build_fields(v: Variant) -> list[dict[str, Any]]:
    clinical = field_rule("defined", v.p_clinical)
    talon = talon_rule(v)
    sig_head = field_rule("defined", v.p_paper_sign)
    sig_talon = field_rule("defined", v.p_talon)
    fields: list[dict[str, Any]] = [
        field_def(
            "formNumber",
            v.form_label,
            "text",
            field_rule("undefined", note="Порядок не определяет нумерацию карт."),
            maxLength=40,
        ),
        field_def(
            "formDate",
            "Дата карты",
            "date",
            field_rule(
                "undefined",
                note="Порядок не определяет дату карты на бумажном бланке.",
            ),
            required=True,
            basis="editorial",
            printed=False,
            anchor="года",
            prefill={"sources": ["today"]},
        ),
        field_def(
            "organization",
            "Наименование и адрес медицинской организации (фамилия, имя, отчество (при наличии) "
            "индивидуального предпринимателя и адрес осуществления медицинской деятельности)",
            "text",
            field_rule("undefined", note="Порядок не описывает заполнение шапки."),
            required=True,
            basis="editorial",
            anchor="Наименование и адрес медицинской организации",
            prefill={"sources": ["organization.name", "organization.address"], "join": ", "},
            multiline=True,
            maxLength=400,
        ),
        field_def(
            "organizationOgrn",
            "Основной государственный регистрационный номер (Основной государственный "
            "регистрационный номер индивидуального предпринимателя)",
            "text",
            field_rule("undefined", note="Порядок не описывает заполнение шапки."),
            required=True,
            basis="editorial",
            anchor="Основной государственный регистрационный номер",
            prefill={"sources": ["organization.ogrn"]},
            pattern="^(?:[0-9]{13}|[0-9]{15})$",
            patternMessage="ОГРН — 13 цифр, ОГРНИП — 15 цифр",
        ),
        field_def(
            "patientFullName",
            v.person_caption,
            "text",
            field_rule("defined", v.p_identity),
            required=True,
            prefill={"sources": ["patient.fullName"]},
            maxLength=200,
        ),
        field_def(
            "patientBirthDate",
            "Дата рождения",
            "date",
            field_rule("defined", v.p_identity),
            required=True,
            prefill={"sources": ["patient.birthDate"]},
            notAfter="today",
        ),
        field_def(
            "patientSex",
            "Пол",
            "choice",
            field_rule("defined", v.p_identity),
            required=True,
            prefill={"sources": ["patient.sex"], "map": {"male": "1", "female": "2"}},
            options=[{"value": "1", "label": "муж."}, {"value": "2", "label": "жен."}],
            anchor="Пол: муж. - 1, жен. - 2",
        ),
        *address_fields(
            "residence",
            "Регистрация по месту жительства: субъект Российской Федерации",
            "address",
            f"Пункт {v.p_residence} называет строку «Регистрация по месту жительства» целиком; "
            "её части (район, улица, телефон и др.) порядок отдельно не определяет.",
            v.p_residence,
        ),
        *address_fields(
            "stay",
            "Регистрация по месту пребывания: субъект Российской Федерации",
            "stayAddress",
            f"Пункт {v.p_stay} называет строку «Регистрация по месту пребывания» целиком; "
            "её части (район, улица, телефон и др.) порядок отдельно не определяет.",
            v.p_stay,
        ),
    ]
    if v.child and v.p_education:
        edu = field_rule("defined", v.p_education)
        fields += [
            field_def(
                "educationType",
                "Образовательная организация: тип",
                "text",
                edu,
                maxLength=120,
            ),
            field_def("educationNumber", "№", "text", edu, anchor="структурное", maxLength=40),
            field_def(
                "educationUnit",
                "структурное подразделение",
                "text",
                field_rule(
                    "by-line",
                    v.p_education,
                    note=(
                        f"Пункт {v.p_education} называет строку «Образовательная организация»; "
                        "номер и структурное подразделение порядок отдельно не определяет."
                    ),
                ),
                maxLength=120,
            ),
        ]
    oms = field_rule("defined", v.p_oms)
    fields += [
        field_def(
            "omsPolicyNumber",
            "Полис обязательного медицинского страхования",
            "text",
            oms,
            required=True,
            prefill={"sources": ["patient.omsPolicy.number"]},
            maxLength=60,
        ),
        field_def(
            "omsPolicyIssueDate",
            "дата выдачи полиса обязательного медицинского страхования",
            "date",
            oms,
            required=True,
            prefill={"sources": ["patient.omsPolicy.issuedAt"]},
            notAfter="today",
        ),
        field_def(
            "omsInsurer",
            "данные о страховой медицинской организации, выбранной застрахованным лицом или "
            "определенной застрахованному лицу",
            "text",
            oms,
            required=True,
            anchor="данные о страховой медицинской организации",
            prefill={"sources": ["patient.omsPolicy.insurer"]},
            multiline=True,
            maxLength=300,
        ),
        code_field(
            "regionCode",
            "Код субъекта Российской Федерации",
            "Код субъекта",
            (v.p_social_group, v.p_region),
        ),
        code_field(
            "climateCode",
            "Климат в месте проживания пациента (код)",
            "Климат в месте проживания пациента",
            (v.p_social_group, v.p_climate),
        ),
        code_field(
            "climateFactorsCode",
            "Климатические факторы в месте проживания пациента (код)"
            if not v.child
            else "Климатические факторы в месте проживания",
            "Климатические факторы в месте проживания",
            (v.p_social_group, v.p_factors),
        ),
        code_field(
            "socialSupportCode",
            "Код меры социальной поддержки",
            "Код меры социальной поддержки",
            (v.p_social_group, v.p_support),
        ),
        field_def(
            "escort",
            "Сопровождение",
            "choice",
            field_rule("defined", v.p_social_group, v.p_escort),
            options=[{"value": "1", "label": "да"}, {"value": "2", "label": "нет"}],
            anchor="Сопровождение: да - 1, нет - 2",
        ),
        field_def(
            "socialDocSeries",
            "Документ, подтверждающий право на получение мер социальной поддержки в виде набора "
            "социальных услуг: серия",
            "text",
            field_rule("defined", v.p_social_group, v.p_document),
            anchor="Документ, подтверждающий право на получение мер социальной поддержки",
            maxLength=40,
        ),
        field_def(
            "socialDocNumber",
            "номер",
            "text",
            field_rule("defined", v.p_social_group, v.p_document),
            anchor="номер",
            maxLength=40,
        ),
        field_def(
            "socialDocIssueDate",
            "дата выдачи",
            "date",
            field_rule("defined", v.p_social_group, v.p_document),
            anchor="дата выдачи",
            notAfter="today",
        ),
        field_def(
            "snils",
            SNILS_LABEL,
            "text",
            field_rule("defined", v.p_snils),
            required=True,
            prefill={"sources": ["patient.snils"]},
            pattern=SNILS_PATTERN,
            patternMessage="СНИЛС в формате 123-456-789 01",
        ),
    ]
    if v.child and v.p_accessible:
        access = field_rule("defined", v.p_accessible)
        fields += [
            field_def(
                "accessibleEnvironment",
                "Нуждаемость в условиях доступной среды",
                "choice",
                access,
                options=[{"value": "1", "label": "да"}, {"value": "2", "label": "нет"}],
                anchor="Нуждаемость в условиях доступной среды: да - 1, нет - 2",
            ),
            field_def(
                "accessibleEnvironmentDetails",
                "Нуждаемость в условиях доступной среды (пандусы, поручни, кресла-коляски и др.)",
                "text",
                access,
                printed=False,
                multiline=True,
                maxLength=300,
            ),
        ]
    # ---- return coupon on the front side (filled by the sanatorium doctor, paragraph talon)
    fields += [
        field_def(
            "returnOrgName",
            "Наименование санаторно-курортной организации (обратный талон)",
            "text",
            talon,
            anchor="Наименование санаторно-курортной организации",
            maxLength=200,
        ),
        field_def(
            "returnOrgOgrn",
            "Основной государственный регистрационный номер санаторно-курортной организации",
            "text",
            talon,
            anchor="Основной государственный регистрационный номер санаторно-курортной организации",
            pattern="^(?:[0-9]{13}|[0-9]{15})$",
            patternMessage="ОГРН — 13 цифр, ОГРНИП — 15 цифр",
        ),
        field_def(
            "returnPatientName",
            "Фамилия, имя, отчество (при наличии) пациента (обратный талон)",
            "text",
            talon,
            anchor="Фамилия, имя, отчество (при наличии) пациента",
            prefill={"sources": ["patient.fullName"]},
            maxLength=200,
        ),
        field_def(
            "periodFrom",
            "Период санаторно-курортного лечения: с",
            "date",
            talon,
            anchor="Период санаторно-курортного лечения",
        ),
        field_def("periodTo", "по", "date", talon, anchor="г. по"),
        *_pair(
            "referralMain",
            "Основное заболевание (диагноз, установленный направившей медицинской организацией)",
            talon,
            "код по МКБ (основное заболевание, направившая организация)",
            prefill=("episode.diagnosis.text", "episode.diagnosis.icd10"),
            anchor="Диагноз, установленный направившей медицинской организацией",
            icd_anchor="код по Международной статистической классификации болезней",
        ),
        *_pair(
            "referralComplications",
            "Осложнения основного заболевания (направившая организация)",
            talon,
            "код по МКБ (осложнения, направившая организация)",
            anchor="Осложнения основного заболевания",
        ),
        *_pair(
            "referralComorbidities",
            "Сопутствующие заболевания (направившая организация)",
            talon,
            "код по МКБ (сопутствующие заболевания, направившая организация)",
            anchor="Сопутствующие заболевания",
        ),
        *_pair(
            "referralExternalCause",
            "Внешняя причина (при травмах, отравлениях) (направившая организация)",
            talon,
            "код по МКБ (внешняя причина, направившая организация)",
            anchor="Внешняя причина (при травмах, отравлениях)",
        ),
        *_pair(
            "referralDisabilityCause",
            "Заболевание, явившееся причиной инвалидности (направившая организация)",
            talon,
            "код по МКБ (причина инвалидности, направившая организация)",
            anchor="Заболевание, явившееся причиной инвалидности",
        ),
        *_pair(
            "dischargeMain",
            "Основное заболевание (диагноз при выписке из санаторно-курортной организации)",
            talon,
            "код по МКБ (основное заболевание при выписке)",
            anchor="Диагноз при выписке из санаторно-курортной организации",
        ),
        *_pair(
            "dischargeComorbidities",
            "Сопутствующие заболевания (при выписке)",
            talon,
            "код по МКБ (сопутствующие заболевания при выписке)",
            anchor="Сопутствующие заболевания",
        ),
    ]
    # ---- reverse side: clinical part
    fields += [
        field_def(
            "complaints",
            "Жалобы",
            "text",
            clinical,
            multiline=True,
            maxLength=1000,
        ),
        field_def(
            "anamnesis",
            "Анамнез заболевания (включая данные о предшествующем лечении, в том числе "
            "санаторно-курортном)",
            "text",
            clinical,
            multiline=True,
            maxLength=2000,
            anchor="Анамнез заболевания",
        ),
    ]
    if v.child:
        fields += [
            field_def(
                "allergies",
                "Аллергические заболевания (пищевая, лекарственная, бытовая аллергия), "
                "аллергические реакции",
                "text",
                clinical,
                multiline=True,
                maxLength=500,
                anchor="Аллергические заболевания",
            ),
        ]
        for index in (1, 2, 3):
            fields += [
                field_def(
                    f"vaccine{index}Name",
                    f"наименование вакцинации ({index})",
                    "text",
                    clinical,
                    anchor="наименование вакцинации",
                    maxLength=200,
                ),
                field_def(
                    f"vaccine{index}Date",
                    f"дата вакцинации ({index})",
                    "date",
                    clinical,
                    anchor="дата",
                    notAfter="today",
                ),
            ]
        fields += [
            field_def(
                "tuberculosisExamName",
                "Результаты обследований в целях выявления туберкулеза: наименование исследования",
                "text",
                clinical,
                anchor="Результаты обследований в целях выявления туберкулеза",
                maxLength=200,
            ),
            field_def(
                "tuberculosisExamDate",
                "дата исследования в целях выявления туберкулеза",
                "date",
                clinical,
                anchor="дата",
                notAfter="today",
            ),
        ]
    fields += [
        field_def(
            "examinations",
            "Данные клинического, лабораторного, рентгенологического и других исследований "
            "(даты проведения исследований)",
            "text",
            clinical,
            multiline=True,
            maxLength=3000,
            anchor="Данные клинического, лабораторного, рентгенологического и других исследований",
        ),
        *_pair(
            "mainDiagnosis",
            "Диагноз основного заболевания",
            clinical,
            "код по МКБ (основное заболевание)",
            required=True,
            prefill=("episode.diagnosis.text", "episode.diagnosis.icd10"),
        ),
        *_pair(
            "complications",
            "Осложнения основного заболевания",
            clinical,
            "код по МКБ (осложнения)",
        ),
        *_pair(
            "externalCause",
            "Внешняя причина при травмах, отравлениях",
            clinical,
            "код по МКБ (внешняя причина)",
        ),
    ]
    for index in (1, 2, 3):
        fields += _pair(
            f"comorbidity{index}",
            f"Сопутствующие заболевания ({index})",
            clinical,
            f"код по МКБ (сопутствующие заболевания {index})",
            anchor="Сопутствующие заболевания" if index == 1 else "код по МКБ",
        )
    fields += [
        field_def(
            "additionalInfo",
            "Дополнительные сведения о заболевании",
            "text",
            clinical,
            multiline=True,
            maxLength=1000,
        ),
        *_pair(
            "disabilityCause",
            "Заболевание, явившееся причиной инвалидности",
            clinical,
            "код по МКБ (причина инвалидности)",
        ),
    ]
    if v.child and v.p_infection and v.p_parasites:
        infection = field_rule("defined", v.p_infection)
        parasites = field_rule("defined", v.p_parasites)
        fields += [
            field_def(
                "noInfectionContact",
                "Отсутствие контакта с больными инфекционными заболеваниями",
                "text",
                infection,
                maxLength=300,
            ),
            field_def(
                "pediculosisExam",
                "Осмотр на педикулез и чесотку",
                "text",
                parasites,
                maxLength=300,
            ),
            field_def(
                "helminthExam",
                "Обследование на гельминтозы (энтеробиоз, гименолепидоз)",
                "text",
                parasites,
                maxLength=300,
                anchor="Обследование на гельминтозы",
            ),
        ]
    voucher = field_rule("defined", v.p_voucher)
    fields += [
        field_def(
            "conclusionOrgName",
            "Наименование санаторно-курортной организации (заключение)",
            "text",
            voucher,
            required=True,
            basis="source",
            anchor="Наименование санаторно-курортной организации",
            maxLength=200,
        ),
        field_def(
            "treatmentSetting",
            "Лечение",
            "choice",
            voucher,
            required=True,
            basis="source",
            options=[
                {"value": "1", "label": "в условиях пребывания в санаторно-курортной организации"},
                {"value": "2", "label": "амбулаторно"},
            ],
            anchor="Лечение: в условиях пребывания в санаторно-курортной организации",
        ),
        field_def(
            "courseDays",
            "Продолжительность курса лечения",
            "text",
            voucher,
            required=True,
            basis="source",
            anchor="Продолжительность курса лечения",
            pattern="^[0-9]{1,3}$",
            patternMessage="Число дней, например 21",
            maxLength=3,
        ),
        field_def(
            "voucherNumber",
            "Путевка №",
            "text",
            voucher,
            required=True,
            basis="source",
            maxLength=40,
        ),
        field_def(
            "filledBy",
            "Фамилия, имя, отчество (при наличии) и подпись лица, заполнившего карту",
            "text",
            field_rule(
                "by-line",
                v.p_paper_sign,
                note=(
                    f"Пункт {v.p_paper_sign} говорит, что бумажная карта заверяется медицинским "
                    "работником; строку «лица, заполнившего карту» порядок отдельно не описывает."
                ),
            ),
            required=True,
            basis="editorial",
            anchor="Фамилия, имя, отчество (при наличии) и подпись лица, заполнившего карту",
            prefill={"sources": ["clinician.fullName"]},
            maxLength=200,
        ),
        field_def(
            "filledBySignature",
            "подпись лица, заполнившего карту",
            "signature",
            sig_head,
            anchor="подпись лица, заполнившего карту",
        ),
        field_def(
            "headOfDepartment",
            v.head_label,
            "text",
            sig_head,
            anchor="Заведующий отделением",
            maxLength=200,
        ),
        field_def(
            "headOfDepartmentSignature",
            "подпись заведующего отделением (председателя врачебной комиссии)",
            "signature",
            sig_head,
            anchor="подпись",
        ),
        field_def("stamp", "М.П. (при наличии)", "stamp", sig_head, anchor="М.П."),
        # ---- tear-off return coupon, reverse side
        field_def(
            "treatmentDone",
            "Проведено лечение (виды лечения, количество процедур, их переносимость, даты "
            "проведения санаторно-курортного лечения)",
            "text",
            talon,
            anchor="Проведено лечение",
            multiline=True,
            maxLength=1500,
        ),
        field_def(
            "epicrisis",
            "Эпикриз (включая данные обследования)",
            "text",
            talon,
            anchor="Эпикриз",
            multiline=True,
            maxLength=2000,
        ),
        field_def(
            "treatmentResult",
            "Результат санаторно-курортного лечения",
            "choice",
            talon,
            options=[
                {"value": "1", "label": "значительное улучшение"},
                {"value": "2", "label": "улучшение"},
                {"value": "3", "label": "без перемен"},
                {"value": "4", "label": "ухудшение"},
            ],
            anchor="Результат санаторно-курортного лечения: значительное улучшение",
        ),
        field_def(
            "exacerbations",
            "Наличие обострений, потребовавших отмену процедур",
            "choice",
            talon,
            options=[{"value": "1", "label": "да"}, {"value": "2", "label": "нет"}],
            anchor="Наличие обострений, потребовавших отмену процедур: да - 1, нет - 2",
        ),
        field_def(
            "recommendations",
            "Рекомендации по дальнейшему лечению",
            "text",
            talon,
            multiline=True,
            maxLength=1500,
        ),
    ]
    if v.child:
        fields.append(
            field_def(
                "talonInfectionContact",
                "Контакт с пациентами, больными инфекционными заболеваниями",
                "text",
                talon,
                maxLength=300,
            )
        )
    fields += [
        field_def(
            "treatingDoctor",
            "Лечащий врач, должность врача-специалиста",
            "text",
            sig_talon,
            maxLength=200,
        ),
        field_def(
            "treatingDoctorSignature",
            "подпись лечащего врача",
            "signature",
            sig_talon,
            anchor="подпись",
        ),
        field_def(
            "chiefDoctor",
            "Главный врач санаторно-курортной организации",
            "text",
            sig_talon,
            maxLength=200,
        ),
        field_def(
            "chiefDoctorSignature",
            "подпись главного врача",
            "signature",
            sig_talon,
            anchor="подпись",
        ),
        field_def(
            "returnStamp",
            "М.П. (при наличии) (обратный талон)",
            "stamp",
            sig_talon,
            anchor="М.П. (при наличии)",
        ),
    ]
    return fields


# --------------------------------------------------------------------------- screen sections


def _address_ids(prefix: str) -> list[str]:
    return [
        f"{prefix}{part}"
        for part in (
            "Subject",
            "District",
            "Locality",
            "Street",
            "House",
            "Building",
            "Apartment",
            "Phone",
        )
    ]


def build_sections(v: Variant) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = [
        {"id": "certificate", "title": "Карта", "fieldIds": ["formNumber", "formDate"]},
        {
            "id": "organization",
            "title": "Организация",
            "description": "Подставляется из настроек «Врач и организация».",
            "fieldIds": ["organization", "organizationOgrn"],
        },
        {
            "id": "patient",
            "title": "Ребёнок" if v.child else "Пациент",
            "fieldIds": ["patientFullName", "patientBirthDate", "patientSex", "snils"],
        },
        {
            "id": "residence",
            "title": "Регистрация по месту жительства",
            "fieldIds": _address_ids("residence"),
        },
        {
            "id": "stay",
            "title": "Регистрация по месту пребывания",
            "fieldIds": _address_ids("stay"),
        },
    ]
    if v.child:
        sections.append(
            {
                "id": "education",
                "title": "Образовательная организация",
                "description": (
                    "Тип организации, которую посещает ребёнок; для не посещающих делается "
                    "отметка «не организованный» (п. 7.4)."
                ),
                "fieldIds": ["educationType", "educationNumber", "educationUnit"],
            }
        )
    social_ids = [
        "regionCode",
        "climateCode",
        "climateFactorsCode",
        "socialSupportCode",
        "escort",
        "socialDocSeries",
        "socialDocNumber",
        "socialDocIssueDate",
    ]
    sections += [
        {
            "id": "oms",
            "title": "Полис обязательного медицинского страхования",
            "fieldIds": ["omsPolicyNumber", "omsPolicyIssueDate", "omsInsurer"],
        },
        {
            "id": "social",
            "title": "Набор социальных услуг",
            "description": (
                "Заполняется только на граждан, имеющих право на набор социальных услуг "
                f"(п. {v.p_social_group})."
            ),
            "fieldIds": social_ids
            + (["accessibleEnvironment", "accessibleEnvironmentDetails"] if v.child else []),
        },
    ]
    clinical_ids = ["complaints", "anamnesis"]
    if v.child:
        clinical_ids += ["allergies"]
        for index in (1, 2, 3):
            clinical_ids += [f"vaccine{index}Name", f"vaccine{index}Date"]
        clinical_ids += ["tuberculosisExamName", "tuberculosisExamDate"]
    clinical_ids += [
        "examinations",
        "mainDiagnosis",
        "mainDiagnosisIcd",
        "complications",
        "complicationsIcd",
        "externalCause",
        "externalCauseIcd",
    ]
    for index in (1, 2, 3):
        clinical_ids += [f"comorbidity{index}", f"comorbidity{index}Icd"]
    clinical_ids += ["additionalInfo", "disabilityCause", "disabilityCauseIcd"]
    if v.child:
        clinical_ids += ["noInfectionContact", "pediculosisExam", "helminthExam"]
    sections += [
        {
            "id": "clinical",
            "title": "Состояние здоровья",
            "description": (
                f"Заполняется по данным формы № 025/у, код по МКБ указывается обязательно "
                f"(п. {v.p_clinical})."
            ),
            "fieldIds": clinical_ids,
        },
        {
            "id": "conclusion",
            "title": "Заключение",
            "description": f"По представленной путёвке (п. {v.p_voucher}).",
            "fieldIds": [
                "conclusionOrgName",
                "treatmentSetting",
                "courseDays",
                "voucherNumber",
                "filledBy",
                "headOfDepartment",
            ],
        },
        {
            "id": "returnFront",
            "title": "Обратный талон: направление и диагноз",
            "description": (
                f"Все строки обратного талона заполняет лечащий врач санаторно-курортной "
                f"организации (п. {v.p_talon}); при необходимости их можно заполнить заранее."
            ),
            "fieldIds": [
                "returnOrgName",
                "returnOrgOgrn",
                "returnPatientName",
                "periodFrom",
                "periodTo",
                "referralMain",
                "referralMainIcd",
                "referralComplications",
                "referralComplicationsIcd",
                "referralComorbidities",
                "referralComorbiditiesIcd",
                "referralExternalCause",
                "referralExternalCauseIcd",
                "referralDisabilityCause",
                "referralDisabilityCauseIcd",
                "dischargeMain",
                "dischargeMainIcd",
                "dischargeComorbidities",
                "dischargeComorbiditiesIcd",
            ],
        },
        {
            "id": "returnBack",
            "title": "Обратный талон: результат лечения",
            "fieldIds": [
                "treatmentDone",
                "epicrisis",
                "treatmentResult",
                "exacerbations",
                "recommendations",
                *(["talonInfectionContact"] if v.child else []),
                "treatingDoctor",
                "chiefDoctor",
            ],
        },
    ]
    return sections


# ------------------------------------------------------------------------------- print layout
#
# The print follows the official scan line by line (docs/FORMS_PLAN.md «Layout fidelity»): every
# row is one printed line of the blank, a justified line is a `stretch` row, a line the blank
# rules out under a label is a `rule` segment, and the continuation lines of a long entry are the
# ruled `lines` of the entry field one row below. The two sides of the sheet are scanned with
# different margins (the text of the front starts 4.8 mm further right than the reverse), so the
# blocks of each side carry an `insetMm` that keeps both sides on the edges of the scan.


def _rule(*, dotted: bool = False) -> dict[str, Any]:
    segment: dict[str, Any] = {"kind": "rule", "length": 10, "grow": True}
    if dotted:
        segment["lineStyle"] = "dotted"
    return segment


def _ruled(field_id: str, count: int) -> dict[str, Any]:
    """`count` ruled lines (one text line apart) for a long entry, the lines under its label."""
    return row({**blank(field_id, 10, grow=True, lines=count), "pitch": "text"})


def _plain_block(block_id: str, rows: list[dict[str, Any]], **extra: Any) -> dict[str, Any]:
    return {"id": block_id, "columns": [{"widthPercent": 100, "rows": rows}], **extra}


def _pair_row(
    label: str, field_id: str, length: float = 30, icd_length: float = 14
) -> dict[str, Any]:
    return row(
        text(label),
        blank(field_id, length, grow=True),
        text("код по МКБ"),
        blank(f"{field_id}Icd", icd_length),
    )


def _stub(field_id: str) -> dict[str, Any]:
    """The signature line of a form whose scan prints no «подпись» caption of its own.

    The scan runs one rule for the name and the signature and captions both under it; the signature
    segment is a stub at the end of that rule (no caption: a blank caption takes no height) so the
    field stays on the printed blank while the captions are the text row below.
    """
    return {"kind": "signature", "fieldId": field_id, "length": 1, "caption": " "}


def _date(
    field_id: str, *, month_length: float, year_length: float = 3, day_length: float = 3
) -> list[dict[str, Any]]:
    """`«__» ______ 20__` with the closing quote and the century set tight against their blanks."""
    segments = date_blanks(field_id, month_length=month_length, year_length=year_length)
    result: list[dict[str, Any]] = []
    for segment in segments:
        if segment.get("text") in ("»", "20"):
            segment = {**segment, "joined": True}
        elif segment.get("part") == "day":
            segment = {**segment, "length": day_length}
        result.append(segment)
    return result


def _caption(value: str, indent_mm: float) -> dict[str, Any]:
    """A small caption that starts `indent_mm` from the left edge of its printed line."""
    return {**text(value, small=True), "indentMm": indent_mm}


def _lines(*texts: str) -> list[dict[str, Any]]:
    """Text rows, one per printed line of the original."""
    return [row(text(value)) for value in texts]


def _address_rows(
    prefix: str, caption: str, district_length: float, locality_length: float
) -> list[dict[str, Any]]:
    return [
        row(text(caption), blank(f"{prefix}Subject", 30, grow=True)),
        row(
            text("район"),
            blank(f"{prefix}District", district_length, grow=True),
            text("населенный пункт"),
            blank(f"{prefix}Locality", locality_length, grow=True),
        ),
        row(
            text("улица"),
            blank(f"{prefix}Street", 35, grow=True),
            text("дом"),
            blank(f"{prefix}House", 4),
            text("строение/корпус"),
            blank(f"{prefix}Building", 4),
            text("квартира"),
            blank(f"{prefix}Apartment", 6),
            text("тел."),
            blank(f"{prefix}Phone", 20, grow=True),
        ),
    ]


def _header_block(form_number: str) -> dict[str, Any]:
    return {
        "id": "header",
        "columns": [
            {
                "widthPercent": 44,
                "align": "left",
                "rows": [
                    *_lines(
                        "Наименование и адрес медицинской организации",
                        "(фамилия, имя, отчество (при наличии)",
                        "индивидуального предпринимателя и адрес",
                        "осуществления медицинской деятельности)",
                    ),
                    row(text("Основной государственный регистрационный"), align="stretch"),
                    *_lines(
                        "номер",
                        "(Основной государственный регистрационный",
                        "номер индивидуального предпринимателя)",
                    ),
                    row(blank("organization", 40, grow=True), gap="small"),
                    row(blank("organizationOgrn", 40, grow=True)),
                ],
            },
            {
                "widthPercent": 38,
                "align": "center",
                "rows": [
                    row(text("Медицинская документация")),
                    row(text(f"Учетная форма № {form_number}")),
                    row(text("Утверждена приказом Министерства"), gap="small"),
                    row(text("здравоохранения Российской Федерации")),
                    row(text("от 13 мая 2025 г. № 274н")),
                ],
            },
        ],
    }


def _front_rows(v: Variant, form_number: str) -> dict[str, list[dict[str, Any]]]:
    person = "ребенка" if v.child else "пациента"
    title = [
        row(
            text(v.form_label, bold=True),
            blank("formNumber", 9),
            align="center",
            size="title",
            gap="large",
        ),
        row(
            *_date("formDate", month_length=22, day_length=5.5),
            text("года", bold=True),
            align="center",
            size="title",
        ),
    ]
    patient: list[dict[str, Any]] = [
        row(
            text(
                "Выдается при предъявлении путевки на санаторно-курортное лечение. Без "
                "настоящей карты путевка"
            ),
            align="stretch",
            gap="medium",
        ),
        row(text("недействительна." if v.child else "недействительна")),
        row(
            text(f"Фамилия, имя, отчество (при наличии) {person}"),
            blank("patientFullName", 40, grow=True),
            gap="medium",
        ),
        row(
            text("Дата рождения:"),
            *_date("patientBirthDate", month_length=10),
            text("г."),
            text("Пол:"),
            options("patientSex"),
        ),
        *_address_rows(
            "residence", "Регистрация по месту жительства: субъект Российской Федерации", 62, 38
        ),
        *_address_rows(
            "stay", "Регистрация по месту пребывания: субъект Российской Федерации", 48, 28
        ),
    ]
    if v.child:
        patient.append(
            row(
                text("Образовательная организация: тип"),
                blank("educationType", 20, grow=True),
                text("№"),
                blank("educationNumber", 10),
                text("структурное подразделение"),
                blank("educationUnit", 8),
            )
        )
    insurance = [
        row(
            text("Полис обязательного медицинского страхования:"),
            blank("omsPolicyNumber", 40, grow=True),
        ),
        row(
            text("дата выдачи полиса обязательного медицинского страхования"),
            *_date("omsPolicyIssueDate", month_length=12, year_length=6),
            text("г."),
        ),
        row(
            text(
                "данные о страховой медицинской организации, выбранной застрахованным лицом "
                "или определенной"
            ),
            align="stretch",
        ),
        row(text("застрахованному лицу"), blank("omsInsurer", 40, grow=True)),
    ]
    factors_caption = (
        "Климатические факторы в месте проживания"
        if v.child
        else "Климатические факторы в месте проживания пациента (код)"
    )
    social = [
        row(text("Код субъекта Российской Федерации"), blank("regionCode", 6)),
        row(text("Климат в месте проживания пациента (код)"), blank("climateCode", 5)),
        row(text(factors_caption), blank("climateFactorsCode", 8 if v.child else 6)),
        row(text("Код меры социальной поддержки"), blank("socialSupportCode", 8)),
        row(text("Сопровождение: да – 1, нет - 2"), blank("escort", 11)),
        row(
            text(
                "Документ, подтверждающий право на получение мер социальной поддержки в "
                "виде набора социальных услуг:"
            )
        ),
        row(
            text("серия"),
            blank("socialDocSeries", 11),
            text("номер"),
            blank("socialDocNumber", 17),
            text("дата выдачи"),
            *_date("socialDocIssueDate", month_length=11),
            text("г."),
        ),
        row(text(f"{SNILS_LABEL}:"), blank("snils", 44)),
    ]
    if v.child:
        social += [
            row(
                text("Нуждаемость в условиях доступной среды: да – 1, нет - 2"),
                blank("accessibleEnvironment", 10),
            ),
            row(blank("accessibleEnvironmentDetails", 40, grow=True)),
        ]
    del form_number
    return {"title": title, "patient": patient, "insurance": insurance, "social": social}


def _coupon_front_rows(v: Variant) -> list[dict[str, Any]]:
    return [
        row(_rule(dotted=True)),
        row(text("линия отреза"), align="center", size="small"),
        row(
            text("Подлежит возврату в медицинскую организацию, выдавшую санаторно-курортную карту"),
            align="center",
            size="small",
        ),
        row(text("Обратный талон"), align="center", gap="medium"),
        row(
            text("Наименование санаторно-курортной организации"),
            blank("returnOrgName", 40, grow=True),
        ),
        row(
            text("Основной государственный регистрационный номер санаторно-курортной организации"),
            blank("returnOrgOgrn", 20, grow=True),
        ),
        row(
            text("Фамилия, имя, отчество (при наличии) пациента"),
            blank("returnPatientName", 40, grow=True),
        ),
        row(
            text("Период санаторно-курортного лечения: с"),
            *_date("periodFrom", month_length=12),
            text("г. по"),
            *_date("periodTo", month_length=12),
            text("г."),
        ),
        row(text("Диагноз, установленный направившей медицинской организацией:")),
        row(text("Основное заболевание"), blank("referralMain", 40, grow=True)),
        row(
            text(
                "код по Международной статистической классификации болезней и проблем, "
                "связанных со здоровьем"
            ),
            align="stretch",
        ),
        row(text("(далее – МКБ)"), blank("referralMainIcd", 27 if v.child else 12)),
        _pair_row("Осложнения основного заболевания", "referralComplications", icd_length=20),
        _pair_row("Сопутствующие заболевания:", "referralComorbidities", icd_length=20),
        _pair_row(
            "Внешняя причина (при травмах, отравлениях)", "referralExternalCause", icd_length=19
        ),
        _pair_row(
            "Заболевание, явившееся причиной инвалидности:", "referralDisabilityCause", 22, 19
        ),
        row(text("Диагноз при выписке из санаторно-курортной организации:")),
        _pair_row("Основное заболевание", "dischargeMain", icd_length=20),
        _pair_row("Сопутствующие заболевания:", "dischargeComorbidities", icd_length=20),
    ]


def _clinical_rows(v: Variant, form_number: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = [
        row(text("оборотная сторона ф. № " + form_number, small=True), align="right", size="small"),
        row(text("Жалобы"), _rule()),
        _ruled("complaints", 1),
        row(
            text(
                "Анамнез заболевания (включая данные о предшествующем лечении, в том числе "
                "санаторно-курортном)"
            ),
            _rule(),
        ),
        _ruled("anamnesis", 3 if v.child else 2),
    ]
    if v.child:
        rows += [
            row(
                text(
                    "Аллергические заболевания (пищевая, лекарственная, бытовая аллергия), "
                    "аллергические реакции:"
                ),
                _rule(),
            ),
            _ruled("allergies", 1),
            row(text("Проведенные профилактические прививки:")),
        ]
        for index in (1, 2, 3):
            rows.append(
                row(
                    text("наименование вакцинации:"),
                    blank(f"vaccine{index}Name", 30, grow=True),
                    text("дата:"),
                    *_date(f"vaccine{index}Date", month_length=10),
                    text("г."),
                )
            )
        rows += [
            row(text("Результаты обследований в целях выявления туберкулеза")),
            row(
                text("наименование исследования"),
                blank("tuberculosisExamName", 30, grow=True),
                text("дата:"),
                *_date("tuberculosisExamDate", month_length=10),
                text("г."),
            ),
        ]
    rows += [
        row(
            text(
                "Данные клинического, лабораторного, рентгенологического и других "
                "исследований (даты проведения"
            ),
            align="stretch",
        ),
        row(text("исследований)"), _rule()),
        _ruled("examinations", 2 if v.child else 8),
        _pair_row("Диагноз основного заболевания:", "mainDiagnosis"),
        _pair_row("Осложнения основного заболевания", "complications"),
        _pair_row("Внешняя причина при травмах, отравлениях", "externalCause"),
        _pair_row("Сопутствующие заболевания:", "comorbidity1"),
        row(blank("comorbidity2", 30, grow=True), text("код по МКБ"), blank("comorbidity2Icd", 14)),
        row(blank("comorbidity3", 30, grow=True), text("код по МКБ"), blank("comorbidity3Icd", 14)),
        row(text("Дополнительные сведения о заболевании"), _rule()),
        _ruled("additionalInfo", 2 if v.child else 3),
        _pair_row("Заболевание, явившееся причиной инвалидности:", "disabilityCause", 22),
    ]
    if v.child:
        rows += [
            row(
                text("Отсутствие контакта с больными инфекционными заболеваниями"),
                blank("noInfectionContact", 20, grow=True),
            ),
            row(text("Осмотр на педикулез и чесотку"), blank("pediculosisExam", 20, grow=True)),
            row(
                text("Обследование на гельминтозы (энтеробиоз, гименолепидоз)"),
                blank("helminthExam", 20, grow=True),
            ),
        ]
    return rows


def _conclusion_rows(v: Variant) -> list[dict[str, Any]]:
    # 072/у: a justified title line with the name line under it; 076/у: the title and the name
    # line share one printed line. The captions sit under the line in both.
    head = (
        [
            row(
                text(v.head_label),
                blank("headOfDepartment", 30, grow=True),
                _stub("headOfDepartmentSignature"),
            ),
            row(_caption(FAMILY_CAPTION, 93.6), _caption("подпись", 3.5)),
        ]
        if v.child
        else [
            row(text(v.head_label), align="stretch"),
            row(blank("headOfDepartment", 47), _stub("headOfDepartmentSignature")),
            row(_caption(FAMILY_CAPTION, 93.6), _caption("подпись", 3.5)),
        ]
    )
    return [
        row(text("ЗАКЛЮЧЕНИЕ"), align="center", gap="medium"),
        row(
            text("Наименование санаторно-курортной организации"),
            blank("conclusionOrgName", 40, grow=True),
        ),
        row(
            text(
                "Лечение: в условиях пребывания в санаторно-курортной организации – 1, "
                "амбулаторно – 2"
            ),
            blank("treatmentSetting", 4),
        ),
        row(text("Продолжительность курса лечения"), blank("courseDays", 15), text("дней")),
        row(text("Путевка №"), blank("voucherNumber", 18)),
        row(
            text("Фамилия, имя, отчество (при наличии) и подпись лица, заполнившего карту"),
            blank("filledBy", 24, grow=True),
        ),
        row(_rule(), _stub("filledBySignature")),
        *head,
        row({"kind": "stamp", "fieldId": "stamp", "text": "М.П. (при наличии)"}, gap="medium"),
    ]


def _coupon_back_rows(v: Variant) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = [
        row(_rule(dotted=True)),
        row(text("линия отреза"), align="center", size="small", gap="medium"),
        row(text("Проведено лечение"), _rule()),
        _ruled("treatmentDone", 1),
        row(
            text(
                "(виды лечения, количество процедур, их переносимость, даты проведения "
                "санаторно-курортного лечения)",
                small=True,
            ),
            align="center",
            size="small",
        ),
        row(text("Эпикриз (включая данные обследования)"), _rule()),
        _ruled("epicrisis", 2 if v.child else 3),
        row(
            text(
                "Результат санаторно-курортного лечения: значительное улучшение – 1, улучшение "
                "– 2, без перемен – 3,"
            ),
            align="stretch",
        ),
        row(text("ухудшение – 4"), blank("treatmentResult", 4)),
        row(
            text("Наличие обострений, потребовавших отмену процедур: да – 1, нет – 2"),
            blank("exacerbations", 4),
        ),
        row(text("Рекомендации по дальнейшему лечению:"), _rule()),
        _ruled("recommendations", 1 if v.child else 3),
    ]
    if v.child:
        rows.append(
            row(
                text("Контакт с пациентами, больными инфекционными заболеваниями"),
                blank("talonInfectionContact", 20, grow=True),
            )
        )
    rows += [
        row(
            text("Лечащий врач, должность врача-специалиста"),
            blank("treatingDoctor", 24, grow=True),
            _stub("treatingDoctorSignature"),
        ),
        row(_caption(FAMILY_CAPTION, 76.5), _caption("подпись", 11.7)),
        row(
            text("Главный врач санаторно-курортной организации"),
            blank("chiefDoctor", 24, grow=True),
            _stub("chiefDoctorSignature"),
        ),
        row(_caption(FAMILY_CAPTION + " подпись", 76.9)),
        row(
            {"kind": "stamp", "fieldId": "returnStamp", "text": "М.П. (при наличии)"}, gap="medium"
        ),
    ]
    return rows


def build_layout(v: Variant, form_number: str) -> dict[str, Any]:
    front = _front_rows(v, form_number)
    front_inset = {"left": 5.7}
    back_inset = {"left": 0.9, "right": 4.2}
    return {
        "page": {
            "size": "A4",
            "orientation": "portrait",
            "marginMm": {"top": 10, "right": 14, "bottom": 6, "left": 16.7},
            "fontSizePt": 10,
        },
        "blocks": [
            {**_header_block(form_number), "insetMm": front_inset},
            _plain_block("title", front["title"], insetMm=front_inset),
            _plain_block("patient", front["patient"], insetMm=front_inset),
            _plain_block("insurance", front["insurance"], insetMm=front_inset),
            _plain_block("social", front["social"], insetMm=front_inset),
            _plain_block("return-front", _coupon_front_rows(v), insetMm=front_inset),
            _plain_block(
                "clinical",
                _clinical_rows(v, form_number),
                pageBreakBefore=True,
                insetMm=back_inset,
            ),
            _plain_block("conclusion", _conclusion_rows(v), insetMm=back_inset),
            _plain_block("return-back", _coupon_back_rows(v), insetMm=back_inset),
        ],
    }
