"""Package the medical-services nomenclature as one optional, exact, gzip-transported module.

No discovery-core pointer targets these documents, so there is no core membership check; the
catalog entry lists no documents (hundreds of section cards), the exact membership is in the
package report and in ``sourceSetDigest``.
"""

from __future__ import annotations

from pathlib import Path

from .code_reference import (
    DOCUMENT_PREFIX,
    NSI_OID,
    NSI_PUBLIC_PAGE,
    RIGHTS_STATUS,
    SOURCE_TYPE,
)
from .module_distribution import (
    ModuleDescriptor,
    package_module,
    plural_ru,
    read_pack_membership,
    required_text,
)

MODULE_ID = "minimed.reference.medical-services.ru"
COLLECTION = "medical-services"
TITLE = "Номенклатура медицинских услуг"


def package_medical_services_module(
    database: Path,
    output_dir: Path,
    *,
    version: str,
    min_app_version: str,
) -> dict[str, object]:
    active = 0
    abolished = 0
    dictionary_versions: set[str] = set()

    def validate(document_id: str, source_checksum: str, metadata: dict[str, object]) -> None:
        nonlocal active, abolished
        if metadata.get("officialSourceUrl") != NSI_PUBLIC_PAGE:
            raise ValueError(f"{document_id}: source URL is not {NSI_PUBLIC_PAGE}")
        if metadata.get("nsiOid") != NSI_OID:
            raise ValueError(f"{document_id}: not marked as dictionary {NSI_OID}")
        if not source_checksum.startswith("sha256:"):
            raise ValueError(f"{document_id}: version has no SHA-256 source checksum")
        if metadata.get("rightsStatus") != RIGHTS_STATUS:
            raise ValueError(f"{document_id}: rights status is not {RIGHTS_STATUS}")
        if metadata.get("localOnly"):
            raise ValueError(f"{document_id}: a local-only document cannot ship in a public module")
        if metadata.get("publicationState") != "preview":
            raise ValueError(f"{document_id}: not prepared as a preview")
        counts = (metadata.get("serviceCount"), metadata.get("abolishedServiceCount"))
        if not all(isinstance(count, int) for count in counts):
            raise ValueError(f"{document_id}: service counts are missing")
        active += int(str(counts[0]))
        abolished += int(str(counts[1]))
        dictionary_versions.add(required_text(metadata.get("nsiVersion"), f"{document_id} version"))

    membership = read_pack_membership(
        database, document_prefixes=(DOCUMENT_PREFIX,), validate=validate
    )
    if len(dictionary_versions) != 1:
        raise ValueError(f"Expected one dictionary version, found {sorted(dictionary_versions)}")
    dictionary_version = next(iter(dictionary_versions))
    sections = len(membership.documents)
    abolished_text = plural_ru(
        abolished, "упразднённая услуга", "упразднённые услуги", "упразднённых услуг"
    )
    description = (
        "Номенклатура медицинских услуг (справочник НСИ Минздрава России, "
        f"версия {dictionary_version}; приказ Минздрава России № 804н): "
        f"{plural_ru(active, 'действующая услуга', 'действующие услуги', 'действующих услуг')} "
        f"с кодами и наименованиями в {plural_ru(sections, 'разделе', 'разделах', 'разделах')} "
        "по классу и разделу кода (A16.20, B01.003…) и "
        f"{abolished_text} "
        "с датой упразднения. Поиск по коду услуги и по её названию; тексты справочника без "
        "изменений."
    )
    return package_module(
        database,
        output_dir,
        descriptor=ModuleDescriptor(
            module_id=MODULE_ID,
            release_tag=f"reference-medical-services-{version}",
            file_stem="minimed.reference.medical-services",
            title=TITLE,
            tags=("medical-services", "nomenclature", "codes", "reference", "official"),
            structured_tables=True,
            collection=COLLECTION,
            list_documents=False,
        ),
        version=version,
        min_app_version=min_app_version,
        membership=membership,
        description=description,
        report_extra={
            "sourceType": SOURCE_TYPE,
            "dictionaryVersion": dictionary_version,
            "activeServices": active,
            "abolishedServices": abolished,
        },
    )
