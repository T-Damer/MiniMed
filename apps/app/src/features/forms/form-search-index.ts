import type { FormSchema } from '@localmed/contracts';

/**
 * What search lists of each shipped form, in the registry's order. Search is on the first screen,
 * and the registry behind it is 1 MB of form schemas: this list keeps them out of the start.
 * `form-search-index.test.ts` fails when it differs from the schemas.
 */
export type FormSearchEntry = Pick<FormSchema, 'id' | 'formNumber' | 'title'>;

export const FORM_SEARCH_INDEX: readonly FormSearchEntry[] = [
  {
    id: 'ru.minzdrav.274n.070u',
    formNumber: '070/у',
    title: 'Справка для получения путевки на санаторно-курортное лечение',
  },
  {
    id: 'ru.minzdrav.519n.057u',
    formNumber: '057/у',
    title: 'Направление для оказания медицинской помощи',
  },
  {
    id: 'ru.mintrud-minzdrav.488n-551n.088u',
    formNumber: '088/у',
    title: 'Направление на медико-социальную экспертизу медицинской организацией',
  },
  { id: 'ru.minzdrav.1094n.107-1u', formNumber: '107-1/у', title: 'Рецептурный бланк' },
  { id: 'ru.minzdrav.1094n.148-1u-88', formNumber: '148-1/у-88', title: 'Рецептурный бланк' },
  {
    id: 'ru.minzdrav.1094n.148-1u-04l',
    formNumber: '148-1/у-04(л)',
    title: 'Рецептурный бланк (льготный)',
  },
  {
    id: 'ru.minzdrav.1092n.003-vu',
    formNumber: '003-В/у',
    title:
      'Медицинское заключение о наличии (об отсутствии) у водителей транспортных средств (кандидатов в водители транспортных средств) медицинских противопоказаний, медицинских показаний или медицинских ограничений к управлению транспортными средствами',
  },
  {
    id: 'ru.minzdrav.395n.071u',
    formNumber: '071/у',
    title:
      'Медицинское заключение о наличии (об отсутствии) у трактористов, машинистов и водителей самоходных машин (кандидатов в трактористы, машинисты и водители самоходных машин) медицинских противопоказаний, медицинских показаний или медицинских ограничений к управлению самоходными машинами',
  },
  { id: 'ru.minzdrav.274n.072u', formNumber: '072/у', title: 'Санаторно-курортная карта' },
  {
    id: 'ru.minzdrav.274n.076u',
    formNumber: '076/у',
    title: 'Санаторно-курортная карта для детей',
  },
  {
    id: 'ru.minzdrav.274n.079u',
    formNumber: '079/у',
    title:
      'Медицинская справка о состоянии здоровья ребенка, направляемого в организацию отдыха детей и их оздоровления',
  },
  {
    id: 'ru.minzdrav.274n.025-1u',
    formNumber: '025-1/у',
    title: 'Талон пациента, получающего медицинскую помощь в амбулаторных условиях',
  },
  {
    id: 'ru.minzdrav.740n.058u',
    formNumber: '058/у',
    title:
      'Экстренное извещение о случае инфекционной, паразитарной болезни и носительства возбудителей инфекционных болезней, пищевого отравления, укуса или удара, нанесенного животным',
  },
];
