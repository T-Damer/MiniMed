package dev.localmed.nativespike.shared.ui

import dev.localmed.nativespike.shared.core.NativeCoreIdentityHit
import dev.localmed.nativespike.shared.core.NativeMedicalCore
import dev.localmed.nativespike.shared.model.NativeSearchMode
import dev.localmed.nativespike.shared.model.NativeSearchSelection
import dev.localmed.nativespike.shared.model.SearchOutcome

/** UI calls remain typed; browser visual fixtures replace retrieval, never source rendering. */
class NativeSearchActions(
    val lookupIdentities: suspend (String, NativeSearchSelection) -> List<NativeCoreIdentityHit>,
    val search: suspend (String, NativeSearchMode, NativeSearchSelection, ((String, Double) -> Unit)?) -> SearchOutcome?,
) {
    constructor(core: NativeMedicalCore) : this(core::lookupIdentities, core::search)
}
