# A personal companion for Signum

Design proposal, 25 November 2026. The first milestone is a patient recording one day in airplane mode, reviewing it, and finding the same entry in the doctor's existing diary view after the usual exchange. The companion safety modes in [ADR 0028](../adr/0028-between-visit-companion-swiss-cheese-safety.md) are proposed controls. Its synthetic scenarios do not establish clinical validity.

## Implemented pilot (2026-11-25)

The patient care diary opens «Назначения» first, with the mascot, today’s progress and the completion calendar. Patient navigation has three labelled tabs: «Назначения», «Чат», «Настройки» (past records and manual export in Settings). The assistant’s «Объяснить назначения» chip opens the current doctor-provided plan and its instructions. A fixed pool of twelve LikeSpace-derived WebP presets supplies a stable mascot and name,
selected by hashing the random diary identifier. The patient cannot choose or rename it. Russian replies recognize complete conversational acts with
Unicode word segmentation and use authored follow-ups. Free text stays in the open diary's
transient conversation until the patient selects an excerpt, reviews it and explicitly saves it.
Pending daily marks, scheduled intakes, questionnaires and assigned worksheets use their existing
forms in modals opened by compact task chips. Successful saves produce a result chip that opens the saved entry. A two-hour deferral applies to in-app suggestions. The existing
diary save and exchange carry confirmed records, with no new server or model dependency. The revised monitoring consent explicitly defines the companion’s scope and distinguishes it from clinical decisions.
Direct, short first-person requests for urgent help offer the existing safety sheet, with an explicit request to contact the doctor on connected diaries. The provider-free pilot has no clinician mode setting, durable conversation memory or closed-PWA companion notifications. Those remain proposals below; generated inference is also future work.

## A day with the companion

The diary receives a fixed plush and name from the pilot pool; the patient can return to the same character on another device. The companion can open with «О чём хочется рассказать сегодня?» and leave space for an answer. For a personal conversation, try short replies generated on the device from the current exchange. Use the following conversation as a design target for evaluation.

> **Пациент:** «Сегодня впервые за неделю дошла до магазина. А дома опять расплакалась».
>
> **Помощник:** «Вы сказали “впервые за неделю”. Что вам запомнилось в том походе?»
>
> **Пациент:** «Что сама дошла. Вот это хочу запомнить».
>
> **Помощник:** «Оставим в дневнике вашими словами: “сама дошла”?»
>
> **Пациент:** «Да. А про слёзы пока не хочу».

The review now shows only «сама дошла», the date, the destination diary and its sharing status. Saving requires a patient action. The discarded detail stays out of the diary, doctor view and future-turn memory. Conversational context is temporary by default. Separate consent to remember a preference from consent to share a clinical entry. A patient can inspect or forget remembered items and invite a specific follow-up such as «Спроси в пятницу, как прошёл приём». A skipped day gets an ordinary welcome. The character can acknowledge effort and accept a correction in the next turn. Avoid claims of human feelings, exclusive closeness, surveillance or disappointment.

The local model proposes wording. Signum owns permissions, approved memories, factual save confirmations and the actions available under the doctor's care mode. Render crisis contacts and the safety plan through the existing deterministic path. On devices without a qualified local model, use the authored, explicitly guided diary flow. Test conversational Russian on real hardware before offering open dialogue.

**Adherence hypothesis.** A conversation that feels worth returning to may help patients complete the diary agreed with their doctor. For a consented pilot, compare guided entry and the personal companion under the same plan and reminder schedule. Primary outcome over four weeks is completed scheduled diary days divided by scheduled diary days per patient. Also ask whether patients felt understood, could correct the helper, knew what the doctor saw, or felt pressure to return. Report withdrawals and missing follow-up. Time in chat and message volume are poor proxies for this goal. Medication adherence and clinical benefit require independent outcome measures.

## Artwork

LikeSpace's `backend/app/services/botSpace/avatars/botAvatarSprites.ts` composes nine body silhouettes and six palettes with eyes, eyewear, a mouth, hats and accessories. Its sibling `botAvatarImage.ts` tints the luminance of the plush PNGs in `backend/app/assets/bot-avatar-3d/`, preserving their texture. The renderer already positions accessories per shape.

For the pilot, bake two silhouettes (bean and cloud), three colours (mint, lilac and peach) and two accessory choices (plain and book pin) into twelve small static WebPs. Record the recipe, source revision and redistribution permission with the asset set before publishing it in MiniMed's public repository. Bundle the images for offline use. The fixed pilot pool and invitation ID determine the preset consistently across devices. The pool order is part of the pilot contract. A fresh install decodes only its assigned image. The resting character consumes no animation frames.

## Local tool contract

LikeSpace's dialogue tools are scoped to the visible room and enabled skills. Carry that scope into Signum. The host supplies the role, active invitation, date and current draft revision. A tool caller cannot select a patient. Expose the following operations in process first. An MCP adapter could later publish the same schemas for an authorized client.

| Operation | Contract |
| --- | --- |
| Read available fields | Return the active plan's field IDs, labels, types, units, allowed choices and limits. Only expose the fields the current user can fill. |
| Propose an entry | Accept field candidates with exact source spans and the original note. Check IDs, units, bounds and choice membership. Surface conflicting evidence or an ambiguous date for clarification. Missing values stay missing. |
| Review or revise | Present one editable draft. Reject stale revisions when the user changes the text, active diary or date. A rejected suggestion leaves the original text available. |
| Confirm and save | Only the user's save action can submit the reviewed draft. Use the normal diary validation and storage path, with a stable entry ID across retries. Keep sharing subject to the existing diary exchange. |

The existing [entry model and parser](../../apps/app/src/features/diary/diary-model.ts) support structured values and a note on the same entry. The [entry form](../../apps/app/src/diary/DiaryEntryForm.tsx) also checks required fields. Reuse those checks for structured submissions. The parser accepts a note alone only when the invitation and checkpoint allow it. Keep a draft while required values are missing. A discussion flag would need an explicit persisted field, parser and round-trip coverage across exchange and doctor views. The existing spoken-text insights have a different meaning.

## What runs on each device

1. **Every device, no model installed.** Render questions and choices from the invitation. The patient selects a field and supplies its value through its typed control. Authored replies follow diary events. See the [offline dialogue research](../research/signum-offline-dialogue.md). For unrecognised wording, store the words, or let the user select a field. Never infer a medication taken from a mention, a scale from sentiment, or a patient's result from a description of someone else.
2. **Optional on-device extraction alongside conversation.** Give an installed model a single entry and the writable field schemas. Ask for short structured suggestions with evidence. Validate the output through the same boundary as rule suggestions. Cancellation, invalid output, insufficient memory or a slow cold start leaves the ordinary draft usable. No background inference while idle. Android can use the existing [llama.cpp adapter](../../apps/app/src/features/models/llama-runtime.ts). The patient PWA would need the [browser runtime](../../apps/app/src/features/models/browser-runtime.ts) wired into its own entry point and tested for offline model storage and memory pressure.
3. **Doctor-device alternative.** A patient with a low-memory phone can send the confirmed note by the existing exchange. At review, the doctor may run extraction locally on the copy already shared and accept an annotation attributed to the doctor. Preserve the patient's original entry and authorship. This path needs a separate annotation contract before shipping.

## Longitudinal patient profile and safety events (proposed)

Use the existing dated diary records as observations. A clinician-defined plan declares the
measures, units, frequency and interpretation: sleep duration, patient-reported wellbeing, prescribed
questionnaire items and scores, activity, adherence marks, completed exercises, and patient-selected
topics to discuss. For each observation retain the patient or clinician source, date, instrument and
version, value and unit, and original approved text where available. Calculate time series and
instrument-specific scores with their declared rules. Missing observations stay missing. The assigned mascot and any requested follow-up are separate from clinical data.

A clinician sees the measure, its trajectory and supporting records. The mascot is a pseudonymous visual identity; twelve variants are shared across diaries. Research-grade de-identification requires a separate consented export, data minimization, removal of identifiers, and assessment of reidentification from longitudinal records. No research export or telemetry is part of this pilot. Candidate text extraction
creates a reviewable observation with a quotation and an abstention option. A model-generated
description or a confidence value must be visibly attributed and kept separate from a confirmed
observation. Do not produce a single mental-health score or diagnostic label from chat.

The initial help cue recognises a small set of whole, explicit Russian utterances and can offer help
contacts. It has no validated sensitivity or specificity. A broader local safety detector would
need independent evaluation for self-harm, suicide, harm to others, accidental danger, historical
reports, quoted speech, negation, role ambiguity and indirect expressions. Use clinician-reviewed
synthetic and consented evaluation data, measuring missed events, inappropriate escalation and
time to help. Keep the patient's original wording under their control; a connected diary can send
the existing urgent event when the patient explicitly asks or a validated questionnaire declares
an alert. Show delivery state accurately, including offline queueing. No clinical severity is
inferred from a missing diary task. Extend the doctor's view with the existing alert events and
validated scale results before testing broader automatic escalation.

## Pilot acceptance

Exercise the actual patient entry point offline with the assigned avatar and an unconfigured model. Check mixed structured/free text, note only, negation, dates across midnight, ambiguous units, edits during extraction, duplicate taps and interrupted saves. Reopen the entry, exchange it and verify exact text, units, date and attribution in the doctor's view. Check that a different invitation exposes none of the previous draft. The doctor's companion setting and the patient's own choice to disable it must both take effect.

Compare rules and model suggestions on the same synthetic Russian entries, reporting wrong-field and wrong-value suggestions, missed explicit values and loss of original wording separately. Measure cold and warm time to draft, peak memory and cancellation on a representative patient phone and doctor device, including a standalone installed PWA. These measurements decide which devices should offer model assistance. The model-free path ships independently.
