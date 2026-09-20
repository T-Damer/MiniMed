# Neonatal fluid and parenteral-nutrition extraction — 2026-09-20

## Current source

Current Russian clinical recommendation **«Врожденная пневмония»**, 2025, ID 905_1, Appendix A3.3.

The source metadata identifies the recommendation as approved by the Ministry of Health scientific
council, with revision due no later than 2027. The appendix is explicitly titled as neonatal
requirements for fluid, energy, protein, fat, carbohydrates and electrolytes.

Primary PDF:
https://www.crbnovopokrovskay.ru/info_spec/klin_rekom/2025/kr_vrozhdennaja_pnevmonija.pdf

The tables were visually checked on printed pages 58–59.

## Structured artifact

`docs/research/data/neonatal-fluid-parenteral-nutrition-kr905_1-2025.json`

It contains:

- transitional-phase fluid ranges on days 1–5 for term infants and three preterm birth-weight bands;
- the source's intermediate/stable-growth phase rows;
- full-parenteral-nutrition protein, fat and carbohydrate source ranges;
- initial and target energy ranges;
- sodium, potassium, calcium, phosphorus and magnesium source ranges.

## Source-structure preservation

Several cells in the source table are merged or blank. MiniMed does not fill them by interpolation.

Examples:

- the intermediate fluid-phase row contains values for term and preterm >1500 g, while the two lower
  birth-weight cells are blank in the printed table;
- the stable-growth fluid range is printed as a merged table-wide cell;
- calcium, phosphorus and magnesium use a combined preterm column rather than distinct >1500/<1500
  values;
- some nutrient rows are also printed as merged source cells.

Those distinctions are encoded in the JSON contract instead of flattening every row to a synthetic
four-column matrix.

## Clinical boundary

This is **not** a treatment order set.

The source is a disease recommendation (congenital pneumonia), even though the appendix title describes
general neonatal needs and related current neonatal recommendations reuse the same source ranges.
Clinical condition, actual enteral intake, diuresis, respiratory status, renal function, ongoing
losses and laboratory monitoring still determine individual therapy.

The electrolyte footnotes are retained semantically:

- sodium/potassium start after established diuresis;
- calcium ranges assume adequate phosphorus supply;
- maternal magnesium sulfate exposure requires attention to early hypermagnesemia.

## Promotion gate

Before runtime calculator/order-set promotion:

1. second clinician review of every table cell and merged-cell interpretation;
2. explicit eligibility contract for term/preterm and birth-weight bands;
3. exact phase/day boundary behavior;
4. combination with measured enteral intake rather than treating parenteral ranges as total intake;
5. monitoring/contraindication rules;
6. preservation of recommendation ID/year/supersession metadata.

Until then the artifact remains `review-required` / `publicationState: blocked`.
