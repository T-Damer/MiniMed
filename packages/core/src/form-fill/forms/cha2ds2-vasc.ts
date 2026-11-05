import type { FormFillOverlay } from '../adapters';

/**
 * CHA₂DS₂-VASc (`minimed.calculator.cha2ds2-vasc`) from a conversation: hints for the model and
 * word cues for the fallback. Sex has no cue: a patient's words rarely say it, and the patient card
 * gives it. The cues cannot tell the patient's own history from a relative's («у отца был инфаркт»):
 * that is one reason every value waits for the doctor.
 */
export const CHA2DS2_VASC_OVERLAY: FormFillOverlay = {
  fields: {
    ageYears: {
      hint: 'возраст пациента полных лет',
      cues: ['мне', 'сколько (?:вам )?лет', 'возраст~', 'исполнил~'],
    },
    heartFailure: {
      hint: 'сердечная недостаточность или сниженная фракция выброса у самого пациента',
      cues: ['сердечн~ недостаточност~', 'недостаточност~ кровообращени~'],
    },
    hypertension: {
      hint: 'гипертония, повышенное давление, лечится от давления',
      cues: [
        'гипертони~',
        'гипертензи~',
        'давлени~ (?:повыш|высок|поднима)~',
        '(?:повышенн|высок)~ давлени~',
        'от давления',
      ],
    },
    diabetes: {
      hint: 'сахарный диабет у самого пациента',
      cues: ['диабет~', 'сахар (?:повыш|высок)~'],
    },
    strokeTia: {
      hint: 'инсульт, микроинсульт, транзиторная ишемическая атака или тромбоэмболия у самого пациента',
      cues: ['инсульт~', 'микроинсульт~', 'транзиторн~ ишеми~', 'тромбоэмболи~'],
    },
    vascularDisease: {
      hint: 'инфаркт миокарда, атеросклероз артерий ног, бляшки в аорте у самого пациента',
      cues: ['инфаркт~', 'атеросклероз~', 'перемежающ~ хромот~'],
    },
    femaleSex: { hint: 'пол пациента: женщина — да, мужчина — нет' },
  },
};
