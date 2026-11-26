# How the Signum companion can reply offline

25 November 2026. Proposed behavior for the patient diary. This is a design and source review. Patient usability and extraction accuracy still require measurement.

The authored dialogue below is the model-free fallback. The [companion design](../architecture/SIGNUM_DIARY_COMPANION.md) describes the personal conversation target and adherence pilot.

## Choose the reply from the diary event

A short authored exchange can handle an open-ended note without classifying its words. The patient tells the companion what happened. The original wording becomes an editable note. The companion offers one useful next action from the active plan. A tap identifies a field unambiguously, including when the doctor has given it a custom label. The existing field control supplies its unit, options and validation. The patient's chosen LikeSpace plush delivers the same replies across appearances.

Use a small typed transition table in the app. Its inputs are events such as note entered, field chosen, value edited, save succeeded and save failed. Its output is a reply key and the available actions. This follows the event, guard and transition model in the W3C specification and requires no state-machine library. Google's conversation design guidance supports asking one question per turn, acknowledging details implicitly and allowing immediate correction. These sources address interaction design. Clinical effectiveness is a separate research question. [W3C SCXML](https://www.w3.org/TR/scxml/) · [Questions](https://developers.google.com/assistant/conversation-design/questions) · [Confirmations](https://developers.google.com/assistant/conversation-design/confirmations)

| Moment | Example of what the patient sees |
| --- | --- |
| Open a new entry | «Что хотите записать за сегодня?» with a text field and the current date. |
| Type «У мамы давление 150, я переживаю» | The full text stays in the note. «Добавим что-нибудь из вашего дневника?» with available plan fields and an action to finish. The number never becomes the patient's reading. |
| Select an available numeric field | Show the doctor's field label, unit and ordinary input. For a sleep-duration field the prompt might be «Сколько часов вы спали?» |
| Review | Show the note, selected date and editable field values together. «Всё верно?» with «Сохранить» and edit controls. |
| A required value is missing | «Осталось заполнить поле „…“» with that exact control. Preserve the text. |
| Local write succeeds | «Записано в дневник». The existing sync status reports delivery separately. |
| Local write fails | «Сохранить пока не удалось» with retry and the same editable draft. |

Keep feedback stable while typing. Present the next reply on an explicit action. Personalization comes from the selected appearance, active plan, chosen day and actual progress. An explicit «Нужна помощь» action can open configured help contacts without trying to detect distress in prose. In this version free text receives a diary acknowledgement, with no claim that the character interpreted the patient's condition.

## Where the actions land

Signum's entry form submits the entry ID, timestamp, values and note. Its ordinary save and care-day save callbacks both call the invitation-aware parser and commit the result. Commit persists locally and schedules sync. Use the callback belonging to the active diary flow so a care mark retains its checkpoint semantics. A note-only entry is valid only when the invitation has no unmet required field and the checkpoint permits it. For example, a substance-use checkpoint requires an explicit value. Keep incomplete text as a draft. The current parser enforces both rules. [Entry form](../../apps/app/src/diary/DiaryEntryForm.tsx) · [Save paths](../../apps/app/src/diary/DiaryView.tsx) · [Entry validation](../../apps/app/src/features/diary/diary-model.ts)

## When a model adds value

Free-text extraction is a separate capability. For a later experiment an installed local model could propose a field ID, value, unit and supporting quotation, or abstain. llama.cpp supports grammar-constrained output upstream. This can constrain output shape while leaving attribution, negation, dates and units to verify. Check grammar support in each MiniMed adapter before relying on it. Compare with the guided flow using synthetic Russian notes such as «у мамы давление 150», «не измерял» and «вчера шесть часов, сегодня четыре». Measure wrong suggestions, corrections, time to a confirmed entry and phone latency. Keep suggestions optional even if the benchmark passes. [llama.cpp grammar documentation](https://github.com/ggml-org/llama.cpp/blob/master/grammars/README.md) · [Android adapter](../../apps/app/src/features/models/llama-runtime.ts) · [Browser adapter](../../apps/app/src/features/models/browser-runtime.ts)

The first pilot succeeds when a patient can choose the plush, compose an entry offline, correct a value, save once, reopen it and see the same wording in the doctor's diary after ordinary exchange. Test a required-field invitation and a failed write as well as the successful note-only case. Observe whether patients can tell when an entry is saved locally and when their doctor can see it.
